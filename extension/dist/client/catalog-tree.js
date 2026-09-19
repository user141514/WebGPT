export function defaultExpandedCatalogGroups(groups, activeConversationUrl) {
    return ensureActiveCatalogGroupExpanded(new Set(), groups, activeConversationUrl);
}
export function toggleCatalogGroup(expanded, groupId) {
    const next = new Set(expanded);
    if (next.has(groupId))
        next.delete(groupId);
    else
        next.add(groupId);
    return next;
}
export function ensureActiveCatalogGroupExpanded(expanded, groups, activeConversationUrl) {
    const next = new Set(expanded);
    if (!activeConversationUrl)
        return next;
    const activeGroup = groups.find((group) => group.conversations.some((conversation) => conversation.url === activeConversationUrl));
    if (activeGroup)
        next.add(activeGroup.id);
    return next;
}
export function normalizeExpandedCatalogGroups(expanded, groups) {
    const valid = new Set(groups.map((group) => group.id));
    return new Set([...expanded].filter((groupId) => valid.has(groupId)));
}
export function serializeExpandedCatalogGroups(expanded) {
    return JSON.stringify([...expanded]);
}
export function parseExpandedCatalogGroups(value) {
    if (!value)
        return new Set();
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return new Set();
        return new Set(parsed.filter((item) => typeof item === 'string' && item.trim().length > 0));
    }
    catch {
        return new Set();
    }
}
