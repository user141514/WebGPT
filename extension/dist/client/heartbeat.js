export class BridgeHeartbeat {
    lastReadyAt = null;
    timeoutMs;
    constructor(timeoutMs) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new Error('Bridge heartbeat timeout must be positive');
        }
        this.timeoutMs = timeoutMs;
    }
    markReady(now) {
        this.lastReadyAt = now;
    }
    isAlive(now) {
        return this.lastReadyAt !== null && now - this.lastReadyAt < this.timeoutMs;
    }
}
