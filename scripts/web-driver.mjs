import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WATCHDOG_ORIGIN = 'http://127.0.0.1:9235';
const CLIENT_ORIGIN = 'http://127.0.0.1:4317';
const CONTROL_PORTS = Array.from({ length: 10 }, (_, index) => 4318 + index);
const controlOrigin = (port) => `http://127.0.0.1:${port}`;

function parseArgs(argv) {
  const [domain, action, ...rest] = argv;
  const json = rest.includes('--json');
  const timeoutIndex = rest.indexOf('--timeout-ms');
  const timeoutMs = timeoutIndex >= 0 ? Number(rest[timeoutIndex + 1]) : 45_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
    throw new Error('--timeout-ms must be between 100 and 300000');
  }

  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--json') continue;
    if (value === '--timeout-ms') {
      index += 1;
      continue;
    }
    positional.push(value);
  }
  return { domain, action, json, timeoutMs, positional };
}

function chromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

async function readDiskBuildInfo() {
  try {
    return JSON.parse(await readFile(join(root, 'extension', 'build.json'), 'utf8'));
  } catch {
    return null;
  }
}

function runBuild() {
  const executable = process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/c', 'npm.cmd', 'run', 'build:extension']
    : ['run', 'build:extension'];
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    const detail = result.error instanceof Error ? `: ${result.error.message}` : '';
    throw new Error(`Extension build failed with exit code ${result.status ?? 1}${detail}`);
  }
}

function createControlServer(port) {
  const states = new Map();
  const origin = controlOrigin(port);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/__extension-control.html' && (request.method === 'GET' || request.method === 'HEAD')) {
      const body = Buffer.from('<!doctype html><meta charset="utf-8"><title>ChatGPT Web Driver Control</title><p>Extension control in progress.</p>');
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
        'Connection': 'close'
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    if (url.pathname === '/__extension-control' && request.method === 'GET') {
      const requestId = url.searchParams.get('requestId') ?? '';
      const payload = states.get(requestId) ?? { state: 'waiting', requestId };
      const body = Buffer.from(JSON.stringify(payload));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
        'Connection': 'close'
      });
      response.end(body);
      return;
    }
    if (url.pathname === '/__extension-control' && request.method === 'POST') {
      const requestId = url.searchParams.get('requestId') ?? '';
      if (!requestId) {
        response.writeHead(400);
        response.end();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > 64 * 1024) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(buffer);
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        states.set(requestId, { ...payload, requestId });
        response.writeHead(204, { 'Connection': 'close' });
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return { server, states };
}

async function listenControlServer() {
  let lastError = null;
  for (const port of CONTROL_PORTS) {
    const { server, states } = createControlServer(port);
    try {
      await new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolvePromise();
        });
      });
      return {
        port,
        origin: controlOrigin(port),
        states,
        close: () => new Promise((resolvePromise) => {
          server.close(() => resolvePromise());
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
        })
      };
    } catch (error) {
      lastError = error;
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError ?? new Error('No extension control port was available');
}

function openChrome(url) {
  const chrome = chromeExecutable();
  if (!chrome) throw new Error('Google Chrome executable was not found');

  if (process.platform === 'win32') {
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const script = [
      '$shell = New-Object -ComObject Shell.Application',
      `$shell.ShellExecute(${quote(chrome)}, ${quote(url)}, '', 'open', 1)`
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true
    });
    if (result.status !== 0) throw new Error(`Could not hand off control URL to Google Chrome (exit ${result.status ?? 1})`);
    return chrome;
  }

  const child = spawn(chrome, [url], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return chrome;
}

async function waitForControl(states, requestId, terminalStates, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { state: 'waiting', requestId };
  while (Date.now() < deadline) {
    last = states.get(requestId) ?? last;
    if (terminalStates.has(last.state)) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for extension control result; last state=${last.state}`);
}

function controlUrl(origin, op, requestId, expectedBuildId, targetUrl, extra = {}) {
  const url = new URL('/__extension-control.html', origin);
  url.searchParams.set('op', op);
  url.searchParams.set('requestId', requestId);
  if (expectedBuildId) url.searchParams.set('expectedBuildId', expectedBuildId);
  if (targetUrl) url.searchParams.set('url', targetUrl);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && String(value)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function clientControlStatus() {
  const response = await fetch(`${CLIENT_ORIGIN}/__driver-control/status`, {
    headers: { 'cache-control': 'no-store' },
    signal: AbortSignal.timeout(2_000)
  });
  if (!response.ok) throw new Error(`Human Client control status failed with HTTP ${response.status}`);
  return response.json();
}

async function sendClientControlCommand(op, payload, timeoutMs) {
  const status = await clientControlStatus();
  if (status?.relayConnected !== true) {
    throw new Error('Human Client control relay is not connected on http://127.0.0.1:4317; open or refresh the existing Human Client tab instead of spawning a control tab');
  }

  const requestId = `cli-${randomUUID()}`;
  const accepted = await fetch(`${CLIENT_ORIGIN}/__driver-control/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, op, payload }),
    signal: AbortSignal.timeout(2_000)
  });
  if (!accepted.ok) throw new Error(`Human Client control command was rejected with HTTP ${accepted.status}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${CLIENT_ORIGIN}/__driver-control/result?requestId=${encodeURIComponent(requestId)}`, {
      headers: { 'cache-control': 'no-store' },
      signal: AbortSignal.timeout(2_000)
    });
    if (!response.ok) throw new Error(`Human Client control result failed with HTTP ${response.status}`);
    const envelope = await response.json();
    if (envelope?.state === 'ready') return envelope.result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for Human Client control result for ${op}`);
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  for (const [key, value] of Object.entries(result)) {
    if (value !== undefined && value !== null && typeof value !== 'object') console.log(`${key}: ${value}`);
  }
  if (result.reattached) console.log(`reattached: ${JSON.stringify(result.reattached)}`);
}

async function legacyBootstrapReload(options) {
  runBuild();
  const disk = await readDiskBuildInfo();
  if (!disk?.buildId) throw new Error('Extension build metadata was not produced');

  const control = await listenControlServer();
  try {
    const requestId = `bootstrap-${randomUUID()}`;
    const chrome = openChrome(controlUrl(control.origin, 'reload', requestId, disk.buildId));
    const first = await waitForControl(
      control.states,
      requestId,
      new Set(['accepted', 'verified', 'failed']),
      Math.min(options.timeoutMs, 10_000)
    );
    if (first.state === 'verified' || first.state === 'failed') {
      const result = { ...first, chrome, diskBuildId: disk.buildId, bootstrap: true };
      printResult(result, options.json);
      if (first.state !== 'verified') process.exitCode = 1;
      return result;
    }

    let verified;
    try {
      verified = await waitForControl(control.states, requestId, new Set(['verified', 'failed']), Math.min(4_000, options.timeoutMs));
    } catch {
      openChrome(controlUrl(
        control.origin,
        'reload.verify',
        requestId,
        disk.buildId,
        undefined,
        {
          beforeBuildId: first.beforeBuildId,
          beforeInstanceId: first.beforeInstanceId,
          requestedAt: first.requestedAt
        }
      ));
      verified = await waitForControl(control.states, requestId, new Set(['verified', 'failed']), options.timeoutMs);
    }
    const result = { ...verified, chrome, diskBuildId: disk.buildId, bootstrap: true };
    printResult(result, options.json);
    if (verified.state !== 'verified') process.exitCode = 1;
    return result;
  } finally {
    await control.close();
  }
}

async function extensionStatus(options, emit = true) {
  const result = await sendClientControlCommand('extension.status', {}, options.timeoutMs);
  const disk = await readDiskBuildInfo();
  const enriched = {
    ...result,
    chrome: chromeExecutable(),
    diskBuildId: disk?.buildId ?? null,
    inSync: result?.state === 'status' && disk?.buildId === result?.buildId
  };
  if (emit) {
    printResult(enriched, options.json);
    if (result?.state === 'failed') process.exitCode = 1;
  }
  return enriched;
}

async function extensionReload(options) {
  runBuild();
  const disk = await readDiskBuildInfo();
  if (!disk?.buildId) throw new Error('Extension build metadata was not produced');

  const before = await extensionStatus({ ...options, timeoutMs: Math.min(options.timeoutMs, 10_000) }, false);
  if (before?.state !== 'status' || !before.instanceId || !before.buildId) {
    throw new Error('Could not read the current extension runtime before reload');
  }

  const requestedAt = Date.now();
  try {
    await sendClientControlCommand(
      'extension.reload',
      { expectedBuildId: disk.buildId },
      Math.min(options.timeoutMs, 8_000)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/context invalidated|timed out|relay is not connected/i.test(message)) throw error;
  }

  const deadline = Date.now() + options.timeoutMs;
  let after = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const candidate = await extensionStatus(
        { ...options, timeoutMs: Math.min(5_000, Math.max(1_000, deadline - Date.now())) },
        false
      );
      if (candidate?.state === 'status' && candidate.instanceId !== before.instanceId) {
        after = candidate;
        break;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
  }

  if (!after) {
    if (lastError) throw lastError;
    throw new Error('Extension instance did not change after reload');
  }

  const verifyPayload = {
    expectedBuildId: disk.buildId,
    beforeBuildId: before.buildId,
    beforeInstanceId: before.instanceId,
    requestedAt
  };
  const result = await sendClientControlCommand(
    'extension.reload.verify',
    verifyPayload,
    Math.min(15_000, Math.max(2_000, deadline - Date.now()))
  );

  const enriched = { ...result, chrome: chromeExecutable(), diskBuildId: disk.buildId };
  printResult(enriched, options.json);
  process.exitCode = result?.state === 'verified' ? 0 : 1;
  return enriched;
}

async function catalogCommand(options) {
  if (!['get', 'refresh', 'resolve', 'probe', 'inspect'].includes(options.action)) {
    throw new Error('Catalog action must be get, refresh, resolve, probe, or inspect');
  }
  const targetUrl = ['resolve', 'inspect'].includes(options.action) ? options.positional[0] : undefined;
  if (options.action === 'resolve' && !targetUrl) {
    throw new Error('catalog resolve requires a ChatGPT conversation URL');
  }
  if (options.action === 'inspect' && !targetUrl) {
    throw new Error('catalog inspect requires a ChatGPT project URL');
  }

  const result = await sendClientControlCommand(
    `catalog.${options.action}`,
    targetUrl ? { url: targetUrl } : {},
    options.timeoutMs
  );
  const enriched = { ...result, chrome: chromeExecutable() };
  if (options.json) console.log(JSON.stringify(enriched));
  else if (result?.ok) {
    if (result.inspect) {
      console.log(`expectedUrl: ${result.inspect.expectedUrl}`);
      console.log(`actualUrl: ${result.inspect.actualUrl}`);
      console.log(`before conversations: ${result.inspect.before?.conversations ?? 0}`);
      console.log(`after conversations: ${result.inspect.after?.conversations ?? 0}`);
      console.log(`scan conversations: ${result.inspect.catalog?.conversations?.length ?? 0}`);
    } else if (result.probe) {
      console.log(`pageUrl: ${result.probe.pageUrl}`);
      console.log(`totalAnchors: ${result.probe.totalAnchors}`);
      console.log(`catalogAnchors: ${result.probe.catalogAnchors}`);
      console.log(`projects: ${result.probe.projects}`);
      console.log(`conversations: ${result.probe.conversations}`);
    } else {
      console.log(`projects: ${result.catalog?.projects?.length ?? 0}`);
      console.log(`conversations: ${result.catalog?.conversations?.length ?? 0}`);
      if (result.entry) console.log(`entry: ${result.entry.title} | ${result.entry.url}`);
    }
  } else {
    console.error(result?.error || 'Catalog request failed');
  }
  if (!result?.ok) process.exitCode = 1;
  return enriched;
}

async function watchdogControl(options, op) {
  const result = await sendClientControlCommand(op, {}, options.timeoutMs);
  return { ...result, chrome: chromeExecutable() };
}

async function watchdogTarget(options) {
  return watchdogControl(options, 'watchdog.target');
}

async function watchdogCandidates(options) {
  return watchdogControl(options, 'watchdog.candidates');
}

function normalizeWatchdogUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://chatgpt.com') return null;
    const standalone = url.pathname.match(/^\/c\/[^/]+/);
    if (standalone) return `${url.origin}${standalone[0]}`;
    const project = url.pathname.match(/^\/g\/g-p-[^/]+\/c\/[^/]+/);
    return project ? `${url.origin}${project[0]}` : null;
  } catch {
    return null;
  }
}

async function watchdogPost(path, url) {
  const response = await fetch(`${WATCHDOG_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(2_000)
  });
  if (!response.ok) {
    throw new Error(`Watchdog ${path} failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!text) return { ok: true };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
}

async function watchdogCompletion(url) {
  const response = await fetch(`${WATCHDOG_ORIGIN}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(2_000)
  });
  if (!response.ok) throw new Error(`Watchdog completion failed with HTTP ${response.status}`);
  const payload = await response.json();
  return {
    active: payload?.active === true,
    completed: payload?.completed === true,
    result: typeof payload?.result === 'string' ? payload.result : null
  };
}

async function watchdogCommand(options) {
  if (!['attach', 'status', 'detach', 'candidates'].includes(options.action)) {
    throw new Error('Watchdog action must be attach, status, detach, or candidates');
  }

  if (options.action === 'candidates') {
    const target = await watchdogCandidates(options);
    if (!target.ok) throw new Error(target.error || 'Could not list ChatGPT Watchdog candidates');
    const result = { state: 'candidates', candidates: target.candidates ?? [], chrome: target.chrome };
    if (options.json) console.log(JSON.stringify(result));
    else for (const candidate of result.candidates) {
      console.log(`${candidate.active ? '*' : ' '} ${candidate.title ?? ''} | ${candidate.url}`);
    }
    return result;
  }

  const explicitUrl = normalizeWatchdogUrl(options.positional[0]);
  const target = explicitUrl
    ? { ok: true, url: explicitUrl, tabId: null, title: null, chrome: chromeExecutable() }
    : await watchdogTarget(options);
  if (!target.ok || !target.url) {
    throw new Error(target.error || 'No current ChatGPT conversation is available for Watchdog');
  }

  if (options.action === 'attach') {
    await watchdogPost('/register', target.url);
  } else if (options.action === 'detach') {
    await watchdogPost('/unregister', target.url);
  }

  const completion = await watchdogCompletion(target.url);
  const expectedActive = options.action !== 'detach';
  const verified = completion.active === expectedActive;
  const result = {
    state: verified ? 'verified' : 'failed',
    action: options.action,
    url: target.url,
    tabId: target.tabId ?? null,
    title: target.title ?? null,
    active: completion.active,
    completed: completion.completed,
    result: completion.result,
    chrome: target.chrome
  };
  printResult(result, options.json);
  if (!verified) process.exitCode = 1;
  return result;
}

async function legacyClientOpen(options) {
  const control = await listenControlServer();
  try {
    const requestId = `client-open-${randomUUID()}`;
    const chrome = openChrome(controlUrl(control.origin, 'client.open', requestId));
    const envelope = await waitForControl(
      control.states,
      requestId,
      new Set(['client', 'failed']),
      options.timeoutMs
    );
    const result = envelope.state === 'client'
      ? envelope.result
      : { ok: false, error: envelope.error || 'Client open failed' };
    return { ...result, chrome, bootstrap: true };
  } finally {
    await control.close();
  }
}

async function clientCommand(options) {
  if (options.action !== 'open') throw new Error('Client action must be open');

  let result;
  try {
    result = await sendClientControlCommand(
      'client.open',
      { fresh: true, replaceExisting: true },
      options.timeoutMs
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/relay is not connected/i.test(message)) throw error;
    result = await legacyClientOpen(options);
  }

  const enriched = { ...result, chrome: result?.chrome ?? chromeExecutable() };
  printResult(enriched, options.json);
  if (!result?.ok) process.exitCode = 1;
  return enriched;
}

async function conversationCommand(options) {
  if (!['load', 'navigate', 'probe'].includes(options.action)) {
    throw new Error('Conversation action must be load, navigate, or probe');
  }
  const targetUrl = normalizeWatchdogUrl(options.positional[0]);
  if (!targetUrl) throw new Error(`conversation ${options.action} requires a valid ChatGPT conversation URL`);
  const fromUrl = options.action === 'navigate' ? normalizeWatchdogUrl(options.positional[1]) : null;

  const result = await sendClientControlCommand(
    `conversation.${options.action}`,
    { url: targetUrl, ...(fromUrl ? { fromUrl } : {}) },
    options.timeoutMs
  );
  const enriched = { ...result, chrome: chromeExecutable() };
  if (options.json) console.log(JSON.stringify(enriched));
  else if (result?.ok && options.action === 'load') {
    console.log(`title: ${result.snapshot?.title ?? ''}`);
    console.log(`url: ${result.snapshot?.url ?? targetUrl}`);
    console.log(`messages: ${result.snapshot?.turns?.length ?? 0}`);
    if (result.scan) {
      console.log(`complete: ${result.scan.complete === true}`);
      console.log(`windows: ${result.scan.windows ?? 0}`);
    }
  } else if (result?.ok) {
    console.log(`messages: ${result.probe?.messageCount ?? 0}`);
    console.log(`scroll: ${JSON.stringify(result.probe?.scroll ?? null)}`);
  } else {
    console.error(result?.error || `Conversation ${options.action} failed`);
  }
  if (!result?.ok) process.exitCode = 1;
  return enriched;
}

async function extensionDoctor(options) {
  const chrome = chromeExecutable();
  const disk = await readDiskBuildInfo();
  const local = {
    state: chrome && disk?.buildId ? 'local-ready' : 'local-failed',
    chrome,
    extensionDir: join(root, 'extension'),
    buildId: disk?.buildId ?? null
  };
  if (!chrome || !disk?.buildId) {
    printResult(local, options.json);
    process.exitCode = 1;
    return local;
  }
  const runtime = await extensionStatus({ ...options, json: true }, false);
  const result = { ...local, runtime };
  if (options.json) console.log(JSON.stringify(result));
  else {
    console.log(`state: ${runtime.inSync ? 'ready' : 'build-mismatch'}`);
    console.log(`chrome: ${chrome}`);
    console.log(`buildId: ${disk.buildId}`);
    console.log(`runtimeBuildId: ${runtime.buildId ?? ''}`);
  }
  if (!runtime.inSync) process.exitCode = 1;
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.domain === 'extension' && ['status', 'reload', 'doctor', 'bootstrap'].includes(options.action)) {
    if (options.action === 'status') await extensionStatus(options);
    if (options.action === 'reload') await extensionReload(options);
    if (options.action === 'doctor') await extensionDoctor(options);
    if (options.action === 'bootstrap') await legacyBootstrapReload(options);
    return;
  }
  if (options.domain === 'catalog' && ['get', 'refresh', 'resolve', 'probe', 'inspect'].includes(options.action)) {
    await catalogCommand(options);
    return;
  }
  if (options.domain === 'watchdog' && ['attach', 'status', 'detach', 'candidates'].includes(options.action)) {
    await watchdogCommand(options);
    return;
  }
  if (options.domain === 'conversation' && ['load', 'navigate', 'probe'].includes(options.action)) {
    await conversationCommand(options);
    return;
  }
  if (options.domain === 'client' && options.action === 'open') {
    await clientCommand(options);
    return;
  }

  console.error('Usage: npm run driver -- extension <status|reload|doctor|bootstrap> [--json] [--timeout-ms N]');
  console.error('   or: npm run driver -- catalog <get|refresh|resolve|probe|inspect> [chatgpt-url] [--json] [--timeout-ms N]');
  console.error('   or: npm run driver -- watchdog <attach|status|detach|candidates> [conversation-url] [--json] [--timeout-ms N]');
  console.error('   or: npm run driver -- conversation <load|navigate|probe> <conversation-url> [from-conversation-url] [--json] [--timeout-ms N]');
  console.error('   or: npm run driver -- client open [--json] [--timeout-ms N]');
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
