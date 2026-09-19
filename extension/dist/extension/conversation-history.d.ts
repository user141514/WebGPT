import type { SemanticDocument } from '../content/model.js';
import type { ConversationSnapshot } from '../conversation-snapshot.js';
export interface ConversationHistoryRecord {
    messageId: string;
    turnIndex: number | null;
    turnTestId: string | null;
    role: 'user' | 'assistant';
    text: string;
    document?: SemanticDocument;
    markdown?: string;
}
export interface ConversationHistoryScanMeta {
    complete: boolean;
    windows: number;
    uniqueMessages: number;
    missingMessageIds: number;
    missingTurnIndices: number;
}
export interface ConversationHistoryScanResult {
    snapshot: ConversationSnapshot;
    scan: ConversationHistoryScanMeta;
}
export interface ConversationHistoryScanOptions {
    sleep?: (ms: number) => Promise<void>;
    settleMs?: number;
    maxRounds?: number;
    maxMs?: number;
    stableRounds?: number;
}
export declare function mergeConversationHistoryRecords(windows: ConversationHistoryRecord[][]): ConversationHistoryRecord[];
export declare function conversationHistoryWindow(document: Document, knownMessageIds?: ReadonlySet<string>): {
    records: ConversationHistoryRecord[];
    missingMessageIds: number;
    missingTurnIndices: number;
};
export declare function historyScrollTarget(scrollTop: number, clientHeight: number): number;
export declare function scanConversationHistory(document: Document, url: string, title: string, options?: ConversationHistoryScanOptions): Promise<ConversationHistoryScanResult>;
