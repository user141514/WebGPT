import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CLIENT_PORT, createClientServer, resolveClientAsset } from '../src/client/server.ts';

test('pins the local client to the relay contract port', () => {
  assert.equal(CLIENT_PORT, 4317);
});

test('resolves only the explicit client assets and rejects traversal or unknown paths', () => {
  const root = 'C:/project';
  assert.deepEqual(resolveClientAsset('/', root), {
    file: join(root, 'client', 'index.html'),
    contentType: 'text/html; charset=utf-8'
  });
  assert.deepEqual(resolveClientAsset('/styles.css', root), {
    file: join(root, 'client', 'styles.css'),
    contentType: 'text/css; charset=utf-8'
  });
  assert.deepEqual(resolveClientAsset('/catalog.js', root), {
    file: join(root, 'extension', 'dist', 'catalog.js'),
    contentType: 'text/javascript; charset=utf-8'
  });
  assert.deepEqual(resolveClientAsset('/app.js', root), {
    file: join(root, 'extension', 'dist', 'client', 'main.js'),
    contentType: 'text/javascript; charset=utf-8'
  });
  assert.deepEqual(resolveClientAsset('/__extension-control.html', root), {
    file: join(root, 'client', 'extension-control.html'),
    contentType: 'text/html; charset=utf-8'
  });
  for (const module of ['bind-status.js', 'catalog-view.js', 'catalog-tree.js', 'conversation-view.js', 'conversation-id.js', 'heartbeat.js', 'protocol.js', 'state.js', 'render-content.js', 'selection-epoch.js', 'smoke.js']) {
    assert.deepEqual(resolveClientAsset(`/${module}`, root), {
      file: join(root, 'extension', 'dist', 'client', module),
      contentType: 'text/javascript; charset=utf-8'
    });
  }
  assert.equal(resolveClientAsset('/../package.json', root), null);
  assert.equal(resolveClientAsset('/unknown', root), null);
});

test('records extension control receipts per request id for CLI verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgpt-web-driver-extension-control-'));
  try {
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(join(root, 'client', 'extension-control.html'), '<title>control</title>');
    const server = createClientServer({ root });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    const waiting = await fetch(`${base}/__extension-control?requestId=reload-1`);
    assert.deepEqual(await waiting.json(), { state: 'waiting', requestId: 'reload-1' });

    const update = await fetch(`${base}/__extension-control?requestId=reload-1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'verified', requestId: 'reload-1', buildId: 'build-new' })
    });
    assert.equal(update.status, 204);

    const verified = await fetch(`${base}/__extension-control?requestId=reload-1`);
    assert.deepEqual(await verified.json(), {
      state: 'verified',
      requestId: 'reload-1',
      buildId: 'build-new'
    });

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('queues CLI control commands through the existing Human Client without opening browser control tabs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgpt-web-driver-control-'));
  try {
    const server = createClientServer({ root });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    const initial = await fetch(`${base}/__driver-control/status`);
    assert.deepEqual(await initial.json(), { relayConnected: false, relayConnections: 0, pending: 0 });

    const streamAbort = new AbortController();
    const stream = await fetch(`${base}/__driver-control/events`, { signal: streamAbort.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);

    const connected = await fetch(`${base}/__driver-control/status`);
    assert.deepEqual(await connected.json(), { relayConnected: true, relayConnections: 1, pending: 0 });

    const command = {
      requestId: 'ctl-1',
      op: 'extension.status',
      payload: {}
    };
    assert.equal((await fetch(`${base}/__driver-control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command)
    })).status, 202);

    const [claimA, claimB] = await Promise.all([
      fetch(`${base}/__driver-control/next`),
      fetch(`${base}/__driver-control/next`)
    ]);
    assert.deepEqual([claimA.status, claimB.status].sort(), [200, 204]);
    const claimed = claimA.status === 200 ? claimA : claimB;
    assert.deepEqual(await claimed.json(), command);

    assert.equal((await fetch(`${base}/__driver-control/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'ctl-1', result: { state: 'status', buildId: 'b1' } })
    })).status, 204);

    const result = await fetch(`${base}/__driver-control/result?requestId=ctl-1`);
    assert.deepEqual(await result.json(), {
      state: 'ready',
      requestId: 'ctl-1',
      result: { state: 'status', buildId: 'b1' }
    });

    streamAbort.abort();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('records live client status in memory without persisting conversation content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgpt-web-driver-client-status-'));
  try {
    await mkdir(join(root, 'client'), { recursive: true });
    await mkdir(join(root, 'extension', 'dist', 'client'), { recursive: true });
    await writeFile(join(root, 'client', 'index.html'), '<h1>client</h1>');
    await writeFile(join(root, 'client', 'styles.css'), 'body{}');
    for (const file of ['main.js', 'catalog-view.js', 'catalog-tree.js', 'conversation-view.js', 'conversation-id.js', 'heartbeat.js', 'protocol.js', 'state.js', 'render-content.js', 'selection-epoch.js', 'smoke.js']) {
      await writeFile(join(root, 'extension', 'dist', 'client', file), 'export {}');
    }

    const server = createClientServer({ root });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    const initial = await fetch(`${base}/__live`);
    assert.deepEqual(await initial.json(), {
      phase: 'unknown',
      requestId: null,
      assistantText: '',
      error: null,
      conversationUrl: null,
      historyMessages: 0,
      historyHydrated: false
    });

    const update = await fetch(`${base}/__live`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phase: 'completed',
        requestId: 'req-1',
        assistantText: 'CLIENT_SMOKE_OK',
        error: null,
        conversationUrl: 'https://chatgpt.com/c/abc',
        historyMessages: 5,
        historyHydrated: true
      })
    });
    assert.equal(update.status, 204);

    const live = await fetch(`${base}/__live`);
    assert.deepEqual(await live.json(), {
      phase: 'completed',
      requestId: 'req-1',
      assistantText: 'CLIENT_SMOKE_OK',
      error: null,
      conversationUrl: 'https://chatgpt.com/c/abc',
      historyMessages: 5,
      historyHydrated: true
    });

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('serves the local client, supports HEAD, and returns 404 for unknown paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgpt-web-driver-client-'));
  try {
    await mkdir(join(root, 'client'), { recursive: true });
    await mkdir(join(root, 'extension', 'dist', 'client'), { recursive: true });
    await writeFile(join(root, 'client', 'index.html'), '<h1>client</h1>');
    await writeFile(join(root, 'client', 'styles.css'), 'body{}');
    await writeFile(join(root, 'extension', 'dist', 'client', 'main.js'), 'console.log("client")');
    await writeFile(join(root, 'extension', 'dist', 'client', 'heartbeat.js'), 'export class BridgeHeartbeat {}');
    await writeFile(join(root, 'extension', 'dist', 'client', 'protocol.js'), 'export const CLIENT_SOURCE = "client"');
    await writeFile(join(root, 'extension', 'dist', 'client', 'state.js'), 'export const initialClientState = () => ({})');
    await writeFile(join(root, 'extension', 'dist', 'client', 'render-content.js'), 'export const renderSemanticDocument = () => {}');
    await writeFile(join(root, 'extension', 'dist', 'client', 'smoke.js'), 'export const smokePromptFromUrl = () => null');

    const server = createClientServer({ root });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), '<h1>client</h1>');

    const head = await fetch(`${base}/styles.css`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const protocol = await fetch(`${base}/protocol.js`);
    assert.equal(protocol.status, 200);
    assert.match(await protocol.text(), /CLIENT_SOURCE/);

    const missing = await fetch(`${base}/missing`);
    assert.equal(missing.status, 404);

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
