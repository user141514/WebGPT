import { chatGptPageUrl, chooseConversationUrl } from './service-router.js';
const PREFIX = 'chatgpt-web-driver.conversation.';
export class ConversationBindingWriteQueue {
    pending = new Map();
    enqueue(conversationId, operation) {
        const previous = this.pending.get(conversationId) ?? Promise.resolve();
        const task = previous.catch(() => { }).then(operation);
        this.pending.set(conversationId, task);
        void task.finally(() => {
            if (this.pending.get(conversationId) === task)
                this.pending.delete(conversationId);
        }).catch(() => { });
        return task;
    }
}
function keyFor(conversationId) {
    return `${PREFIX}${conversationId}`;
}
function validBinding(value) {
    if (!value || typeof value !== 'object')
        return null;
    const binding = value;
    if (!Number.isInteger(binding.tabId))
        return null;
    if (typeof binding.url !== 'string' || !binding.url)
        return null;
    if (!chatGptPageUrl(binding.url))
        return null;
    const normalizedUrl = chooseConversationUrl(binding.url);
    return {
        tabId: binding.tabId,
        ...(Number.isInteger(binding.windowId) ? { windowId: binding.windowId } : {}),
        url: normalizedUrl
    };
}
export class ConversationUrlMap {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    async load(conversationId) {
        if (!conversationId)
            return null;
        const key = keyFor(conversationId);
        const stored = await this.storage.get(key);
        return validBinding(stored[key]);
    }
    async save(conversationId, input) {
        if (!conversationId)
            throw new Error('conversationId is required');
        if (!Number.isInteger(input.tabId))
            throw new Error('tabId is required');
        const binding = {
            tabId: input.tabId,
            ...(Number.isInteger(input.windowId) ? { windowId: input.windowId } : {}),
            url: chooseConversationUrl(input.url, input.fallbackUrl)
        };
        await this.storage.set({ [keyFor(conversationId)]: binding });
        return binding;
    }
}
