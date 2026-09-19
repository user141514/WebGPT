import type { ProviderRuntimeEvent } from './content-controller.js';
export interface ProviderTab {
    id?: number;
    windowId?: number;
    url?: string;
    pendingUrl?: string;
    active?: boolean;
    status?: string;
}
export interface ProviderEventEnvelope {
    type: 'provider.event';
    requestId: string;
    clientRequestId?: string;
    event: ProviderRuntimeEvent;
    tabId?: number;
}
export declare function stableConversationUrl(value: string | undefined | null): string | null;
export declare function chatGptPageUrl(value: string | undefined | null): string | null;
export declare function chooseConversationUrl(preferred?: string | null, fallback?: string | null): string;
export declare function authoritativeConversationUrl(tab: ProviderTab, reportedUrl?: string | null, fallbackUrl?: string | null): string;
export declare function isChatGptUrl(value: string | undefined): boolean;
export interface ConversationBinding {
    tabId: number;
    windowId?: number;
    url: string;
}
export declare function tabsForConversation(tabs: ProviderTab[], stored: ConversationBinding | null, expectedUrl: string): ProviderTab[];
export declare function chatGptTabsInPriorityOrder(tabs: ProviderTab[]): ProviderTab[];
export declare function chooseChatGptTab(tabs: ProviderTab[]): ProviderTab | null;
export declare function chooseConversationNavigationTab(tabs: ProviderTab[], currentBinding: ConversationBinding | null, targetUrl: string): ProviderTab | null;
export declare function sendToExistingConversationTab<T>(tabs: ProviderTab[], stored: ConversationBinding | null, expectedUrl: string, send: (tab: ProviderTab) => Promise<T>, reattach?: (tab: ProviderTab) => Promise<void>): Promise<{
    tab: ProviderTab;
    result: T;
}>;
export declare function sendToBoundConversationTab<T>(tabs: ProviderTab[], stored: ConversationBinding | null, expectedUrl: string, send: (tab: ProviderTab) => Promise<T>, reattach?: (tab: ProviderTab) => Promise<void>): Promise<{
    tab: ProviderTab;
    result: T;
}>;
export declare function sendToFirstResponsiveChatGptTab<T>(tabs: ProviderTab[], send: (tab: ProviderTab) => Promise<T>): Promise<{
    tab: ProviderTab;
    result: T;
}>;
export declare class ProviderRequestGate {
    private phase;
    private requestId;
    begin(): boolean;
    activate(requestId: string): boolean;
    abort(): void;
    release(requestId: string): boolean;
}
export declare class RequestRouteRegistry {
    private readonly routes;
    bind(requestId: string, providerTabId: number, clientTabId: number | undefined, conversationId: string, clientRequestId?: string): void;
    acceptsProviderEvent(requestId: string, senderTabId: number | undefined): boolean;
    clientTabId(requestId: string): number | null;
    conversationId(requestId: string): string | null;
    clientRequestId(requestId: string): string | null;
    release(requestId: string): void;
}
export declare function shouldPersistProviderBinding(event: ProviderRuntimeEvent): boolean;
export declare function providerEventEnvelope(requestId: string, event: ProviderRuntimeEvent, tabId?: number, clientRequestId?: string): ProviderEventEnvelope;
