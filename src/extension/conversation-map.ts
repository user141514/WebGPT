import { chatGptPageUrl, chooseConversationUrl, type ConversationBinding } from './service-router.js';

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ConversationBindingInput {
  tabId: number;
  windowId?: number;
  url: string;
  fallbackUrl?: string;
}

const PREFIX = 'chatgpt-web-driver.conversation.';

export class ConversationBindingWriteQueue {
  private readonly pending = new Map<string, Promise<void>>();

  enqueue(conversationId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(conversationId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    this.pending.set(conversationId, task);
    void task.finally(() => {
      if (this.pending.get(conversationId) === task) this.pending.delete(conversationId);
    }).catch(() => {});
    return task;
  }
}

function keyFor(conversationId: string): string {
  return `${PREFIX}${conversationId}`;
}

function validBinding(value: unknown): ConversationBinding | null {
  if (!value || typeof value !== 'object') return null;
  const binding = value as Partial<ConversationBinding>;
  if (!Number.isInteger(binding.tabId)) return null;
  if (typeof binding.url !== 'string' || !binding.url) return null;
  if (!chatGptPageUrl(binding.url)) return null;
  const normalizedUrl = chooseConversationUrl(binding.url);
  return {
    tabId: binding.tabId as number,
    ...(Number.isInteger(binding.windowId) ? { windowId: binding.windowId as number } : {}),
    url: normalizedUrl
  };
}

export class ConversationUrlMap {
  private readonly storage: StorageAreaLike;

  constructor(storage: StorageAreaLike) {
    this.storage = storage;
  }

  async load(conversationId: string): Promise<ConversationBinding | null> {
    if (!conversationId) return null;
    const key = keyFor(conversationId);
    const stored = await this.storage.get(key);
    return validBinding(stored[key]);
  }

  async save(conversationId: string, input: ConversationBindingInput): Promise<ConversationBinding> {
    if (!conversationId) throw new Error('conversationId is required');
    if (!Number.isInteger(input.tabId)) throw new Error('tabId is required');

    const binding: ConversationBinding = {
      tabId: input.tabId,
      ...(Number.isInteger(input.windowId) ? { windowId: input.windowId } : {}),
      url: chooseConversationUrl(input.url, input.fallbackUrl)
    };
    await this.storage.set({ [keyFor(conversationId)]: binding });
    return binding;
  }
}
