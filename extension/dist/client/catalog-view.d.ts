import { type CatalogConversation, type ConversationCatalog } from '../catalog.js';
export interface CatalogGroup {
    id: string;
    title: string;
    projectId?: string;
    conversations: CatalogConversation[];
}
export interface ConversationTarget {
    conversationId: string;
    externalUrl: string;
    title: string;
}
export declare function catalogGroups(catalog: ConversationCatalog): CatalogGroup[];
export declare function conversationFromUrl(url: string, title?: string): CatalogConversation | null;
export declare function hasBoundConversation(url: string | null | undefined): boolean;
export declare function conversationTarget(conversation: CatalogConversation): ConversationTarget;
export declare function initialConversationUrl(clientUrl: string, storedUrl?: string | null): string | null;
export declare function requestedConversationUrl(clientUrl: string): string | null;
