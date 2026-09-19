import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_SOURCE,
  EXTENSION_SOURCE,
  bridgeReadyMessage,
  clientBridgeHelloMessage,
  isClientBridgeHelloMessage,
  extensionCatalogResultMessage,
  extensionConversationResultMessage,
  extensionDriverControlResultMessage,
  extensionProviderEventMessage,
  extensionSubmitResultMessage,
  parseClientCatalogRequest,
  parseClientConversationRequest,
  parseClientDriverControlMessage,
  parseClientSubmitMessage
} from '../src/client/protocol.ts';

test('accepts only the exact local client submit envelope', () => {
  assert.deepEqual(parseClientSubmitMessage({
    source: CLIENT_SOURCE,
    type: 'provider.submit',
    clientRequestId: 'local-1',
    conversationId: 'conversation-1',
    externalUrl: 'https://chatgpt.com/c/abc',
    text: 'hello'
  }), {
    clientRequestId: 'local-1',
    conversationId: 'conversation-1',
    externalUrl: 'https://chatgpt.com/c/abc',
    text: 'hello'
  });

  assert.equal(parseClientSubmitMessage({
    source: 'untrusted',
    type: 'provider.submit',
    clientRequestId: 'local-1',
    conversationId: 'conversation-1',
    text: 'hello'
  }), null);
  assert.equal(parseClientSubmitMessage({
    source: CLIENT_SOURCE,
    type: 'provider.submit',
    clientRequestId: 'local-1',
    text: 'hello'
  }), null);
  assert.equal(parseClientSubmitMessage({
    source: CLIENT_SOURCE,
    type: 'provider.submit',
    clientRequestId: 'local-1',
    conversationId: 'conversation-1',
    text: '   '
  }), null);
});

test('accepts only bounded localhost driver control envelopes', () => {
  assert.deepEqual(parseClientDriverControlMessage({
    source: CLIENT_SOURCE,
    type: 'driver.control',
    requestId: 'ctl-1',
    op: 'extension.status',
    payload: { expectedBuildId: 'x' }
  }), {
    requestId: 'ctl-1',
    op: 'extension.status',
    payload: { expectedBuildId: 'x' }
  });

  assert.deepEqual(parseClientDriverControlMessage({
    source: CLIENT_SOURCE,
    type: 'driver.control',
    requestId: 'ctl-inspect',
    op: 'catalog.inspect',
    payload: { url: 'https://chatgpt.com/g/g-p-a' }
  }), {
    requestId: 'ctl-inspect',
    op: 'catalog.inspect',
    payload: { url: 'https://chatgpt.com/g/g-p-a' }
  });

  assert.deepEqual(parseClientDriverControlMessage({
    source: CLIENT_SOURCE,
    type: 'driver.control',
    requestId: 'ctl-client-open',
    op: 'client.open',
    payload: { fresh: true }
  }), {
    requestId: 'ctl-client-open',
    op: 'client.open',
    payload: { fresh: true }
  });

  assert.equal(parseClientDriverControlMessage({
    source: CLIENT_SOURCE,
    type: 'driver.control',
    requestId: 'ctl-2',
    op: 'dangerous.unknown'
  }), null);
});

test('wraps driver control results for the localhost page boundary', () => {
  assert.deepEqual(extensionDriverControlResultMessage('ctl-1', { state: 'status' }), {
    source: EXTENSION_SOURCE,
    type: 'driver.control.result',
    requestId: 'ctl-1',
    result: { state: 'status' }
  });
});

test('uses an explicit page hello handshake so bridge readiness cannot be missed at startup', () => {
  const hello = clientBridgeHelloMessage();
  assert.deepEqual(hello, {
    source: CLIENT_SOURCE,
    type: 'bridge.hello'
  });
  assert.equal(isClientBridgeHelloMessage(hello), true);
  assert.equal(isClientBridgeHelloMessage({ source: 'other', type: 'bridge.hello' }), false);
});

test('builds bridge-ready and submit-result messages for the page boundary', () => {
  assert.deepEqual(bridgeReadyMessage(), {
    source: EXTENSION_SOURCE,
    type: 'bridge.ready'
  });

  assert.deepEqual(extensionSubmitResultMessage('local-1', {
    started: true,
    requestId: 'req-1'
  }), {
    source: EXTENSION_SOURCE,
    type: 'submit.result',
    clientRequestId: 'local-1',
    result: {
      started: true,
      requestId: 'req-1'
    }
  });
});

test('parses catalog get, refresh, and resolve requests and rejects malformed URL resolution', () => {
  assert.deepEqual(parseClientCatalogRequest({
    source: CLIENT_SOURCE,
    type: 'catalog.get',
    requestId: 'cat-1'
  }), { type: 'catalog.get', requestId: 'cat-1' });

  assert.deepEqual(parseClientCatalogRequest({
    source: CLIENT_SOURCE,
    type: 'catalog.refresh',
    requestId: 'cat-2'
  }), { type: 'catalog.refresh', requestId: 'cat-2' });

  assert.deepEqual(parseClientCatalogRequest({
    source: CLIENT_SOURCE,
    type: 'catalog.resolve',
    requestId: 'cat-3',
    url: 'https://chatgpt.com/c/abc'
  }), { type: 'catalog.resolve', requestId: 'cat-3', url: 'https://chatgpt.com/c/abc' });

  assert.equal(parseClientCatalogRequest({
    source: CLIENT_SOURCE,
    type: 'catalog.resolve',
    requestId: 'cat-4',
    url: '   '
  }), null);
});

test('parses direct bind and sidebar navigation conversation requests', () => {
  assert.deepEqual(parseClientConversationRequest({
    source: CLIENT_SOURCE,
    type: 'conversation.load',
    requestId: 'conv-load-1',
    url: 'https://chatgpt.com/c/abc'
  }), {
    type: 'conversation.load',
    requestId: 'conv-load-1',
    url: 'https://chatgpt.com/c/abc'
  });

  assert.deepEqual(parseClientConversationRequest({
    source: CLIENT_SOURCE,
    type: 'conversation.navigate',
    requestId: 'conv-nav-1',
    url: 'https://chatgpt.com/c/next',
    fromUrl: 'https://chatgpt.com/c/current'
  }), {
    type: 'conversation.navigate',
    requestId: 'conv-nav-1',
    url: 'https://chatgpt.com/c/next',
    fromUrl: 'https://chatgpt.com/c/current'
  });

  assert.equal(parseClientConversationRequest({
    source: CLIENT_SOURCE,
    type: 'conversation.load',
    requestId: 'conv-load-2',
    url: '   '
  }), null);
});

test('wraps conversation snapshots for the page boundary', () => {
  const snapshot = {
    url: 'https://chatgpt.com/c/abc',
    title: 'Example',
    turns: [{ role: 'user' as const, text: 'hello' }]
  };
  assert.deepEqual(extensionConversationResultMessage('conv-load-1', {
    ok: true,
    snapshot
  }), {
    source: EXTENSION_SOURCE,
    type: 'conversation.result',
    requestId: 'conv-load-1',
    result: { ok: true, snapshot }
  });
});

test('wraps catalog responses for the page boundary', () => {
  const catalog = {
    projects: [{ projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' }],
    conversations: [{ conversationId: 'c-1', title: 'Chat', url: 'https://chatgpt.com/c/c-1' }]
  };
  assert.deepEqual(extensionCatalogResultMessage('cat-1', {
    ok: true,
    catalog,
    entry: catalog.conversations[0]
  }), {
    source: EXTENSION_SOURCE,
    type: 'catalog.result',
    requestId: 'cat-1',
    result: {
      ok: true,
      catalog,
      entry: catalog.conversations[0]
    }
  });
});

test('forwards provider events without converting snapshots into deltas', () => {
  const envelope = {
    type: 'provider.event' as const,
    requestId: 'req-1',
    clientRequestId: 'local-1',
    event: { type: 'assistant.snapshot' as const, text: 'full current snapshot' },
    tabId: 7
  };

  assert.deepEqual(extensionProviderEventMessage(envelope), {
    source: EXTENSION_SOURCE,
    type: 'provider.event',
    requestId: 'req-1',
    clientRequestId: 'local-1',
    event: envelope.event
  });
});
