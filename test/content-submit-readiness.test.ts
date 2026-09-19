import assert from 'node:assert/strict';
import test from 'node:test';
import { submitDriverMessage } from '../src/extension/content-submit.ts';

test('routes valid driver.submit messages through submitWhenReady', async () => {
  const calls: Array<[string, string]> = [];
  const controller = {
    async submitWhenReady(requestId: string, text: string) {
      calls.push([requestId, text]);
      return { started: true };
    }
  };

  const result = await submitDriverMessage(controller, {
    type: 'driver.submit',
    requestId: 'req-1',
    text: 'hello'
  });

  assert.deepEqual(calls, [['req-1', 'hello']]);
  assert.deepEqual(result, { started: true });
});

test('rejects invalid driver submit payloads without calling the controller', async () => {
  let calls = 0;
  const controller = {
    async submitWhenReady() {
      calls += 1;
      return { started: true };
    }
  };

  assert.deepEqual(await submitDriverMessage(controller, { type: 'driver.submit', requestId: '', text: 'hello' }), {
    started: false,
    error: 'requestId is required'
  });
  assert.deepEqual(await submitDriverMessage(controller, { type: 'driver.submit', requestId: 'req-1', text: '   ' }), {
    started: false,
    error: 'Prompt text is required'
  });
  assert.equal(calls, 0);
});
