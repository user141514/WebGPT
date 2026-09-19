export interface SessionStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export declare function getOrCreateConversationId(storage: SessionStorageLike, createId?: () => string): string;
