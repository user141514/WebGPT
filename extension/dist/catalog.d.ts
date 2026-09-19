export interface CatalogCandidate {
    href: string;
    text?: string;
    ariaLabel?: string;
    title?: string;
}
export interface CatalogProject {
    projectId: string;
    title: string;
    url: string;
}
export interface CatalogConversation {
    projectId?: string;
    conversationId: string;
    title: string;
    url: string;
}
export interface ConversationCatalog {
    projects: CatalogProject[];
    conversations: CatalogConversation[];
}
export type ChatGptRoute = {
    kind: 'project';
    projectId: string;
    projectSlug?: string;
    url: string;
} | {
    kind: 'conversation';
    projectId?: string;
    conversationId: string;
    projectUrl?: string;
    url: string;
};
export declare function parseChatGptRoute(value: string, baseUrl?: string): ChatGptRoute | null;
export declare function catalogKeyForUrl(value: string): string | null;
export declare function catalogFromCandidates(input: {
    baseUrl: string;
    candidates: CatalogCandidate[];
    documentTitle?: string;
}): ConversationCatalog;
export declare function mergeCatalogs(...catalogs: ConversationCatalog[]): ConversationCatalog;
