import {
  mergeCatalogs,
  parseChatGptRoute,
  type CatalogConversation,
  type CatalogProject,
  type ConversationCatalog
} from '../catalog.js';
import type { StorageAreaLike } from './conversation-map.js';

const CATALOG_KEY = 'chatgpt-web-driver.catalog.v1';

function normalizeProject(value: unknown): CatalogProject | null {
  if (!value || typeof value !== 'object') return null;
  const project = value as Partial<CatalogProject>;
  if (typeof project.url !== 'string' || typeof project.title !== 'string') return null;
  const route = parseChatGptRoute(project.url);
  if (route?.kind !== 'project') return null;
  return {
    projectId: route.projectId,
    title: project.title.trim() || route.projectId,
    url: route.url
  };
}

function normalizeConversation(value: unknown): CatalogConversation | null {
  if (!value || typeof value !== 'object') return null;
  const conversation = value as Partial<CatalogConversation>;
  if (typeof conversation.url !== 'string' || typeof conversation.title !== 'string') return null;
  const route = parseChatGptRoute(conversation.url);
  if (route?.kind !== 'conversation') return null;
  return {
    ...(route.projectId ? { projectId: route.projectId } : {}),
    conversationId: route.conversationId,
    title: conversation.title.trim() || route.conversationId,
    url: route.url
  };
}

function normalizeCatalog(value: unknown): ConversationCatalog {
  if (!value || typeof value !== 'object') return { projects: [], conversations: [] };
  const catalog = value as Partial<ConversationCatalog>;
  const projects = Array.isArray(catalog.projects)
    ? catalog.projects.map(normalizeProject).filter((item): item is CatalogProject => item !== null)
    : [];
  const conversations = Array.isArray(catalog.conversations)
    ? catalog.conversations.map(normalizeConversation).filter((item): item is CatalogConversation => item !== null)
    : [];
  return mergeCatalogs({ projects, conversations });
}

export class CatalogStore {
  private readonly storage: StorageAreaLike;

  constructor(storage: StorageAreaLike) {
    this.storage = storage;
  }

  async load(): Promise<ConversationCatalog> {
    const stored = await this.storage.get(CATALOG_KEY);
    return normalizeCatalog(stored[CATALOG_KEY]);
  }

  async save(catalog: ConversationCatalog): Promise<ConversationCatalog> {
    const normalized = normalizeCatalog(catalog);
    await this.storage.set({ [CATALOG_KEY]: normalized });
    return normalized;
  }

  async merge(catalog: ConversationCatalog): Promise<ConversationCatalog> {
    const merged = mergeCatalogs(await this.load(), normalizeCatalog(catalog));
    await this.storage.set({ [CATALOG_KEY]: merged });
    return merged;
  }
}
