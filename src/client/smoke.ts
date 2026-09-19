import type { ClientState } from './state.js';

export const CLIENT_SMOKE_TOKEN = 'CLIENT_SMOKE_OK';
export const CLIENT_SMOKE_PROMPT = `Reply exactly ${CLIENT_SMOKE_TOKEN}`;

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

export function smokePromptFromUrl(url: string): string | null {
  const parsed = new URL(url);
  return parsed.searchParams.get('smoke') === CLIENT_SMOKE_TOKEN
    ? CLIENT_SMOKE_PROMPT
    : null;
}

export function liveStatusPayload(
  state: ClientState,
  diagnostics: LiveStatusDiagnostics = {
    conversationUrl: null,
    historyMessages: 0,
    historyHydrated: false
  }
): LiveStatusPayload {
  return {
    phase: state.phase,
    requestId: state.requestId,
    assistantText: state.assistantText,
    error: state.error,
    ...diagnostics
  };
}
