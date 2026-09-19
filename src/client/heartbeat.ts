export class BridgeHeartbeat {
  private lastReadyAt: number | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Bridge heartbeat timeout must be positive');
    }
    this.timeoutMs = timeoutMs;
  }

  markReady(now: number): void {
    this.lastReadyAt = now;
  }

  isAlive(now: number): boolean {
    return this.lastReadyAt !== null && now - this.lastReadyAt < this.timeoutMs;
  }
}
