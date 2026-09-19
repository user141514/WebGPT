export type WebGptTheme = 'dark' | 'light';

export interface ThemeToggleView {
  icon: string;
  label: string;
  pressed: boolean;
}

export function normalizeTheme(value: string | null | undefined): WebGptTheme {
  return value === 'light' ? 'light' : 'dark';
}

export function nextTheme(theme: WebGptTheme): WebGptTheme {
  return theme === 'dark' ? 'light' : 'dark';
}

export function themeToggleView(theme: WebGptTheme): ThemeToggleView {
  return theme === 'dark'
    ? { icon: '☀', label: 'Switch to light theme', pressed: false }
    : { icon: '☾', label: 'Switch to dark theme', pressed: true };
}
