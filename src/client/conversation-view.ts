import type { SemanticDocument } from '../content/model.js';
import type { ConversationSnapshot } from '../conversation-snapshot.js';
import type { ClientPhase } from './state.js';

export interface ConversationScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface ConversationFollowDecision {
  wasNearBottom: boolean;
  contentChanged: boolean;
  force?: boolean;
}

export function isNearConversationBottom(metrics: ConversationScrollMetrics, threshold = 48): boolean {
  const distance = Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
  return distance <= Math.max(0, threshold);
}

export function shouldFollowConversationOutput(decision: ConversationFollowDecision): boolean {
  return decision.contentChanged && (decision.force === true || decision.wasNearBottom);
}

export interface TranscriptTurn {
  clientRequestId: string;
  requestId: string | null;
  userText: string;
  assistantText: string;
  assistantDocument: SemanticDocument | null;
  assistantMarkdown: string | null;
  phase: ClientPhase;
  error: string | null;
}

function historicalTurn(index: number): TranscriptTurn {
  return {
    clientRequestId: `history-${index}`,
    requestId: null,
    userText: '',
    assistantText: '',
    assistantDocument: null,
    assistantMarkdown: null,
    phase: 'completed',
    error: null
  };
}

export function snapshotToTranscriptTurns(snapshot: ConversationSnapshot): TranscriptTurn[] {
  const result: TranscriptTurn[] = [];

  for (const message of snapshot.turns) {
    if (message.role === 'user') {
      const turn = historicalTurn(result.length);
      turn.userText = message.text;
      result.push(turn);
      continue;
    }

    const last = result.at(-1);
    const target = last && !last.assistantText && !last.assistantDocument && !last.error
      ? last
      : (() => {
          const turn = historicalTurn(result.length);
          result.push(turn);
          return turn;
        })();

    target.assistantText = message.text;
    target.assistantDocument = message.document ?? null;
    target.assistantMarkdown = message.markdown ?? null;
  }

  return result;
}
