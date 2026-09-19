import assert from 'node:assert/strict';
import test from 'node:test';
import * as publicApi from '../src/index.ts';
import {
  authoritativeConversationUrl,
  chatGptPageUrl,
  chatGptTabsInPriorityOrder,
  chooseConversationUrl,
  chooseChatGptTab,
  isChatGptUrl,
  providerEventEnvelope,
  stableConversationUrl,
  tabsForConversation,
  ProviderRequestGate,
  RequestRouteRegistry,
  sendToFirstResponsiveChatGptTab,
  type ProviderTab
} from '../src/index.ts';

test('accepts only HTTPS chatgpt.com pages as provider tabs', () => {
  assert.equal(isChatGptUrl('https://chatgpt.com/'), true);
  assert.equal(isChatGptUrl('https://chatgpt.com/c/abc'), true);
  assert.equal(isChatGptUrl('http://chatgpt.com/'), false);
  assert.equal(isChatGptUrl('https://example.com/chatgpt.com'), false);
  assert.equal(isChatGptUrl('not a url'), false);
});

test('canonicalizes stable conversation URLs like Watchdog and ignores transient path suffixes', () => {
  assert.equal(stableConversationUrl('https://chatgpt.com/c/abc?foo=bar'), 'https://chatgpt.com/c/abc');
  assert.equal(stableConversationUrl('https://chatgpt.com/c/abc/extra'), 'https://chatgpt.com/c/abc');
  assert.equal(
    stableConversationUrl('https://chatgpt.com/g/g-p-project/c/turn-1?x=1'),
    'https://chatgpt.com/g/g-p-project/c/turn-1'
  );
  assert.equal(stableConversationUrl('https://chatgpt.com/'), null);
  assert.equal(chatGptPageUrl('https://chatgpt.com/?model=x'), 'https://chatgpt.com/');
});

test('prefers stable conversation URLs over generic ChatGPT page fallbacks', () => {
  assert.equal(
    chooseConversationUrl('https://chatgpt.com/', 'https://chatgpt.com/c/existing'),
    'https://chatgpt.com/c/existing'
  );
  assert.equal(
    chooseConversationUrl('https://chatgpt.com/c/new?foo=1', 'https://chatgpt.com/c/old'),
    'https://chatgpt.com/c/new'
  );
});

test('scopes tab candidates to the mapped stable conversation and never reuses unrelated tabs for a new root conversation', () => {
  const tabs: ProviderTab[] = [
    { id: 1, url: 'https://chatgpt.com/c/other', active: true },
    { id: 2, url: 'https://chatgpt.com/c/target', active: false },
    { id: 3, url: 'https://chatgpt.com/c/target?foo=bar', active: true },
    { id: 4, url: 'https://chatgpt.com/', active: false }
  ];

  assert.deepEqual(
    tabsForConversation(tabs, { tabId: 99, url: 'https://chatgpt.com/c/target' }, 'https://chatgpt.com/c/target')
      .map((tab) => tab.id),
    [3, 2]
  );
  assert.deepEqual(tabsForConversation(tabs, null, 'https://chatgpt.com/'), []);
  assert.deepEqual(
    tabsForConversation(tabs, { tabId: 4, url: 'https://chatgpt.com/' }, 'https://chatgpt.com/').map((tab) => tab.id),
    [4]
  );
});

test('does not treat a pending navigation URL as the current conversation identity', () => {
  const tabs: ProviderTab[] = [
    {
      id: 7,
      url: 'https://chatgpt.com/c/conversation-a',
      pendingUrl: 'https://chatgpt.com/c/conversation-b',
      active: true
    }
  ];

  assert.deepEqual(
    tabsForConversation(
      tabs,
      { tabId: 7, url: 'https://chatgpt.com/c/conversation-b' },
      'https://chatgpt.com/c/conversation-b'
    ),
    []
  );
});

test('uses current tab.url as mapping authority before reported or pending URLs', () => {
  assert.equal(
    authoritativeConversationUrl(
      {
        id: 7,
        url: 'https://chatgpt.com/c/conversation-a',
        pendingUrl: 'https://chatgpt.com/c/conversation-b'
      },
      'https://chatgpt.com/c/conversation-b',
      'https://chatgpt.com/c/fallback'
    ),
    'https://chatgpt.com/c/conversation-a'
  );
  assert.equal(
    authoritativeConversationUrl({ id: 8 }, 'https://chatgpt.com/c/reported', 'https://chatgpt.com/c/fallback'),
    'https://chatgpt.com/c/reported'
  );
});

test('chooses the active ChatGPT tab and otherwise falls back to the first valid tab', () => {
  const tabs: ProviderTab[] = [
    { id: 1, url: 'https://example.com', active: true },
    { id: 2, url: 'https://chatgpt.com/c/old', active: false },
    { id: 3, url: 'https://chatgpt.com/c/current', active: true }
  ];

  assert.equal(chooseChatGptTab(tabs)?.id, 3);
  assert.equal(chooseChatGptTab(tabs.slice(0, 2))?.id, 2);
  assert.equal(chooseChatGptTab([{ id: 4, url: 'https://example.com' }]), null);
});

test('orders active ChatGPT tabs first while retaining stale-tab fallbacks', () => {
  const tabs: ProviderTab[] = [
    { id: 1, url: 'https://example.com', active: true },
    { id: 2, url: 'https://chatgpt.com/c/old', active: false },
    { id: 3, url: 'https://chatgpt.com/c/current', active: true },
    { id: 4, url: 'https://chatgpt.com/c/other', active: false }
  ];

  assert.deepEqual(chatGptTabsInPriorityOrder(tabs).map((tab) => tab.id), [3, 2, 4]);
});

test('chooses a sidebar navigation tab without ever requiring a new ChatGPT tab', () => {
  const chooseConversationNavigationTab = (publicApi as any).chooseConversationNavigationTab;
  assert.equal(typeof chooseConversationNavigationTab, 'function');

  const tabs: ProviderTab[] = [
    { id: 1, url: 'https://chatgpt.com/c/current', active: false },
    { id: 2, url: 'https://chatgpt.com/c/target', active: false },
    { id: 3, url: 'https://chatgpt.com/c/active', active: true }
  ];

  assert.equal(
    chooseConversationNavigationTab(
      tabs,
      { tabId: 1, url: 'https://chatgpt.com/c/current' },
      'https://chatgpt.com/c/target'
    )?.id,
    2
  );

  assert.equal(
    chooseConversationNavigationTab(
      tabs.filter((tab) => tab.id !== 2),
      { tabId: 1, url: 'https://chatgpt.com/c/current' },
      'https://chatgpt.com/c/target'
    )?.id,
    1
  );

  assert.equal(
    chooseConversationNavigationTab(
      tabs.filter((tab) => tab.id !== 1 && tab.id !== 2),
      null,
      'https://chatgpt.com/c/target'
    )?.id,
    3
  );

  assert.equal(
    chooseConversationNavigationTab(
      [{ id: 4, url: 'https://example.com', active: true }],
      null,
      'https://chatgpt.com/c/target'
    ),
    null
  );
});

test('targets only an already-open exact conversation tab and never falls back to unrelated ChatGPT tabs', async () => {
  const sendToExistingConversationTab = (publicApi as any).sendToExistingConversationTab;
  assert.equal(typeof sendToExistingConversationTab, 'function');
  const attempts: number[] = [];
  const tabs: ProviderTab[] = [
    { id: 1, url: 'https://chatgpt.com/c/other', active: true },
    { id: 2, url: 'https://chatgpt.com/c/target', active: false }
  ];

  const selected = await sendToExistingConversationTab(
    tabs,
    null,
    'https://chatgpt.com/c/target',
    async (tab: ProviderTab) => {
      attempts.push(tab.id!);
      return { ok: true };
    }
  );
  assert.deepEqual(attempts, [2]);
  assert.equal(selected.tab.id, 2);

  await assert.rejects(
    () => sendToExistingConversationTab(
      [{ id: 3, url: 'https://chatgpt.com/c/other', active: true }],
      null,
      'https://chatgpt.com/c/missing',
      async () => ({ ok: true })
    ),
    /already be open/i
  );
});

test('reattaches the same exact conversation tab once before reporting it disconnected', async () => {
  const sendToExistingConversationTab = (publicApi as any).sendToExistingConversationTab;
  const tabs: ProviderTab[] = [{ id: 7, url: 'https://chatgpt.com/c/target', active: true }];
  const attempts: string[] = [];
  let connected = false;

  const selected = await sendToExistingConversationTab(
    tabs,
    null,
    'https://chatgpt.com/c/target',
    async (tab: ProviderTab) => {
      attempts.push(`send:${tab.id}`);
      if (!connected) throw new Error('Receiving end does not exist');
      return { ok: true };
    },
    async (tab: ProviderTab) => {
      attempts.push(`reattach:${tab.id}`);
      connected = true;
    }
  );

  assert.equal(selected.tab.id, 7);
  assert.deepEqual(attempts, ['send:7', 'reattach:7', 'send:7']);
});

test('keeps continuous sends pinned to the stored bound tab even when another exact-URL duplicate exists', async () => {
  const sendToBoundConversationTab = (publicApi as any).sendToBoundConversationTab;
  assert.equal(typeof sendToBoundConversationTab, 'function');
  const attempts: number[] = [];
  const tabs: ProviderTab[] = [
    { id: 3, url: 'https://chatgpt.com/c/target', active: true },
    { id: 2, url: 'https://chatgpt.com/c/target', active: false }
  ];

  const selected = await sendToBoundConversationTab(
    tabs,
    { tabId: 2, url: 'https://chatgpt.com/c/target' },
    'https://chatgpt.com/c/target',
    async (tab: ProviderTab) => {
      attempts.push(tab.id!);
      return { ok: true };
    }
  );

  assert.equal(selected.tab.id, 2);
  assert.deepEqual(attempts, [2]);
});

test('fails instead of drifting to a duplicate when the stored bound tab is gone or navigated away', async () => {
  const sendToBoundConversationTab = (publicApi as any).sendToBoundConversationTab;
  const attempts: number[] = [];
  await assert.rejects(
    () => sendToBoundConversationTab(
      [{ id: 3, url: 'https://chatgpt.com/c/target', active: true }],
      { tabId: 2, url: 'https://chatgpt.com/c/target' },
      'https://chatgpt.com/c/target',
      async (tab: ProviderTab) => {
        attempts.push(tab.id!);
        return { ok: true };
      }
    ),
    /re-bind/i
  );
  assert.deepEqual(attempts, []);
});

test('skips ChatGPT tabs without a receiving content script and uses the first responsive tab', async () => {
  const attempts: number[] = [];
  const tabs: ProviderTab[] = [
    { id: 2, url: 'https://chatgpt.com/c/stale', active: true },
    { id: 3, url: 'https://chatgpt.com/c/live', active: false }
  ];

  const selected = await sendToFirstResponsiveChatGptTab(tabs, async (tab) => {
    attempts.push(tab.id!);
    if (tab.id === 2) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { started: true };
  });

  assert.deepEqual(attempts, [2, 3]);
  assert.equal(selected.tab.id, 3);
  assert.deepEqual(selected.result, { started: true });
});

test('does not retry another ChatGPT tab after a responsive tab returns a business rejection', async () => {
  const attempts: number[] = [];
  const tabs: ProviderTab[] = [
    { id: 2, url: 'https://chatgpt.com/c/current', active: true },
    { id: 3, url: 'https://chatgpt.com/c/other', active: false }
  ];

  const selected = await sendToFirstResponsiveChatGptTab(tabs, async (tab) => {
    attempts.push(tab.id!);
    return { started: false, error: 'Prompt editor missing' };
  });

  assert.deepEqual(attempts, [2]);
  assert.equal(selected.tab.id, 2);
  assert.deepEqual(selected.result, { started: false, error: 'Prompt editor missing' });
});

test('binds request ids to provider tab, client tab, logical conversation, and client request', () => {
  const routes = new RequestRouteRegistry();
  routes.bind('req-1', 10, 20, 'conversation-1', 'local-1');

  assert.equal(routes.acceptsProviderEvent('req-1', 10), true);
  assert.equal(routes.acceptsProviderEvent('req-1', 11), false);
  assert.equal(routes.acceptsProviderEvent('unknown', 10), false);
  assert.equal(routes.clientTabId('req-1'), 20);
  assert.equal(routes.conversationId('req-1'), 'conversation-1');
  assert.equal((routes as any).clientRequestId('req-1'), 'local-1');

  routes.release('req-1');
  assert.equal(routes.acceptsProviderEvent('req-1', 10), false);
  assert.equal(routes.clientTabId('req-1'), null);
  assert.equal(routes.conversationId('req-1'), null);
  assert.equal((routes as any).clientRequestId('req-1'), null);
});

test('enforces one provider request across submitting and active phases', () => {
  const gate = new ProviderRequestGate();

  assert.equal(gate.begin(), true);
  assert.equal(gate.begin(), false);
  assert.equal(gate.activate('req-1'), true);
  assert.equal(gate.begin(), false);
  assert.equal(gate.release('wrong'), false);
  assert.equal(gate.begin(), false);
  assert.equal(gate.release('req-1'), true);
  assert.equal(gate.begin(), true);
});

test('reopens the provider gate when a submission aborts before activation', () => {
  const gate = new ProviderRequestGate();

  assert.equal(gate.begin(), true);
  gate.abort();
  assert.equal(gate.begin(), true);
});

test('persists provider bindings only at lifecycle boundaries, not for streaming snapshots', () => {
  const shouldPersistProviderBinding = (publicApi as any).shouldPersistProviderBinding;
  assert.equal(typeof shouldPersistProviderBinding, 'function');
  assert.equal(shouldPersistProviderBinding({ type: 'request.accepted' }), true);
  assert.equal(shouldPersistProviderBinding({ type: 'assistant.status', status: 'generating' }), false);
  assert.equal(shouldPersistProviderBinding({ type: 'assistant.snapshot', text: 'partial' }), false);
  assert.equal(shouldPersistProviderBinding({ type: 'assistant.completed', text: 'done' }), true);
  assert.equal(shouldPersistProviderBinding({ type: 'provider.error', message: 'failed' }), true);
});

test('wraps driver events without changing their semantic payload', () => {
  const event = { type: 'assistant.snapshot' as const, text: 'partial' };
  assert.deepEqual(providerEventEnvelope('req-1', event, 7, 'local-1'), {
    type: 'provider.event',
    requestId: 'req-1',
    clientRequestId: 'local-1',
    event,
    tabId: 7
  });
});
