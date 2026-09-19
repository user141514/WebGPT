export declare class BridgeHeartbeat {
    private lastReadyAt;
    private readonly timeoutMs;
    constructor(timeoutMs: number);
    markReady(now: number): void;
    isAlive(now: number): boolean;
}
