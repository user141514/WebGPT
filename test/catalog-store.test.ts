import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogStore } from '../src/extension/catalog-store.ts';

class MemoryStorage {
  readonly data = new Map<string, unknown>();
  async get(key: string): Promise<Record<string, unknown>> {
    return this.data.has(key) ? { [key]: this.data.get(key) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }
}

test('persists only normalized project and conversation catalog metadata', async () => {
  const storage = new MemoryStorage();
  const store = new CatalogStore(storage);

  await store.save({
    projects: [{ projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' }],
    conversations: [{
      projectId: 'g-p-a',
      conversationId: 'c-1',
      title: 'Frenet control',
      url: 'https://chatgpt.com/g/g-p-a/c/c-1'
    }]
  });

  assert.deepEqual(await store.load(), {
    projects: [{ projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' }],
    conversations: [{
      projectId: 'g-p-a',
      conversationId: 'c-1',
      title: 'Frenet control',
      url: 'https://chatgpt.com/g/g-p-a/c/c-1'
    }]
  });
});

test('merges new snapshots into the stored catalog and upgrades placeholder titles', async () => {
  const storage = new MemoryStorage();
  const store = new CatalogStore(storage);

  await store.save({
    projects: [],
    conversations: [{ conversationId: 'c-1', title: 'c-1', url: 'https://chatgpt.com/c/c-1' }]
  });
  const merged = await store.merge({
    projects: [],
    conversations: [{ conversationId: 'c-1', title: 'Readable title', url: 'https://chatgpt.com/c/c-1' }]
  });

  assert.equal(merged.conversations[0]?.title, 'Readable title');
});

test('drops malformed or non-ChatGPT metadata from storage reads', async () => {
  const storage = new MemoryStorage();
  storage.data.set('chatgpt-web-driver.catalog.v1', {
    projects: [{ projectId: 'x', title: 'bad', url: 'https://example.com/g/x' }],
    conversations: [{ conversationId: 'c-1', title: 'ok', url: 'https://chatgpt.com/c/c-1' }]
  });

  const catalog = await new CatalogStore(storage).load();
  assert.deepEqual(catalog.projects, []);
  assert.deepEqual(catalog.conversations, [
    { conversationId: 'c-1', title: 'ok', url: 'https://chatgpt.com/c/c-1' }
  ]);
});
