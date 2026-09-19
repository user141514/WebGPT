import type { SemanticDocument } from './content/model.js';
import type { DomSurface } from './dom.js';
export type DriverEvent = {
    type: 'request.accepted';
} | {
    type: 'assistant.status';
    status: 'generating' | 'complete';
} | {
    type: 'assistant.snapshot';
    text: string;
    document?: SemanticDocument;
    markdown?: string;
} | {
    type: 'assistant.completed';
    text: string;
    document?: SemanticDocument;
    markdown?: string;
};
export interface DriverOptions {
    completionActionSettleMs?: number;
    fallbackSettleMs?: number;
    now?: () => number;
}
export declare class ChatGptDriver {
    private accepted;
    private completed;
    private baselineUsers;
    private baselineAssistants;
    private lastStatus;
    private lastText;
    private lastSignature;
    private lastDocument;
    private lastMarkdown;
    private stableSince;
    private prepared;
    private readonly completionActionSettleMs;
    private readonly fallbackSettleMs;
    private readonly now;
    private readonly surface;
    private readonly emit;
    constructor(surface: DomSurface, emit: (event: DriverEvent) => void, options?: DriverOptions);
    prepare(text: string): boolean;
    submitPrepared(): boolean;
    submit(text: string): boolean;
    observe(): void;
}
