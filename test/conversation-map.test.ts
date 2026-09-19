import assert from 'node:assert/strict';
import test from 'node:test';
import * as conversationMapApi from '../src/extension/conversation-map.ts';

const { ConversationUrlMap } = conversationMapApi;

class MemoryStorage {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.values[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

test('serializes binding persistence by conversation identity across request boundaries', async () => {
  const ConversationBindingWriteQueue = (conversationMapApi as any).ConversationBindingWriteQueue;
  assert.equal(typeof ConversationBindingWriteQueue, 'function');
  const queue = new ConversationBindingWriteQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

  const first = queue.enqueue('conversation-1', async () => {
    order.push('first-start');
    markFirstStarted();
    await firstBlocked;
    order.push('first-end');
  });
  const second = queue.enqueue('conversation-1', async () => {
    order.push('second-start');
    order.push('second-end');
  });

  await firstStarted;
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('persists a logical conversation to a canonical ChatGPT URL and tab', async () => {
  const storage = new MemoryStorage();
  const map = new ConversationUrlMap(storage);

  await map.save('conversation-1', {
    tabId: 11,
    windowId: 7,
    url: 'https://chatgpt.com/c/abc?model=x'
  });

  assert.deepEqual(await map.load('conversation-1'), {
    tabId: 11,
    windowId: 7,
    url: 'https://chatgpt.com/c/abc'
  });
});

test('falls back to the previous stable URL when a transient root URL is observed', async () => {
  const storage = new MemoryStorage();
  const map = new ConversationUrlMap(storage);

  await map.save('conversation-1', {
    tabId: 11,
    url: 'https://chatgpt.com/c/abc'
  });
  await map.save('conversation-1', {
    tabId: 12,
    url: 'https://chatgpt.com/',
    fallbackUrl: 'https://chatgpt.com/c/abc'
  });

  assert.deepEqual(await map.load('conversation-1'), {
    tabId: 12,
    url: 'https://chatgpt.com/c/abc'
  });
});

test('ignores malformed stored bindings instead of trusting stale storage', async () => {
  const storage = new MemoryStorage();
  storage.values['chatgpt-web-driver.conversation.conversation-1'] = {
    tabId: 'bad',
    url: 'https://example.com/'
  };
  const map = new ConversationUrlMap(storage);

  assert.equal(await map.load('conversation-1'), null);
});
