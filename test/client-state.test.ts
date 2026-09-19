import assert from 'node:assert/strict';
import test from 'node:test';
import * as clientStateApi from '../src/client/state.ts';

const { initialClientState, reduceClientState } = clientStateApi;

test('coalesces streaming snapshots to the latest value per animation frame while lifecycle events stay immediate', () => {
  const ProviderEventFrameBuffer = (clientStateApi as any).ProviderEventFrameBuffer;
  assert.equal(typeof ProviderEventFrameBuffer, 'function');

  let nextFrame = 1;
  const frames = new Map<number, () => void>();
  const delivered: any[] = [];
  const buffer = new ProviderEventFrameBuffer(
    (action: unknown) => delivered.push(action),
    {
      request: (callback: () => void) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancel: (id: number) => { frames.delete(id); }
    }
  );

  buffer.push('req-1', { type: 'assistant.snapshot', text: 'a' });
  buffer.push('req-1', { type: 'assistant.snapshot', text: 'ab' });
  assert.equal(delivered.length, 0);
  assert.equal(frames.size, 1);

  frames.values().next().value?.();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].event.text, 'ab');

  buffer.push('req-1', { type: 'assistant.status', status: 'generating' });
  assert.equal(delivered.at(-1)?.event.type, 'assistant.status');
});

test('correlates provider events that arrive before submit.result through the active client request id', () => {
  let state = reduceClientState(initialClientState(), { type: 'bridge.ready' });
  state = reduceClientState(state, { type: 'submit.local', clientRequestId: 'local-1' });

  const unrelated = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-other',
    clientRequestId: 'local-other',
    event: { type: 'request.accepted' }
  } as any);
  assert.deepEqual(unrelated, state);

  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    clientRequestId: 'local-1',
    event: { type: 'request.accepted' }
  } as any);
  assert.equal(state.requestId, 'req-1');
  assert.equal(state.phase, 'accepted');

  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-1',
    result: { started: true, requestId: 'req-1' }
  });
  assert.equal(state.phase, 'accepted');
  assert.equal(state.requestId, 'req-1');
});

test('moves from disconnected through submit, acceptance, generation, snapshot replacement, and completion', () => {
  let state = initialClientState();
  assert.equal(state.phase, 'disconnected');

  state = reduceClientState(state, { type: 'bridge.ready' });
  assert.equal(state.phase, 'idle');

  state = reduceClientState(state, { type: 'submit.local', clientRequestId: 'local-1' });
  assert.equal(state.phase, 'submitting');

  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-1',
    result: { started: true, requestId: 'req-1' }
  });
  assert.equal(state.phase, 'submitted');
  assert.equal(state.requestId, 'req-1');

  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    event: { type: 'request.accepted' }
  });
  assert.equal(state.phase, 'accepted');

  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    event: { type: 'assistant.status', status: 'generating' }
  });
  assert.equal(state.phase, 'generating');

  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    event: { type: 'assistant.snapshot', text: 'partial' }
  });
  const document = {
    blocks: [{ type: 'heading' as const, level: 2, content: [{ type: 'text' as const, text: 'final body' }] }]
  };
  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    event: {
      type: 'assistant.snapshot',
      text: 'final body',
      document,
      markdown: '## final body'
    }
  });
  assert.equal(state.assistantText, 'final body');
  assert.deepEqual(state.assistantDocument, document);
  assert.equal(state.assistantMarkdown, '## final body');

  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    event: {
      type: 'assistant.completed',
      text: 'final body',
      document,
      markdown: '## final body'
    }
  });
  assert.equal(state.phase, 'completed');
  assert.equal(state.assistantText, 'final body');
  assert.deepEqual(state.assistantDocument, document);
  assert.equal(state.assistantMarkdown, '## final body');
});

test('ignores stale submit results and provider events from other request ids', () => {
  let state = reduceClientState(initialClientState(), { type: 'bridge.ready' });
  state = reduceClientState(state, { type: 'submit.local', clientRequestId: 'local-new' });
  const before = state;

  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-old',
    result: { started: true, requestId: 'req-old' }
  });
  assert.deepEqual(state, before);

  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-new',
    result: { started: true, requestId: 'req-new' }
  });
  const active = state;
  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-old',
    event: { type: 'assistant.snapshot', text: 'stale' }
  });
  assert.deepEqual(state, active);
});

test('switches conversations without leaking the previous request or assistant snapshot', () => {
  let state = reduceClientState(initialClientState(), { type: 'bridge.ready' });
  state = reduceClientState(state, { type: 'submit.local', clientRequestId: 'local-1' });
  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-1',
    result: { started: true, requestId: 'req-1' }
  });
  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-1',
    event: { type: 'assistant.snapshot', text: 'old response' }
  });

  state = reduceClientState(state, { type: 'conversation.switch' });

  assert.deepEqual(state, {
    phase: 'idle',
    clientRequestId: null,
    requestId: null,
    assistantText: '',
    assistantDocument: null,
    assistantMarkdown: null,
    error: null
  });
});

test('surfaces submit and provider errors without erasing the last valid assistant snapshot', () => {
  let state = reduceClientState(initialClientState(), { type: 'bridge.ready' });
  state = reduceClientState(state, { type: 'submit.local', clientRequestId: 'local-1' });
  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-1',
    result: { started: false, error: 'no tab' }
  });
  assert.equal(state.phase, 'error');
  assert.equal(state.error, 'no tab');

  state = reduceClientState(state, { type: 'submit.local', clientRequestId: 'local-2' });
  state = reduceClientState(state, {
    type: 'submit.result',
    clientRequestId: 'local-2',
    result: { started: true, requestId: 'req-2' }
  });
  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-2',
    event: { type: 'assistant.snapshot', text: 'keep me' }
  });
  state = reduceClientState(state, {
    type: 'provider.event',
    requestId: 'req-2',
    event: { type: 'provider.error', message: 'selector drift' }
  });

  assert.equal(state.phase, 'error');
  assert.equal(state.error, 'selector drift');
  assert.equal(state.assistantText, 'keep me');
});
