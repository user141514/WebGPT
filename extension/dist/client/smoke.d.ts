import type { ClientState } from './state.js';
export declare const CLIENT_SMOKE_TOKEN = "CLIENT_SMOKE_OK";
export declare const CLIENT_SMOKE_PROMPT = "Reply exactly CLIENT_SMOKE_OK";
export interface LiveStatusDiagnostics {
    conversationUrl: string | null;
    historyMessages: number;
    historyHydrated: boolean;
}
export interface LiveStatusPayload extends LiveStatusDiagnostics {
    phase: string;
    requestId: string | null;
    assistantText: string;
    error: string | null;
}
export declare function smokePromptFromUrl(url: string): string | null;
export declare function liveStatusPayload(state: ClientState, diagnostics?: LiveStatusDiagnostics): LiveStatusPayload;
