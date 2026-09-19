import { type DriverEvent, type DriverOptions } from '../driver.js';
import type { DomSurface } from '../dom.js';
export type ProviderRuntimeEvent = DriverEvent | {
    type: 'provider.error';
    message: string;
};
export interface ContentProviderEvent {
    requestId: string;
    event: ProviderRuntimeEvent;
}
export interface IntervalScheduler {
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}
export interface ContentControllerOptions {
    pollIntervalMs?: number;
    acceptanceTimeoutMs?: number;
    promptWaitAttempts?: number;
    promptWaitIntervalMs?: number;
    sendWaitAttempts?: number;
    sendWaitIntervalMs?: number;
    driverOptions?: DriverOptions;
    scheduler?: IntervalScheduler;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
export interface SubmitResult {
    started: boolean;
    error?: string;
}
export declare class ContentController {
    private readonly surface;
    private readonly emit;
    private readonly pollIntervalMs;
    private readonly driverOptions;
    private readonly scheduler;
    private readonly acceptanceTimeoutMs;
    private readonly now;
    private readonly promptWaitAttempts;
    private readonly promptWaitIntervalMs;
    private readonly sendWaitAttempts;
    private readonly sendWaitIntervalMs;
    private readonly sleep;
    private activeRequestId;
    private activeDriver;
    private intervalHandle;
    private observationQueued;
    private requestSubmitted;
    private requestAccepted;
    private submittedAt;
    constructor(surface: DomSurface, emit: (event: ContentProviderEvent) => void, options?: ContentControllerOptions);
    submitWhenReady(requestId: string, text: string): Promise<SubmitResult>;
    requestObservation(): void;
    submit(requestId: string, text: string): SubmitResult;
    private observe;
    private handleDriverEvent;
    private release;
}
