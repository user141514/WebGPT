import type { CatalogGroup } from './catalog-view.js';
export declare function defaultExpandedCatalogGroups(groups: CatalogGroup[], activeConversationUrl: string | null): Set<string>;
export declare function toggleCatalogGroup(expanded: ReadonlySet<string>, groupId: string): Set<string>;
export declare function ensureActiveCatalogGroupExpanded(expanded: ReadonlySet<string>, groups: CatalogGroup[], activeConversationUrl: string | null): Set<string>;
export declare function normalizeExpandedCatalogGroups(expanded: ReadonlySet<string>, groups: CatalogGroup[]): Set<string>;
export declare function serializeExpandedCatalogGroups(expanded: ReadonlySet<string>): string;
export declare function parseExpandedCatalogGroups(value: string | null): Set<string>;
