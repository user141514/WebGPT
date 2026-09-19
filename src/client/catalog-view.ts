import { parseChatGptRoute, type CatalogConversation, type ConversationCatalog } from '../catalog.js';

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

export function catalogGroups(catalog: ConversationCatalog): CatalogGroup[] {
  const standalone = catalog.conversations.filter((conversation) => !conversation.projectId);
  const grouped = new Map<string, CatalogConversation[]>();

  for (const conversation of catalog.conversations) {
    if (!conversation.projectId) continue;
    const list = grouped.get(conversation.projectId) ?? [];
    list.push(conversation);
    grouped.set(conversation.projectId, list);
  }

  const result: CatalogGroup[] = [];
  if (standalone.length) {
    result.push({
      id: 'standalone',
      title: 'Chats',
      conversations: standalone
    });
  }

  const indexedProjectIds = new Set<string>();
  for (const project of catalog.projects) {
    indexedProjectIds.add(project.projectId);
    result.push({
      id: project.projectId,
      title: project.title,
      projectId: project.projectId,
      conversations: grouped.get(project.projectId) ?? []
    });
  }

  for (const [projectId, conversations] of grouped) {
    if (indexedProjectIds.has(projectId)) continue;
    result.push({
      id: projectId,
      title: projectId,
      projectId,
      conversations
    });
  }

  return result;
}

export function conversationFromUrl(url: string, title?: string): CatalogConversation | null {
  const route = parseChatGptRoute(url);
  if (route?.kind !== 'conversation') return null;
  return {
    ...(route.projectId ? { projectId: route.projectId } : {}),
    conversationId: route.conversationId,
    title: title?.trim() || route.conversationId,
    url: route.url
  };
}

export function loadingCatalogGroupId(url: string | null | undefined): string | null {
  if (!url) return null;
  const conversation = conversationFromUrl(url);
  if (!conversation) return null;
  return conversation.projectId ?? 'standalone';
}

export function catalogGroupsWithLoading(
  catalog: ConversationCatalog,
  loadingUrl: string | null | undefined
): CatalogGroup[] {
  const groups = catalogGroups(catalog);
  const loadingId = loadingCatalogGroupId(loadingUrl);
  if (!loadingId || groups.some((group) => group.id === loadingId)) return groups;

  if (loadingId === 'standalone') {
    return [{ id: 'standalone', title: 'Chats', conversations: [] }, ...groups];
  }

  return [{
    id: loadingId,
    title: 'Binding project…',
    projectId: loadingId,
    conversations: []
  }, ...groups];
}

export function hasBoundConversation(url: string | null | undefined): boolean {
  return Boolean(url && conversationFromUrl(url));
}

export function conversationTarget(conversation: CatalogConversation): ConversationTarget {
  return {
    conversationId: conversation.url,
    externalUrl: conversation.url,
    title: conversation.title
  };
}

export function initialConversationUrl(clientUrl: string, storedUrl?: string | null): string | null {
  const explicit = requestedConversationUrl(clientUrl);
  if (explicit) return explicit;
  try {
    const fresh = new URL(clientUrl).searchParams.get('fresh') === '1';
    if (fresh) return null;
  } catch {
    return storedUrl?.trim() || null;
  }
  return storedUrl?.trim() || null;
}

export function requestedConversationUrl(clientUrl: string): string | null {
  try {
    const value = new URL(clientUrl).searchParams.get('conversation')?.trim() ?? '';
    return value || null;
  } catch {
    return null;
  }
}
