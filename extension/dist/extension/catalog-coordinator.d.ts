import { type CatalogConversation, type ConversationCatalog } from '../catalog.js';
import { CatalogStore } from './catalog-store.js';
import type { CatalogProjectCandidate } from './catalog-dom.js';
export interface CatalogBrowser {
    create(url: string): Promise<number>;
    update(tabId: number, url: string): Promise<void>;
    waitReady(tabId: number): Promise<void>;
    listProjects(tabId: number): Promise<CatalogProjectCandidate[]>;
    openProject(tabId: number, candidate: CatalogProjectCandidate): Promise<string>;
    scan(tabId: number): Promise<ConversationCatalog>;
    remove(tabId: number): Promise<void>;
}
export declare class CatalogCoordinator {
    private readonly browser;
    private readonly store;
    constructor(browser: CatalogBrowser, store: CatalogStore);
    get(): Promise<ConversationCatalog>;
    refresh(seed?: ConversationCatalog, seedUrl?: string): Promise<ConversationCatalog>;
    resolve(url: string): Promise<CatalogConversation | null>;
}
