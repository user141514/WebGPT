import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationSnapshot } from '../src/conversation-snapshot.ts';
import * as conversationView from '../src/client/conversation-view.ts';

const { snapshotToTranscriptTurns } = conversationView;

test('follows output only when content changed and the viewport was already near the bottom', () => {
  const nearBottom = (conversationView as any).isNearConversationBottom;
  const shouldFollow = (conversationView as any).shouldFollowConversationOutput;

  assert.equal(typeof nearBottom, 'function');
  assert.equal(typeof shouldFollow, 'function');
  assert.equal(nearBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1020 }, 24), true);
  assert.equal(nearBottom({ scrollTop: 600, clientHeight: 300, scrollHeight: 1020 }, 24), false);
  assert.equal(shouldFollow({ wasNearBottom: true, contentChanged: true }), true);
  assert.equal(shouldFollow({ wasNearBottom: true, contentChanged: false }), false);
  assert.equal(shouldFollow({ wasNearBottom: false, contentChanged: true }), false);
});

test('pairs historical user and assistant messages without inventing content', () => {
  const snapshot: ConversationSnapshot = {
    url: 'https://chatgpt.com/c/abc',
    title: 'Example',
    turns: [
      { role: 'user', text: 'Q1' },
      { role: 'assistant', text: 'A1' },
      { role: 'user', text: 'Q2' },
      { role: 'assistant', text: 'A2' }
    ]
  };

  const turns = snapshotToTranscriptTurns(snapshot);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((turn) => ({
    userText: turn.userText,
    assistantText: turn.assistantText,
    phase: turn.phase
  })), [
    { userText: 'Q1', assistantText: 'A1', phase: 'completed' },
    { userText: 'Q2', assistantText: 'A2', phase: 'completed' }
  ]);
});

test('preserves assistant semantic documents and handles unpaired messages', () => {
  const document = {
    blocks: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Structured' }] }]
  };
  const snapshot: ConversationSnapshot = {
    url: 'https://chatgpt.com/c/abc',
    title: 'Example',
    turns: [
      { role: 'assistant', text: 'Leading assistant' },
      { role: 'user', text: 'Q' },
      { role: 'assistant', text: 'Structured', document, markdown: 'Structured' },
      { role: 'user', text: 'Unanswered' }
    ]
  };

  const turns = snapshotToTranscriptTurns(snapshot);
  assert.equal(turns.length, 3);
  assert.equal(turns[0]?.userText, '');
  assert.equal(turns[0]?.assistantText, 'Leading assistant');
  assert.equal(turns[1]?.assistantDocument, document);
  assert.equal(turns[2]?.userText, 'Unanswered');
  assert.equal(turns[2]?.assistantText, '');
});
