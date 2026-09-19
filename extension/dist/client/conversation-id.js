const KEY = 'chatgpt-web-driver.conversation-id';
export function getOrCreateConversationId(storage, createId = () => crypto.randomUUID()) {
    const existing = storage.getItem(KEY)?.trim();
    if (existing)
        return existing;
    const created = createId().trim();
    if (!created)
        throw new Error('conversation id generator returned an empty value');
    storage.setItem(KEY, created);
    return created;
}
