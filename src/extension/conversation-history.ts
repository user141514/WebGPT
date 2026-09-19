import { captureContentTree, extractAssistantDocument } from '../content/extract.js';
import { semanticDocumentToMarkdown } from '../content/markdown.js';
import type { SemanticDocument } from '../content/model.js';
import type { ConversationSnapshot, ConversationTurn } from '../conversation-snapshot.js';
import {
  nearestConversationScrollContainer,
  stableMessageId,
  turnTestId
} from './conversation-dom.js';

const MESSAGE_SELECTOR = '[data-message-author-role="user"],[data-message-author-role="assistant"]';

export interface ConversationHistoryRecord {
  messageId: string;
  turnIndex: number | null;
  turnTestId: string | null;
  role: 'user' | 'assistant';
  text: string;
  document?: SemanticDocument;
  markdown?: string;
}

export interface ConversationHistoryScanMeta {
  complete: boolean;
  windows: number;
  uniqueMessages: number;
  missingMessageIds: number;
  missingTurnIndices: number;
}

export interface ConversationHistoryScanResult {
  snapshot: ConversationSnapshot;
  scan: ConversationHistoryScanMeta;
}

export interface ConversationHistoryScanOptions {
  sleep?: (ms: number) => Promise<void>;
  settleMs?: number;
  maxRounds?: number;
  maxMs?: number;
  stableRounds?: number;
}

function numericTurnIndex(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^conversation-turn-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function recordRichness(record: ConversationHistoryRecord): number {
  return record.text.length
    + (record.document?.blocks.length ?? 0) * 1000
    + (record.markdown?.length ?? 0);
}

function richer(
  current: ConversationHistoryRecord,
  incoming: ConversationHistoryRecord
): ConversationHistoryRecord {
  return recordRichness(incoming) > recordRichness(current) ? incoming : current;
}

export function mergeConversationHistoryRecords(
  windows: ConversationHistoryRecord[][]
): ConversationHistoryRecord[] {
  const byMessageId = new Map<string, ConversationHistoryRecord>();
  let firstSeen = 0;
  const order = new Map<string, number>();

  for (const window of windows) {
    for (const record of window) {
      if (!order.has(record.messageId)) order.set(record.messageId, firstSeen++);
      const current = byMessageId.get(record.messageId);
      byMessageId.set(record.messageId, current ? richer(current, record) : record);
    }
  }

  return [...byMessageId.values()].sort((a, b) => {
    if (a.turnIndex !== null && b.turnIndex !== null) return a.turnIndex - b.turnIndex;
    if (a.turnIndex !== null) return -1;
    if (b.turnIndex !== null) return 1;
    return (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0);
  });
}

function extractRecord(element: Element): ConversationHistoryRecord | null {
  const role = element.getAttribute('data-message-author-role');
  if (role !== 'user' && role !== 'assistant') return null;

  const messageId = stableMessageId(element);
  const testId = turnTestId(element);
  if (!messageId) return null;

  const text = element.textContent?.trim() ?? '';
  if (!text) return null;

  if (role === 'user') {
    return {
      messageId,
      turnIndex: numericTurnIndex(testId),
      turnTestId: testId,
      role: 'user',
      text
    };
  }

  let document: SemanticDocument | null = null;
  try {
    document = extractAssistantDocument(captureContentTree(element));
  } catch {
    document = null;
  }

  return {
    messageId,
    turnIndex: numericTurnIndex(testId),
    turnTestId: testId,
    role: 'assistant',
    text,
    ...(document?.blocks.length
      ? {
          document,
          markdown: semanticDocumentToMarkdown(document)
        }
      : {})
  };
}

export function conversationHistoryWindow(
  document: Document,
  knownMessageIds: ReadonlySet<string> = new Set()
): {
  records: ConversationHistoryRecord[];
  missingMessageIds: number;
  missingTurnIndices: number;
} {
  const records: ConversationHistoryRecord[] = [];
  let missingMessageIds = 0;
  let missingTurnIndices = 0;

  for (const element of [...document.querySelectorAll(MESSAGE_SELECTOR)]) {
    const role = element.getAttribute('data-message-author-role');
    if (role !== 'user' && role !== 'assistant') continue;
    if (!(element.textContent?.trim() ?? '')) continue;

    const messageId = stableMessageId(element);
    if (!messageId) {
      missingMessageIds += 1;
      continue;
    }

    const testId = turnTestId(element);
    if (numericTurnIndex(testId) === null) missingTurnIndices += 1;
    if (knownMessageIds.has(messageId)) continue;

    const record = extractRecord(element);
    if (record) records.push(record);
  }

  return { records, missingMessageIds, missingTurnIndices };
}

export function historyScrollTarget(scrollTop: number, clientHeight: number): number {
  const increment = Math.max(320, Math.floor(clientHeight * 0.8));
  return Math.max(0, Math.floor(scrollTop - increment));
}

function stepTowardTop(element: Element): number {
  const target = element as HTMLElement;
  const next = historyScrollTarget(target.scrollTop, target.clientHeight);
  if (typeof (target as any).scrollTo === 'function') {
    (target as any).scrollTo({ top: next, behavior: 'instant' });
  } else {
    target.scrollTop = next;
  }
  return next;
}

function toConversationTurns(records: ConversationHistoryRecord[]): ConversationTurn[] {
  return records.map((record) => (
    record.role === 'user'
      ? { role: 'user', text: record.text }
      : {
          role: 'assistant',
          text: record.text,
          ...(record.document ? { document: record.document } : {}),
          ...(record.markdown ? { markdown: record.markdown } : {})
        }
  ));
}

export async function scanConversationHistory(
  document: Document,
  url: string,
  title: string,
  options: ConversationHistoryScanOptions = {}
): Promise<ConversationHistoryScanResult> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const settleMs = options.settleMs ?? 200;
  const maxRounds = options.maxRounds ?? 140;
  const maxMs = options.maxMs ?? 35_000;
  const stableRoundsRequired = options.stableRounds ?? 3;

  const windows: ConversationHistoryRecord[][] = [];
  const seenMessageIds = new Set<string>();
  const startedAt = Date.now();
  let totalMissingMessageIds = 0;
  let totalMissingTurnIndices = 0;
  let stableRounds = 0;
  let previousCount = -1;
  let previousHeight = -1;
  let complete = false;

  const captureNewWindow = () => {
    const captured = conversationHistoryWindow(document, seenMessageIds);
    for (const record of captured.records) seenMessageIds.add(record.messageId);
    if (captured.records.length) windows.push(captured.records);
    totalMissingMessageIds = Math.max(totalMissingMessageIds, captured.missingMessageIds);
    totalMissingTurnIndices = Math.max(totalMissingTurnIndices, captured.missingTurnIndices);
    return captured;
  };

  for (let round = 0; round < maxRounds; round += 1) {
    if (Date.now() - startedAt >= maxMs) break;

    captureNewWindow();
    const visibleMessages = [...document.querySelectorAll(MESSAGE_SELECTOR)];
    const lastMessage = visibleMessages.at(-1) ?? null;
    const container = lastMessage ? nearestConversationScrollContainer(lastMessage) : null;
    if (!container) {
      complete = totalMissingMessageIds === 0 && totalMissingTurnIndices === 0;
      break;
    }

    const requestedTop = stepTowardTop(container);
    await sleep(settleMs);
    captureNewWindow();

    const refreshedMessages = [...document.querySelectorAll(MESSAGE_SELECTOR)];
    const refreshedLast = refreshedMessages.at(-1) ?? null;
    const refreshedContainer = refreshedLast ? nearestConversationScrollContainer(refreshedLast) : null;
    const afterTarget = (refreshedContainer ?? container) as HTMLElement;
    const afterHeight = afterTarget.scrollHeight;
    const atTop = requestedTop <= 0 && afterTarget.scrollTop <= 1;
    const noNew = seenMessageIds.size === previousCount;
    const heightStable = afterHeight === previousHeight;

    if (atTop && noNew && heightStable) stableRounds += 1;
    else stableRounds = 0;

    previousCount = seenMessageIds.size;
    previousHeight = afterHeight;

    if (stableRounds >= stableRoundsRequired) {
      complete = totalMissingMessageIds === 0 && totalMissingTurnIndices === 0;
      break;
    }
  }

  const merged = mergeConversationHistoryRecords(windows);
  return {
    snapshot: {
      url,
      title,
      turns: toConversationTurns(merged)
    },
    scan: {
      complete,
      windows: windows.length,
      uniqueMessages: merged.length,
      missingMessageIds: totalMissingMessageIds,
      missingTurnIndices: totalMissingTurnIndices
    }
  };
}
