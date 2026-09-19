import { type CatalogCandidate, type ConversationCatalog } from '../catalog.js';
export interface CatalogScanOptions {
    sleep?: (ms: number) => Promise<void>;
    getOverflowY?: (element: Element) => string;
    maxSteps?: number;
    maxExpandSteps?: number;
    settleMs?: number;
}
export interface CatalogProjectCandidate {
    index: number;
    title: string;
    actionLabel?: string;
}
export declare function projectCandidatesFromDocument(document: Document): CatalogProjectCandidate[];
export declare function activateProjectCandidate(document: Document, candidate: CatalogProjectCandidate): boolean;
export interface CatalogInteractiveSample {
    tag: string;
    text?: string;
    ariaLabel?: string;
    title?: string;
    role?: string;
    dataTestId?: string;
    href?: string;
}
export interface CatalogProbe {
    pageUrl: string;
    documentTitle: string;
    totalAnchors: number;
    catalogAnchors: number;
    projects: number;
    conversations: number;
    projectCandidates: CatalogProjectCandidate[];
    samples: CatalogCandidate[];
    interactiveSamples: CatalogInteractiveSample[];
}
export declare function catalogProbeFromDocument(document: Document, baseUrl: string, sampleLimit?: number): CatalogProbe;
export declare function catalogSnapshotFromDocument(document: Document, baseUrl: string): ConversationCatalog;
export declare function scanCatalogDocument(document: Document, baseUrl: string, options?: CatalogScanOptions): Promise<ConversationCatalog>;
