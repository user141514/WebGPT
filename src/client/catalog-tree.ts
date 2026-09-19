import type { CatalogGroup } from './catalog-view.js';

export function defaultExpandedCatalogGroups(
  groups: CatalogGroup[],
  activeConversationUrl: string | null
): Set<string> {
  return ensureActiveCatalogGroupExpanded(new Set<string>(), groups, activeConversationUrl);
}

export function toggleCatalogGroup(
  expanded: ReadonlySet<string>,
  groupId: string
): Set<string> {
  const next = new Set(expanded);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  return next;
}

export function ensureActiveCatalogGroupExpanded(
  expanded: ReadonlySet<string>,
  groups: CatalogGroup[],
  activeConversationUrl: string | null
): Set<string> {
  const next = new Set(expanded);
  if (!activeConversationUrl) return next;
  const activeGroup = groups.find((group) =>
    group.conversations.some((conversation) => conversation.url === activeConversationUrl)
  );
  if (activeGroup) next.add(activeGroup.id);
  return next;
}

export function normalizeExpandedCatalogGroups(
  expanded: ReadonlySet<string>,
  groups: CatalogGroup[]
): Set<string> {
  const valid = new Set(groups.map((group) => group.id));
  return new Set([...expanded].filter((groupId) => valid.has(groupId)));
}

export function serializeExpandedCatalogGroups(expanded: ReadonlySet<string>): string {
  return JSON.stringify([...expanded]);
}

export function parseExpandedCatalogGroups(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
  } catch {
    return new Set();
  }
}
