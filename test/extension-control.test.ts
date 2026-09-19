import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExtensionControlPageUrl,
  verifyReloadReceipt,
  type PendingExtensionReload
} from '../src/extension/reload-control.ts';

test('accepts only the bounded localhost extension control port pool', () => {
  assert.equal(isExtensionControlPageUrl('http://127.0.0.1:4318/__extension-control.html?op=reload'), true);
  assert.equal(isExtensionControlPageUrl('http://localhost:4327/__extension-control.html'), true);
  assert.equal(isExtensionControlPageUrl('http://127.0.0.1:4317/__extension-control.html'), false);
  assert.equal(isExtensionControlPageUrl('http://127.0.0.1:4328/__extension-control.html'), false);
  assert.equal(isExtensionControlPageUrl('http://127.0.0.1:4318/'), false);
  assert.equal(isExtensionControlPageUrl('http://127.0.0.1:9999/__extension-control.html'), false);
  assert.equal(isExtensionControlPageUrl('https://chatgpt.com/__extension-control.html'), false);
});

test('verifies reload only when build and extension instance both changed as expected', () => {
  const pending: PendingExtensionReload = {
    requestId: 'reload-1',
    expectedBuildId: 'build-new',
    beforeBuildId: 'build-old',
    beforeInstanceId: 'instance-old',
    requestedAt: 1
  };

  assert.deepEqual(verifyReloadReceipt(pending, 'build-new', 'instance-new', 2), {
    state: 'verified',
    requestId: 'reload-1',
    expectedBuildId: 'build-new',
    beforeBuildId: 'build-old',
    afterBuildId: 'build-new',
    beforeInstanceId: 'instance-old',
    afterInstanceId: 'instance-new',
    requestedAt: 1,
    completedAt: 2
  });
});

test('fails reload verification on build mismatch or unchanged extension instance', () => {
  const pending: PendingExtensionReload = {
    requestId: 'reload-1',
    expectedBuildId: 'build-new',
    beforeBuildId: 'build-old',
    beforeInstanceId: 'instance-old',
    requestedAt: 1
  };

  assert.equal(verifyReloadReceipt(pending, 'wrong-build', 'instance-new', 2).state, 'failed');
  assert.match(verifyReloadReceipt(pending, 'wrong-build', 'instance-new', 2).error ?? '', /build/i);

  assert.equal(verifyReloadReceipt(pending, 'build-new', 'instance-old', 2).state, 'failed');
  assert.match(verifyReloadReceipt(pending, 'build-new', 'instance-old', 2).error ?? '', /instance/i);
});
