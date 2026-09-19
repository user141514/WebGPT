import assert from 'node:assert/strict';
import test from 'node:test';
import { liveStatusPayload, smokePromptFromUrl } from '../src/client/smoke.ts';

test('enables only the fixed CLIENT_SMOKE_OK live prompt', () => {
  assert.equal(
    smokePromptFromUrl('http://127.0.0.1:4317/?smoke=CLIENT_SMOKE_OK'),
    'Reply exactly CLIENT_SMOKE_OK'
  );
  assert.equal(smokePromptFromUrl('http://127.0.0.1:4317/?smoke=anything-else'), null);
  assert.equal(smokePromptFromUrl('http://127.0.0.1:4317/'), null);
});

test('reduces client state to the bounded in-memory live status shape', () => {
  assert.deepEqual(liveStatusPayload({
    phase: 'completed',
    clientRequestId: 'local-1',
    requestId: 'req-1',
    assistantText: 'CLIENT_SMOKE_OK',
    assistantDocument: null,
    assistantMarkdown: null,
    error: null
  }, {
    conversationUrl: 'https://chatgpt.com/c/abc',
    historyMessages: 5,
    historyHydrated: true
  }), {
    phase: 'completed',
    requestId: 'req-1',
    assistantText: 'CLIENT_SMOKE_OK',
    error: null,
    conversationUrl: 'https://chatgpt.com/c/abc',
    historyMessages: 5,
    historyHydrated: true
  });
});
