import assert from 'node:assert/strict';
import test from 'node:test';
import { bindStatusView } from '../src/client/bind-status.ts';

test('renders explicit idle, binding, bound, and error states for direct URL binding', () => {
  assert.deepEqual(bindStatusView({ state: 'idle' }), {
    tone: 'idle',
    title: 'No conversation bound',
    detail: 'Paste the URL of an already-open ChatGPT conversation.'
  });

  assert.deepEqual(bindStatusView({
    state: 'binding',
    url: 'https://chatgpt.com/c/abc'
  }), {
    tone: 'binding',
    title: 'Binding…',
    detail: 'https://chatgpt.com/c/abc'
  });

  assert.deepEqual(bindStatusView({
    state: 'bound',
    title: 'Example',
    url: 'https://chatgpt.com/c/abc',
    tabId: 42,
    messages: 7
  }), {
    tone: 'bound',
    title: 'Bound · Example',
    detail: 'Exact tab #42 · 7 messages visible'
  });

  assert.deepEqual(bindStatusView({
    state: 'error',
    error: 'Target ChatGPT conversation must already be open in the browser'
  }), {
    tone: 'error',
    title: 'Bind failed',
    detail: 'Target ChatGPT conversation must already be open in the browser'
  });
});
