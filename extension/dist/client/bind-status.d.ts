export type BindStatusState = 'idle' | 'binding' | 'bound' | 'error';
export interface BindStatusInput {
    state: BindStatusState;
    title?: string;
    url?: string;
    tabId?: number;
    messages?: number;
    error?: string;
}
export interface BindStatusView {
    tone: BindStatusState;
    title: string;
    detail: string;
}
export declare function bindStatusView(input: BindStatusInput): BindStatusView;
