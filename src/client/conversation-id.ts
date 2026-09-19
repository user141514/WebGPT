export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'chatgpt-web-driver.conversation-id';

export function getOrCreateConversationId(
  storage: SessionStorageLike,
  createId: () => string = () => crypto.randomUUID()
): string {
  const existing = storage.getItem(KEY)?.trim();
  if (existing) return existing;

  const created = createId().trim();
  if (!created) throw new Error('conversation id generator returned an empty value');
  storage.setItem(KEY, created);
  return created;
}
