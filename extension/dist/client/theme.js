export function normalizeTheme(value) {
    return value === 'light' ? 'light' : 'dark';
}
export function nextTheme(theme) {
    return theme === 'dark' ? 'light' : 'dark';
}
export function themeToggleView(theme) {
    return theme === 'dark'
        ? { icon: '☀', label: 'Switch to light theme', pressed: false }
        : { icon: '☾', label: 'Switch to dark theme', pressed: true };
}
