import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTheme, nextTheme, themeToggleView } from '../src/client/theme.ts';

test('normalizes persisted WebGPT theme values and falls back to dark', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('warm'), 'dark');
  assert.equal(normalizeTheme(null), 'dark');
});

test('toggles only between dark and light and exposes the action target', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');

  assert.deepEqual(themeToggleView('dark'), {
    icon: '☀',
    label: 'Switch to light theme',
    pressed: false
  });
  assert.deepEqual(themeToggleView('light'), {
    icon: '☾',
    label: 'Switch to dark theme',
    pressed: true
  });
});
