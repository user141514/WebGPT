import type { SemanticDocument } from '../content/model.js';
import type { ProviderRuntimeEvent } from '../extension/content-controller.js';
export type ClientPhase = 'disconnected' | 'idle' | 'submitting' | 'submitted' | 'accepted' | 'generating' | 'settling' | 'completed' | 'error';
export interface ClientState {
    phase: ClientPhase;
    clientRequestId: string | null;
    requestId: string | null;
    assistantText: string;
    assistantDocument: SemanticDocument | null;
    assistantMarkdown: string | null;
    error: string | null;
}
export interface ClientSubmitResult {
    started: boolean;
    requestId?: string;
    error?: string;
}
export type ClientAction = {
    type: 'bridge.ready';
} | {
    type: 'bridge.disconnected';
} | {
    type: 'conversation.switch';
} | {
    type: 'submit.local';
    clientRequestId: string;
} | {
    type: 'submit.result';
    clientRequestId: string;
    result: ClientSubmitResult;
} | {
    type: 'provider.event';
    requestId: string;
    clientRequestId?: string;
    event: ProviderRuntimeEvent;
};
export interface FrameScheduler {
    request(callback: () => void): number;
    cancel(handle: number): void;
}
export declare class ProviderEventFrameBuffer {
    private pendingSnapshot;
    private frameHandle;
    private readonly deliver;
    private readonly scheduler;
    constructor(deliver: (action: ClientAction) => void, scheduler: FrameScheduler);
    push(requestId: string, event: ProviderRuntimeEvent, clientRequestId?: string): void;
    private flushSnapshot;
    private dropPendingSnapshot;
}
export declare function initialClientState(): ClientState;
export declare function reduceClientState(state: ClientState, action: ClientAction): ClientState;
