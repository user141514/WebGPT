import assert from 'node:assert/strict';
import test from 'node:test';
import { getOrCreateConversationId } from '../src/client/conversation-id.ts';

class MemorySessionStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('reuses the same logical conversation id across client reloads in one tab', () => {
  const storage = new MemorySessionStorage();
  let generated = 0;
  const createId = () => `conversation-${++generated}`;

  assert.equal(getOrCreateConversationId(storage, createId), 'conversation-1');
  assert.equal(getOrCreateConversationId(storage, createId), 'conversation-1');
  assert.equal(generated, 1);
});

test('replaces an empty stored conversation id instead of emitting an unusable mapping key', () => {
  const storage = new MemorySessionStorage();
  storage.setItem('chatgpt-web-driver.conversation-id', '');

  assert.equal(getOrCreateConversationId(storage, () => 'conversation-new'), 'conversation-new');
});
