import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function importAttempts(path: string, location: { port: string; pathname: string }): Promise<number> {
  const source = await readFile(path, 'utf8');
  const executable = source.replaceAll('import(', '__import__(');
  let attempts = 0;
  const __import__ = (_url: string) => {
    attempts += 1;
    return Promise.resolve({});
  };
  const chrome = { runtime: { getURL: (value: string) => value } };
  const console = { error: () => {} };
  const globalThisValue: Record<string, unknown> = {};
  const run = new Function(
    'chrome',
    'location',
    'console',
    'globalThis',
    '__import__',
    executable
  );

  run(chrome, location, console, globalThisValue, __import__);
  await Promise.resolve();
  run(chrome, location, console, globalThisValue, __import__);
  await Promise.resolve();
  return attempts;
}

test('content-script loader retries module loading when reinjected after an extension reload', async () => {
  assert.equal(
    await importAttempts('extension/content-script-loader.js', {
      port: '',
      pathname: '/c/target'
    }),
    2
  );
});

test('client relay loader retries module loading when reinjected after an extension reload', async () => {
  assert.equal(
    await importAttempts('extension/client-relay-loader.js', {
      port: '4317',
      pathname: '/'
    }),
    2
  );
});
