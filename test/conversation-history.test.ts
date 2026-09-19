import assert from 'node:assert/strict';
import test from 'node:test';
import type { SemanticDocument } from '../src/content/model.ts';
import {
  historyScrollTarget,
  mergeConversationHistoryRecords,
  type ConversationHistoryRecord
} from '../src/extension/conversation-history.ts';

function record(
  messageId: string,
  turnIndex: number,
  role: 'user' | 'assistant',
  text: string,
  document?: SemanticDocument
): ConversationHistoryRecord {
  return {
    messageId,
    turnIndex,
    turnTestId: `conversation-turn-${turnIndex}`,
    role,
    text,
    ...(document ? { document, markdown: text } : {})
  };
}

test('walks virtualized history upward in viewport-sized increments instead of jumping to the top', () => {
  assert.equal(historyScrollTarget(45_629, 684), 45_082);
  assert.equal(historyScrollTarget(500, 684), 0);
  assert.equal(historyScrollTarget(0, 684), 0);
});

test('merges virtualized history windows by message id and orders by turn index', () => {
  const records = mergeConversationHistoryRecords([
    [
      record('m-5', 5, 'user', 'same'),
      record('m-6', 6, 'assistant', 'answer 2')
    ],
    [
      record('m-1', 1, 'user', 'same'),
      record('m-2', 2, 'assistant', 'answer 1'),
      record('m-5', 5, 'user', 'same')
    ]
  ]);

  assert.deepEqual(records.map((item) => [item.messageId, item.turnIndex, item.text]), [
    ['m-1', 1, 'same'],
    ['m-2', 2, 'answer 1'],
    ['m-5', 5, 'same'],
    ['m-6', 6, 'answer 2']
  ]);
});

test('keeps the richer duplicate record when a virtualized message is re-rendered', () => {
  const document: SemanticDocument = {
    blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'complete answer' }] }]
  };

  const records = mergeConversationHistoryRecords([
    [record('m-2', 2, 'assistant', 'complete')],
    [record('m-2', 2, 'assistant', 'complete answer', document)]
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.text, 'complete answer');
  assert.equal(records[0]?.document, document);
});

test('does not pretend a complete ordering when stable turn indices are missing', () => {
  const records = mergeConversationHistoryRecords([[
    {
      messageId: 'm-1',
      turnIndex: null,
      turnTestId: null,
      role: 'user',
      text: 'question'
    }
  ]]);

  assert.equal(records[0]?.turnIndex, null);
});
