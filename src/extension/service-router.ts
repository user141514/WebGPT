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

export function stableConversationUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://chatgpt.com') return null;
    const rootMatch = url.pathname.match(/^\/c\/[^/]+/);
    if (rootMatch) return `${url.origin}${rootMatch[0]}`;
    const projectMatch = url.pathname.match(/^\/g\/g-p-[^/]+\/c\/[^/]+/);
    return projectMatch ? `${url.origin}${projectMatch[0]}` : null;
  } catch {
    return null;
  }
}

export function chatGptPageUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://chatgpt.com') return null;
    const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function chooseConversationUrl(preferred?: string | null, fallback?: string | null): string {
  return stableConversationUrl(preferred)
    ?? stableConversationUrl(fallback)
    ?? chatGptPageUrl(preferred)
    ?? chatGptPageUrl(fallback)
    ?? 'https://chatgpt.com/';
}

export function authoritativeConversationUrl(
  tab: ProviderTab,
  reportedUrl?: string | null,
  fallbackUrl?: string | null
): string {
  const actual = chatGptPageUrl(tab.url);
  if (actual) return chooseConversationUrl(actual);
  const reported = chatGptPageUrl(reportedUrl);
  if (reported) return chooseConversationUrl(reported);
  const pending = chatGptPageUrl(tab.pendingUrl);
  if (pending) return chooseConversationUrl(pending);
  return chooseConversationUrl(fallbackUrl);
}

export function isChatGptUrl(value: string | undefined): boolean {
  return chatGptPageUrl(value) !== null;
}

function tabUrl(tab: ProviderTab): string | undefined {
  return tab.url ?? tab.pendingUrl;
}

export interface ConversationBinding {
  tabId: number;
  windowId?: number;
  url: string;
}

function tabMatchesExpectedUrl(tab: ProviderTab, expectedUrl: string): boolean {
  const expectedStable = stableConversationUrl(expectedUrl);
  if (expectedStable) return stableConversationUrl(tabUrl(tab)) === expectedStable;
  return chatGptPageUrl(tabUrl(tab)) === chatGptPageUrl(expectedUrl);
}

export function tabsForConversation(
  tabs: ProviderTab[],
  stored: ConversationBinding | null,
  expectedUrl: string
): ProviderTab[] {
  const candidates = tabs.filter((tab) => Number.isInteger(tab.id) && isChatGptUrl(tabUrl(tab)));
  const storedTab = stored
    ? candidates.find((tab) => tab.id === stored.tabId && tabMatchesExpectedUrl(tab, expectedUrl)) ?? null
    : null;
  const stable = stableConversationUrl(expectedUrl);
  if (!stable) {
    return storedTab ? [storedTab] : [];
  }

  const matching = candidates.filter((tab) => tabMatchesExpectedUrl(tab, expectedUrl));
  const ordered = [
    ...matching.filter((tab) => tab.active),
    ...matching.filter((tab) => !tab.active)
  ];
  return storedTab
    ? [storedTab, ...ordered.filter((tab) => tab.id !== storedTab.id)]
    : ordered;
}

export function chatGptTabsInPriorityOrder(tabs: ProviderTab[]): ProviderTab[] {
  const candidates = tabs.filter((tab) => Number.isInteger(tab.id) && isChatGptUrl(tabUrl(tab)));
  return [
    ...candidates.filter((tab) => tab.active),
    ...candidates.filter((tab) => !tab.active)
  ];
}

export function chooseChatGptTab(tabs: ProviderTab[]): ProviderTab | null {
  return chatGptTabsInPriorityOrder(tabs)[0] ?? null;
}

export function chooseConversationNavigationTab(
  tabs: ProviderTab[],
  currentBinding: ConversationBinding | null,
  targetUrl: string
): ProviderTab | null {
  const exactTarget = tabsForConversation(tabs, null, targetUrl)[0] ?? null;
  if (exactTarget) return exactTarget;

  if (currentBinding) {
    const currentStable = stableConversationUrl(currentBinding.url);
    const current = tabs.find((tab) => (
      tab.id === currentBinding.tabId
      && isChatGptUrl(tabUrl(tab))
      && stableConversationUrl(tabUrl(tab)) === currentStable
    ));
    if (current) return current;
  }

  return chooseChatGptTab(tabs);
}

export async function sendToExistingConversationTab<T>(
  tabs: ProviderTab[],
  stored: ConversationBinding | null,
  expectedUrl: string,
  send: (tab: ProviderTab) => Promise<T>,
  reattach?: (tab: ProviderTab) => Promise<void>
): Promise<{ tab: ProviderTab; result: T }> {
  const candidates = tabsForConversation(tabs, stored, expectedUrl);
  if (!candidates.length) {
    throw new Error('Target ChatGPT conversation must already be open in the browser');
  }

  let lastError: unknown = null;
  for (const tab of candidates) {
    try {
      return { tab, result: await send(tab) };
    } catch (error) {
      lastError = error;
    }

    if (!reattach) continue;
    try {
      await reattach(tab);
      return { tab, result: await send(tab) };
    } catch (error) {
      lastError = error;
    }
  }

  void lastError;
  throw new Error('Target ChatGPT conversation is open but the extension is not connected to that tab');
}

export async function sendToBoundConversationTab<T>(
  tabs: ProviderTab[],
  stored: ConversationBinding | null,
  expectedUrl: string,
  send: (tab: ProviderTab) => Promise<T>,
  reattach?: (tab: ProviderTab) => Promise<void>
): Promise<{ tab: ProviderTab; result: T }> {
  if (!stored) {
    throw new Error('Conversation is not bound to a browser tab; re-bind the ChatGPT URL');
  }

  const boundTab = tabs.find((tab) => (
    tab.id === stored.tabId
    && Number.isInteger(tab.id)
    && tabMatchesExpectedUrl(tab, expectedUrl)
  )) ?? null;
  if (!boundTab) {
    throw new Error('Bound ChatGPT tab is no longer available at that URL; re-bind the ChatGPT URL');
  }

  try {
    return { tab: boundTab, result: await send(boundTab) };
  } catch (firstError) {
    if (!reattach) throw firstError;
  }

  try {
    await reattach!(boundTab);
    return { tab: boundTab, result: await send(boundTab) };
  } catch {
    throw new Error('Bound ChatGPT tab is disconnected; re-bind the ChatGPT URL');
  }
}

export async function sendToFirstResponsiveChatGptTab<T>(
  tabs: ProviderTab[],
  send: (tab: ProviderTab) => Promise<T>
): Promise<{ tab: ProviderTab; result: T }> {
  const candidates = chatGptTabsInPriorityOrder(tabs);
  if (!candidates.length) throw new Error('No ChatGPT tab is available');

  let lastError: unknown = new Error('No ChatGPT tab has a receiving content script');
  for (const tab of candidates) {
    try {
      return { tab, result: await send(tab) };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export class ProviderRequestGate {
  private phase: 'idle' | 'submitting' | 'active' = 'idle';
  private requestId: string | null = null;

  begin(): boolean {
    if (this.phase !== 'idle') return false;
    this.phase = 'submitting';
    this.requestId = null;
    return true;
  }

  activate(requestId: string): boolean {
    if (this.phase !== 'submitting' || !requestId) return false;
    this.phase = 'active';
    this.requestId = requestId;
    return true;
  }

  abort(): void {
    if (this.phase !== 'submitting') return;
    this.phase = 'idle';
    this.requestId = null;
  }

  release(requestId: string): boolean {
    if (this.phase !== 'active' || this.requestId !== requestId) return false;
    this.phase = 'idle';
    this.requestId = null;
    return true;
  }
}

interface RequestRoute {
  providerTabId: number;
  clientTabId?: number;
  conversationId: string;
  clientRequestId?: string;
}

export class RequestRouteRegistry {
  private readonly routes = new Map<string, RequestRoute>();

  bind(
    requestId: string,
    providerTabId: number,
    clientTabId: number | undefined,
    conversationId: string,
    clientRequestId?: string
  ): void {
    this.routes.set(requestId, {
      providerTabId,
      ...(clientTabId === undefined ? {} : { clientTabId }),
      conversationId,
      ...(clientRequestId ? { clientRequestId } : {})
    });
  }

  acceptsProviderEvent(requestId: string, senderTabId: number | undefined): boolean {
    const route = this.routes.get(requestId);
    return Boolean(route && senderTabId !== undefined && route.providerTabId === senderTabId);
  }

  clientTabId(requestId: string): number | null {
    return this.routes.get(requestId)?.clientTabId ?? null;
  }

  conversationId(requestId: string): string | null {
    return this.routes.get(requestId)?.conversationId ?? null;
  }

  clientRequestId(requestId: string): string | null {
    return this.routes.get(requestId)?.clientRequestId ?? null;
  }

  release(requestId: string): void {
    this.routes.delete(requestId);
  }
}

export function shouldPersistProviderBinding(event: ProviderRuntimeEvent): boolean {
  return event.type === 'request.accepted'
    || event.type === 'assistant.completed'
    || event.type === 'provider.error';
}

export function providerEventEnvelope(
  requestId: string,
  event: ProviderRuntimeEvent,
  tabId?: number,
  clientRequestId?: string
): ProviderEventEnvelope {
  return {
    type: 'provider.event',
    requestId,
    ...(clientRequestId ? { clientRequestId } : {}),
    event,
    ...(tabId === undefined ? {} : { tabId })
  };
}
