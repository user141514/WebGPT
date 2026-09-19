import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectionEpoch } from '../src/client/selection-epoch.ts';

test('invalidates a pending URL resolution when a newer conversation selection occurs', () => {
  const epoch = new SelectionEpoch();
  const pendingA = epoch.begin();
  assert.equal(epoch.isCurrent(pendingA), true);

  epoch.invalidate();
  assert.equal(epoch.isCurrent(pendingA), false);
});

test('only the newest asynchronous selection token remains current', () => {
  const epoch = new SelectionEpoch();
  const first = epoch.begin();
  const second = epoch.begin();

  assert.equal(epoch.isCurrent(first), false);
  assert.equal(epoch.isCurrent(second), true);
});
