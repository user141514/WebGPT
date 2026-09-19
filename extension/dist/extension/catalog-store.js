import { mergeCatalogs, parseChatGptRoute } from '../catalog.js';
const CATALOG_KEY = 'chatgpt-web-driver.catalog.v1';
function normalizeProject(value) {
    if (!value || typeof value !== 'object')
        return null;
    const project = value;
    if (typeof project.url !== 'string' || typeof project.title !== 'string')
        return null;
    const route = parseChatGptRoute(project.url);
    if (route?.kind !== 'project')
        return null;
    return {
        projectId: route.projectId,
        title: project.title.trim() || route.projectId,
        url: route.url
    };
}
function normalizeConversation(value) {
    if (!value || typeof value !== 'object')
        return null;
    const conversation = value;
    if (typeof conversation.url !== 'string' || typeof conversation.title !== 'string')
        return null;
    const route = parseChatGptRoute(conversation.url);
    if (route?.kind !== 'conversation')
        return null;
    return {
        ...(route.projectId ? { projectId: route.projectId } : {}),
        conversationId: route.conversationId,
        title: conversation.title.trim() || route.conversationId,
        url: route.url
    };
}
function normalizeCatalog(value) {
    if (!value || typeof value !== 'object')
        return { projects: [], conversations: [] };
    const catalog = value;
    const projects = Array.isArray(catalog.projects)
        ? catalog.projects.map(normalizeProject).filter((item) => item !== null)
        : [];
    const conversations = Array.isArray(catalog.conversations)
        ? catalog.conversations.map(normalizeConversation).filter((item) => item !== null)
        : [];
    return mergeCatalogs({ projects, conversations });
}
export class CatalogStore {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    async load() {
        const stored = await this.storage.get(CATALOG_KEY);
        return normalizeCatalog(stored[CATALOG_KEY]);
    }
    async save(catalog) {
        const normalized = normalizeCatalog(catalog);
        await this.storage.set({ [CATALOG_KEY]: normalized });
        return normalized;
    }
    async merge(catalog) {
        const merged = mergeCatalogs(await this.load(), normalizeCatalog(catalog));
        await this.storage.set({ [CATALOG_KEY]: merged });
        return merged;
    }
}
