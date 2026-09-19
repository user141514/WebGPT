import { ChatGptDriver, type DriverEvent, type DriverOptions } from '../driver.js';
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

const defaultScheduler: IntervalScheduler = {
  setInterval(callback, ms) {
    return globalThis.setInterval(callback, ms);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
  }
};

export class ContentController {
  private readonly surface: DomSurface;
  private readonly emit: (event: ContentProviderEvent) => void;
  private readonly pollIntervalMs: number;
  private readonly driverOptions: DriverOptions;
  private readonly scheduler: IntervalScheduler;
  private readonly acceptanceTimeoutMs: number;
  private readonly now: () => number;
  private readonly promptWaitAttempts: number;
  private readonly promptWaitIntervalMs: number;
  private readonly sendWaitAttempts: number;
  private readonly sendWaitIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private activeRequestId: string | null = null;
  private activeDriver: ChatGptDriver | null = null;
  private intervalHandle: unknown = null;
  private observationQueued = false;
  private requestSubmitted = false;
  private requestAccepted = false;
  private submittedAt = 0;

  constructor(
    surface: DomSurface,
    emit: (event: ContentProviderEvent) => void,
    options: ContentControllerOptions = {}
  ) {
    this.surface = surface;
    this.emit = emit;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.acceptanceTimeoutMs = options.acceptanceTimeoutMs ?? 3_000;
    this.driverOptions = options.driverOptions ?? {};
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.now = options.now ?? Date.now;
    this.promptWaitAttempts = options.promptWaitAttempts ?? 80;
    this.promptWaitIntervalMs = options.promptWaitIntervalMs ?? 250;
    this.sendWaitAttempts = options.sendWaitAttempts ?? 80;
    this.sendWaitIntervalMs = options.sendWaitIntervalMs ?? 125;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)));
  }

  async submitWhenReady(requestId: string, text: string): Promise<SubmitResult> {
    if (this.activeRequestId !== null) {
      return { started: false, error: 'A ChatGPT request is already active' };
    }

    this.activeRequestId = requestId;
    this.requestAccepted = false;
    const driver = new ChatGptDriver(
      this.surface,
      (event) => this.handleDriverEvent(requestId, event),
      this.driverOptions
    );
    this.activeDriver = driver;

    try {
      let prepared = false;
      for (let attempt = 0; attempt < this.promptWaitAttempts; attempt += 1) {
        if (driver.prepare(text)) {
          prepared = true;
          break;
        }
        if (attempt + 1 < this.promptWaitAttempts) {
          await this.sleep(this.promptWaitIntervalMs);
        }
      }
      if (!prepared) {
        this.release();
        return { started: false, error: 'ChatGPT prompt editor was not found' };
      }

      let submitted = false;
      for (let attempt = 0; attempt < this.sendWaitAttempts; attempt += 1) {
        if (driver.submitPrepared()) {
          submitted = true;
          break;
        }
        if (attempt + 1 < this.sendWaitAttempts) {
          await this.sleep(this.sendWaitIntervalMs);
        }
      }
      if (!submitted) {
        this.release();
        return { started: false, error: 'ChatGPT send button did not become available' };
      }

      this.requestSubmitted = true;
      this.submittedAt = this.now();
      this.intervalHandle = this.scheduler.setInterval(() => this.observe(), this.pollIntervalMs);
      return { started: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.release();
      return { started: false, error: message };
    }
  }

  requestObservation(): void {
    if (!this.activeRequestId || !this.activeDriver || !this.requestSubmitted || this.observationQueued) return;
    this.observationQueued = true;
    globalThis.queueMicrotask(() => {
      this.observationQueued = false;
      this.observe();
    });
  }

  submit(requestId: string, text: string): SubmitResult {
    if (this.activeRequestId !== null) {
      return { started: false, error: 'A ChatGPT request is already active' };
    }

    this.activeRequestId = requestId;
    this.requestAccepted = false;
    const driver = new ChatGptDriver(
      this.surface,
      (event) => this.handleDriverEvent(requestId, event),
      this.driverOptions
    );
    this.activeDriver = driver;

    try {
      if (!driver.submit(text)) {
        this.release();
        return {
          started: false,
          error: 'ChatGPT composer or send button was not available'
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.release();
      return { started: false, error: message };
    }

    this.requestSubmitted = true;
    this.submittedAt = this.now();
    this.intervalHandle = this.scheduler.setInterval(() => this.observe(), this.pollIntervalMs);
    return { started: true };
  }

  private observe(): void {
    const requestId = this.activeRequestId;
    const driver = this.activeDriver;
    if (!requestId || !driver) return;

    try {
      driver.observe();
      if (
        this.activeRequestId === requestId
        && !this.requestAccepted
        && this.now() - this.submittedAt >= this.acceptanceTimeoutMs
      ) {
        this.emit({
          requestId,
          event: {
            type: 'provider.error',
            message: 'Timed out waiting for ChatGPT to accept the request'
          }
        });
        this.release();
      }
    } catch (error) {
      this.emit({
        requestId,
        event: {
          type: 'provider.error',
          message: error instanceof Error ? error.message : String(error)
        }
      });
      this.release();
    }
  }

  private handleDriverEvent(requestId: string, event: DriverEvent): void {
    if (requestId !== this.activeRequestId) return;
    if (event.type === 'request.accepted') this.requestAccepted = true;
    this.emit({ requestId, event });
    if (event.type === 'assistant.completed') this.release();
  }

  private release(): void {
    if (this.intervalHandle !== null) {
      this.scheduler.clearInterval(this.intervalHandle);
    }
    this.intervalHandle = null;
    this.activeDriver = null;
    this.activeRequestId = null;
    this.observationQueued = false;
    this.requestSubmitted = false;
    this.requestAccepted = false;
    this.submittedAt = 0;
  }
}
