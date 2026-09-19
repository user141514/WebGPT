import assert from 'node:assert/strict';
import test from 'node:test';
import { openVerifiedClientTab } from '../src/extension/client-tab.ts';

test('keeps a newly opened client tab only after relay verification succeeds', async () => {
  const actions: string[] = [];
  const result = await openVerifiedClientTab('http://127.0.0.1:4317/?fresh=1', {
    create: async (url) => {
      actions.push(`create:${url}`);
      return 42;
    },
    prepare: async (tabId) => {
      actions.push(`prepare:${tabId}`);
    },
    verify: async (tabId) => {
      actions.push(`verify:${tabId}`);
    },
    remove: async (tabId) => {
      actions.push(`remove:${tabId}`);
    }
  });

  assert.deepEqual(result, {
    tabId: 42,
    url: 'http://127.0.0.1:4317/?fresh=1'
  });
  assert.deepEqual(actions, [
    'create:http://127.0.0.1:4317/?fresh=1',
    'prepare:42',
    'verify:42'
  ]);
});

test('closes the newly opened client tab when relay preparation or verification fails', async () => {
  const actions: string[] = [];
  await assert.rejects(
    () => openVerifiedClientTab('http://127.0.0.1:4317/?fresh=1', {
      create: async () => {
        actions.push('create');
        return 7;
      },
      prepare: async () => {
        actions.push('prepare');
        throw new Error('relay injection failed');
      },
      verify: async () => {
        actions.push('verify');
      },
      remove: async (tabId) => {
        actions.push(`remove:${tabId}`);
      }
    }),
    /relay injection failed/
  );

  assert.deepEqual(actions, ['create', 'prepare', 'remove:7']);
});
