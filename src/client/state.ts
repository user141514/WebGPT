import type { SemanticDocument } from '../content/model.js';
import type { ProviderRuntimeEvent } from '../extension/content-controller.js';

export type ClientPhase =
  | 'disconnected'
  | 'idle'
  | 'submitting'
  | 'submitted'
  | 'accepted'
  | 'generating'
  | 'settling'
  | 'completed'
  | 'error';

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

export type ClientAction =
  | { type: 'bridge.ready' }
  | { type: 'bridge.disconnected' }
  | { type: 'conversation.switch' }
  | { type: 'submit.local'; clientRequestId: string }
  | { type: 'submit.result'; clientRequestId: string; result: ClientSubmitResult }
  | { type: 'provider.event'; requestId: string; clientRequestId?: string; event: ProviderRuntimeEvent };

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export class ProviderEventFrameBuffer {
  private pendingSnapshot: Extract<ClientAction, { type: 'provider.event' }> | null = null;
  private frameHandle: number | null = null;
  private readonly deliver: (action: ClientAction) => void;
  private readonly scheduler: FrameScheduler;

  constructor(deliver: (action: ClientAction) => void, scheduler: FrameScheduler) {
    this.deliver = deliver;
    this.scheduler = scheduler;
  }

  push(requestId: string, event: ProviderRuntimeEvent, clientRequestId?: string): void {
    const action: Extract<ClientAction, { type: 'provider.event' }> = {
      type: 'provider.event',
      requestId,
      ...(clientRequestId ? { clientRequestId } : {}),
      event
    };

    if (event.type === 'assistant.snapshot') {
      this.pendingSnapshot = action;
      if (this.frameHandle === null) {
        this.frameHandle = this.scheduler.request(() => this.flushSnapshot());
      }
      return;
    }

    if (event.type === 'assistant.completed') {
      this.dropPendingSnapshot();
      this.deliver(action);
      return;
    }

    if (event.type === 'provider.error') this.flushSnapshot();
    this.deliver(action);
  }

  private flushSnapshot(): void {
    if (this.frameHandle !== null) this.scheduler.cancel(this.frameHandle);
    this.frameHandle = null;
    const pending = this.pendingSnapshot;
    this.pendingSnapshot = null;
    if (pending) this.deliver(pending);
  }

  private dropPendingSnapshot(): void {
    if (this.frameHandle !== null) this.scheduler.cancel(this.frameHandle);
    this.frameHandle = null;
    this.pendingSnapshot = null;
  }
}

export function initialClientState(): ClientState {
  return {
    phase: 'disconnected',
    clientRequestId: null,
    requestId: null,
    assistantText: '',
    assistantDocument: null,
    assistantMarkdown: null,
    error: null
  };
}

export function reduceClientState(state: ClientState, action: ClientAction): ClientState {
  if (action.type === 'bridge.ready') {
    return state.phase === 'disconnected'
      ? { ...state, phase: 'idle', error: null }
      : state;
  }

  if (action.type === 'bridge.disconnected') {
    return { ...state, phase: 'disconnected', error: 'Provider extension is disconnected' };
  }

  if (action.type === 'conversation.switch') {
    return {
      phase: state.phase === 'disconnected' ? 'disconnected' : 'idle',
      clientRequestId: null,
      requestId: null,
      assistantText: '',
      assistantDocument: null,
      assistantMarkdown: null,
      error: null
    };
  }

  if (action.type === 'submit.local') {
    return {
      ...state,
      phase: 'submitting',
      clientRequestId: action.clientRequestId,
      requestId: null,
      assistantText: '',
      assistantDocument: null,
      assistantMarkdown: null,
      error: null
    };
  }

  if (action.type === 'submit.result') {
    if (action.clientRequestId !== state.clientRequestId) return state;
    if (action.result.started !== true || !action.result.requestId) {
      return {
        ...state,
        phase: 'error',
        requestId: null,
        error: action.result.error || 'Provider submit failed'
      };
    }
    if (state.requestId) {
      if (state.requestId !== action.result.requestId) {
        return {
          ...state,
          phase: 'error',
          error: 'Provider request identity changed during submission'
        };
      }
      return { ...state, error: null };
    }
    return {
      ...state,
      phase: 'submitted',
      requestId: action.result.requestId,
      error: null
    };
  }

  if (action.type === 'provider.event') {
    let correlated = state;
    if (!state.requestId) {
      if (!state.clientRequestId || action.clientRequestId !== state.clientRequestId) return state;
      correlated = { ...state, requestId: action.requestId };
    } else if (action.requestId !== state.requestId) {
      return state;
    }

    const event = action.event;
    if (event.type === 'request.accepted') {
      return { ...correlated, phase: 'accepted', error: null };
    }
    if (event.type === 'assistant.status') {
      return {
        ...correlated,
        phase: event.status === 'generating' ? 'generating' : 'settling',
        error: null
      };
    }
    if (event.type === 'assistant.snapshot') {
      return {
        ...correlated,
        phase: correlated.phase === 'generating' ? 'generating' : 'settling',
        assistantText: event.text,
        assistantDocument: event.document ?? correlated.assistantDocument,
        assistantMarkdown: event.markdown ?? correlated.assistantMarkdown,
        error: null
      };
    }
    if (event.type === 'assistant.completed') {
      return {
        ...correlated,
        phase: 'completed',
        assistantText: event.text,
        assistantDocument: event.document ?? correlated.assistantDocument,
        assistantMarkdown: event.markdown ?? correlated.assistantMarkdown,
        error: null
      };
    }
    if (event.type === 'provider.error') {
      return {
        ...correlated,
        phase: 'error',
        error: event.message
      };
    }
  }

  return state;
}
