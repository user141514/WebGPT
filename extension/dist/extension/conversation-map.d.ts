import { type ConversationBinding } from './service-router.js';
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
export declare class ConversationBindingWriteQueue {
    private readonly pending;
    enqueue(conversationId: string, operation: () => Promise<void>): Promise<void>;
}
export declare class ConversationUrlMap {
    private readonly storage;
    constructor(storage: StorageAreaLike);
    load(conversationId: string): Promise<ConversationBinding | null>;
    save(conversationId: string, input: ConversationBindingInput): Promise<ConversationBinding>;
}
