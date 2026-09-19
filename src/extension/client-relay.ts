import {
  CLIENT_SOURCE,
  bridgeReadyMessage,
  extensionCatalogResultMessage,
  extensionConversationResultMessage,
  extensionDriverControlResultMessage,
  extensionProviderEventMessage,
  extensionSubmitResultMessage,
  isClientBridgeHelloMessage,
  parseClientCatalogRequest,
  parseClientConversationRequest,
  parseClientDriverControlMessage,
  parseClientSubmitMessage
} from '../client/protocol.js';

declare const chrome: any;

function postToPage(message: unknown): void {
  window.postMessage(message, location.origin);
}

async function announceReady(): Promise<void> {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'provider.ping' });
    if (result?.ready === true) postToPage(bridgeReadyMessage());
  } catch {
    // An invalidated or unavailable extension runtime is intentionally silent;
    // the page heartbeat will transition to disconnected.
  }
}

async function reportExtensionControl(requestId: string, payload: unknown): Promise<void> {
  await fetch(`/__extension-control?requestId=${encodeURIComponent(requestId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function runExtensionControlPage(): Promise<void> {
  const url = new URL(location.href);
  const requestId = url.searchParams.get('requestId')?.trim() ?? '';
  const op = url.searchParams.get('op')?.trim() ?? '';
  const expectedBuildId = url.searchParams.get('expectedBuildId')?.trim() ?? '';
  const beforeBuildId = url.searchParams.get('beforeBuildId')?.trim() ?? '';
  const beforeInstanceId = url.searchParams.get('beforeInstanceId')?.trim() ?? '';
  const requestedAt = Number(url.searchParams.get('requestedAt') ?? '0');
  const catalogUrl = url.searchParams.get('url')?.trim() ?? '';
  const catalogOps = new Set(['catalog.get', 'catalog.refresh', 'catalog.resolve', 'catalog.probe', 'catalog.inspect']);
  const conversationOps = new Set(['conversation.load', 'conversation.navigate', 'conversation.probe']);
  const controlOps = new Set(['watchdog.target', 'watchdog.candidates', 'client.open']);
  if (!requestId || (op !== 'status' && op !== 'reload' && op !== 'reload.verify' && !catalogOps.has(op) && !conversationOps.has(op) && !controlOps.has(op))) return;

  try {
    if (conversationOps.has(op)) {
      const result = await chrome.runtime.sendMessage({
        type: op,
        url: catalogUrl,
        ...(op === 'conversation.navigate'
          ? { fromUrl: url.searchParams.get('fromUrl')?.trim() || undefined }
          : {})
      });
      await reportExtensionControl(requestId, { state: 'conversation', result });
      void chrome.runtime.sendMessage({ type: 'extension.control.close' }).catch(() => {});
      return;
    }

    if (controlOps.has(op)) {
      const result = await chrome.runtime.sendMessage({ type: op });
      await reportExtensionControl(requestId, { state: op === 'client.open' ? 'client' : 'watchdog-target', result });
      void chrome.runtime.sendMessage({ type: 'extension.control.close' }).catch(() => {});
      return;
    }

    if (catalogOps.has(op)) {
      const result = await chrome.runtime.sendMessage({
        type: op,
        ...((op === 'catalog.resolve' || op === 'catalog.inspect') ? { url: catalogUrl } : {})
      });
      await reportExtensionControl(requestId, { state: 'catalog', result });
      void chrome.runtime.sendMessage({ type: 'extension.control.close' }).catch(() => {});
      return;
    }

    const result = await chrome.runtime.sendMessage({
      type: 'extension.control',
      op,
      requestId,
      ...(expectedBuildId ? { expectedBuildId } : {}),
      ...(beforeBuildId ? { beforeBuildId } : {}),
      ...(beforeInstanceId ? { beforeInstanceId } : {}),
      ...(Number.isFinite(requestedAt) && requestedAt > 0 ? { requestedAt } : {})
    });
    await reportExtensionControl(requestId, result);
    if (op === 'status' || op === 'reload.verify' || result?.state === 'failed') {
      void chrome.runtime.sendMessage({ type: 'extension.control.close' }).catch(() => {});
    }
  } catch (error) {
    await reportExtensionControl(requestId, {
      state: 'failed',
      requestId,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => {});
  }
}

function runtimeMessageForControl(requestId: string, op: string, payload: Record<string, unknown>): any {
  if (op.startsWith('extension.')) {
    return {
      type: 'extension.control',
      op: op.slice('extension.'.length),
      requestId,
      ...payload
    };
  }
  return { type: op, requestId, ...payload };
}

async function forwardDriverControl(requestId: string, op: string, payload: Record<string, unknown>): Promise<unknown> {
  return chrome.runtime.sendMessage(runtimeMessageForControl(requestId, op, payload));
}

async function reportDriverControlResult(requestId: string, result: unknown): Promise<void> {
  await fetch('/__driver-control/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, result })
  });
}

async function claimDriverControlCommand(): Promise<void> {
  const response = await fetch('/__driver-control/next', {
    headers: { 'cache-control': 'no-store' }
  });
  if (response.status === 204) return;
  if (!response.ok) throw new Error(`Driver control lease failed with HTTP ${response.status}`);

  const command = await response.json();
  const parsed = parseClientDriverControlMessage({
    source: CLIENT_SOURCE,
    type: 'driver.control',
    ...command
  });
  if (!parsed) return;

  await forwardDriverControl(parsed.requestId, parsed.op, parsed.payload)
    .then((result) => reportDriverControlResult(parsed.requestId, result))
    .catch((error) => reportDriverControlResult(parsed.requestId, {
      state: 'failed',
      error: error instanceof Error ? error.message : String(error)
    }));
}

function installDriverControlStream(): void {
  if (location.port !== '4317') return;

  // Keep one passive SSE connection so the local control server can report relay liveness.
  // Commands themselves use the lease endpoint below so multiple client tabs cannot execute
  // the same side effect.
  const stream = new EventSource('/__driver-control/events');
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      await claimDriverControlCommand();
    } catch {
      // Control-plane polling must not affect the interactive client.
    } finally {
      if (!stopped) globalThis.setTimeout(poll, 250);
    }
  };

  void poll();
  globalThis.addEventListener('pagehide', () => {
    stopped = true;
    stream.close();
  }, { once: true });
}

function installClientRelay(): void {
installDriverControlStream();
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (isClientBridgeHelloMessage(event.data)) {
    void announceReady();
    return;
  }

  const controlRequest = parseClientDriverControlMessage(event.data);
  if (controlRequest) {
    const { requestId, op, payload } = controlRequest;
    void forwardDriverControl(requestId, op, payload)
      .then((result: unknown) => postToPage(extensionDriverControlResultMessage(requestId, result)))
      .catch((error: unknown) => postToPage(extensionDriverControlResultMessage(requestId, {
        state: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })));
    return;
  }

  const conversationRequest = parseClientConversationRequest(event.data);
  if (conversationRequest) {
    void chrome.runtime.sendMessage({
      type: conversationRequest.type,
      url: conversationRequest.url,
      ...(conversationRequest.type === 'conversation.navigate' && conversationRequest.fromUrl
        ? { fromUrl: conversationRequest.fromUrl }
        : {})
    }).then((result: unknown) => {
      postToPage(extensionConversationResultMessage(conversationRequest.requestId, result as any));
    }).catch((error: unknown) => {
      postToPage(extensionConversationResultMessage(conversationRequest.requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    });
    return;
  }

  const catalogRequest = parseClientCatalogRequest(event.data);
  if (catalogRequest) {
    void chrome.runtime.sendMessage(catalogRequest)
      .then((result: unknown) => postToPage(extensionCatalogResultMessage(catalogRequest.requestId, result as any)))
      .catch((error: unknown) => postToPage(extensionCatalogResultMessage(catalogRequest.requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })));
    return;
  }

  const submit = parseClientSubmitMessage(event.data);
  if (!submit) return;

  void chrome.runtime.sendMessage({
    type: 'provider.submit',
    clientRequestId: submit.clientRequestId,
    conversationId: submit.conversationId,
    ...(submit.externalUrl ? { externalUrl: submit.externalUrl } : {}),
    text: submit.text
  }).then((result: unknown) => {
    postToPage(extensionSubmitResultMessage(submit.clientRequestId, result as any));
  }).catch((error: unknown) => {
    postToPage(extensionSubmitResultMessage(submit.clientRequestId, {
      started: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  });
});

chrome.runtime.onMessage.addListener((message: any, _sender: unknown, sendResponse: (value: unknown) => void) => {
  if (message?.type === 'client.ping') {
    sendResponse({ ready: true, externalUrl: location.href });
    return;
  }
  if (message?.type !== 'client.provider.event' || !message.envelope) return;
  postToPage(extensionProviderEventMessage(message.envelope));
});

void announceReady();
}

if (location.pathname === '/__extension-control.html') {
  void runExtensionControlPage();
} else {
  installClientRelay();
}
