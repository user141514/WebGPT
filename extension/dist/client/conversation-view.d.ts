import type { SemanticDocument } from '../content/model.js';
import type { ConversationSnapshot } from '../conversation-snapshot.js';
import type { ClientPhase } from './state.js';
export interface ConversationScrollMetrics {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
}
export interface ConversationFollowDecision {
    wasNearBottom: boolean;
    contentChanged: boolean;
    force?: boolean;
}
export declare function isNearConversationBottom(metrics: ConversationScrollMetrics, threshold?: number): boolean;
export declare function shouldFollowConversationOutput(decision: ConversationFollowDecision): boolean;
export interface TranscriptTurn {
    clientRequestId: string;
    requestId: string | null;
    userText: string;
    assistantText: string;
    assistantDocument: SemanticDocument | null;
    assistantMarkdown: string | null;
    phase: ClientPhase;
    error: string | null;
}
export declare function snapshotToTranscriptTurns(snapshot: ConversationSnapshot): TranscriptTurn[];
