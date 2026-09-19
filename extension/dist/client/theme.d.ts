export type WebGptTheme = 'dark' | 'light';
export interface ThemeToggleView {
    icon: string;
    label: string;
    pressed: boolean;
}
export declare function normalizeTheme(value: string | null | undefined): WebGptTheme;
export declare function nextTheme(theme: WebGptTheme): WebGptTheme;
export declare function themeToggleView(theme: WebGptTheme): ThemeToggleView;
