import { type ConversationCatalog } from '../catalog.js';
import type { StorageAreaLike } from './conversation-map.js';
export declare class CatalogStore {
    private readonly storage;
    constructor(storage: StorageAreaLike);
    load(): Promise<ConversationCatalog>;
    save(catalog: ConversationCatalog): Promise<ConversationCatalog>;
    merge(catalog: ConversationCatalog): Promise<ConversationCatalog>;
}
