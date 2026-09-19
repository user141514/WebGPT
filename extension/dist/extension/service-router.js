export function stableConversationUrl(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        if (url.origin !== 'https://chatgpt.com')
            return null;
        const rootMatch = url.pathname.match(/^\/c\/[^/]+/);
        if (rootMatch)
            return `${url.origin}${rootMatch[0]}`;
        const projectMatch = url.pathname.match(/^\/g\/g-p-[^/]+\/c\/[^/]+/);
        return projectMatch ? `${url.origin}${projectMatch[0]}` : null;
    }
    catch {
        return null;
    }
}
export function chatGptPageUrl(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        if (url.origin !== 'https://chatgpt.com')
            return null;
        const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
        return `${url.origin}${pathname}`;
    }
    catch {
        return null;
    }
}
export function chooseConversationUrl(preferred, fallback) {
    return stableConversationUrl(preferred)
        ?? stableConversationUrl(fallback)
        ?? chatGptPageUrl(preferred)
        ?? chatGptPageUrl(fallback)
        ?? 'https://chatgpt.com/';
}
export function authoritativeConversationUrl(tab, reportedUrl, fallbackUrl) {
    const actual = chatGptPageUrl(tab.url);
    if (actual)
        return chooseConversationUrl(actual);
    const reported = chatGptPageUrl(reportedUrl);
    if (reported)
        return chooseConversationUrl(reported);
    const pending = chatGptPageUrl(tab.pendingUrl);
    if (pending)
        return chooseConversationUrl(pending);
    return chooseConversationUrl(fallbackUrl);
}
export function isChatGptUrl(value) {
    return chatGptPageUrl(value) !== null;
}
function tabUrl(tab) {
    return tab.url ?? tab.pendingUrl;
}
function tabMatchesExpectedUrl(tab, expectedUrl) {
    const expectedStable = stableConversationUrl(expectedUrl);
    if (expectedStable)
        return stableConversationUrl(tabUrl(tab)) === expectedStable;
    return chatGptPageUrl(tabUrl(tab)) === chatGptPageUrl(expectedUrl);
}
export function tabsForConversation(tabs, stored, expectedUrl) {
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
export function chatGptTabsInPriorityOrder(tabs) {
    const candidates = tabs.filter((tab) => Number.isInteger(tab.id) && isChatGptUrl(tabUrl(tab)));
    return [
        ...candidates.filter((tab) => tab.active),
        ...candidates.filter((tab) => !tab.active)
    ];
}
export function chooseChatGptTab(tabs) {
    return chatGptTabsInPriorityOrder(tabs)[0] ?? null;
}
export function chooseConversationNavigationTab(tabs, currentBinding, targetUrl) {
    const exactTarget = tabsForConversation(tabs, null, targetUrl)[0] ?? null;
    if (exactTarget)
        return exactTarget;
    if (currentBinding) {
        const currentStable = stableConversationUrl(currentBinding.url);
        const current = tabs.find((tab) => (tab.id === currentBinding.tabId
            && isChatGptUrl(tabUrl(tab))
            && stableConversationUrl(tabUrl(tab)) === currentStable));
        if (current)
            return current;
    }
    return chooseChatGptTab(tabs);
}
export async function sendToExistingConversationTab(tabs, stored, expectedUrl, send, reattach) {
    const candidates = tabsForConversation(tabs, stored, expectedUrl);
    if (!candidates.length) {
        throw new Error('Target ChatGPT conversation must already be open in the browser');
    }
    let lastError = null;
    for (const tab of candidates) {
        try {
            return { tab, result: await send(tab) };
        }
        catch (error) {
            lastError = error;
        }
        if (!reattach)
            continue;
        try {
            await reattach(tab);
            return { tab, result: await send(tab) };
        }
        catch (error) {
            lastError = error;
        }
    }
    void lastError;
    throw new Error('Target ChatGPT conversation is open but the extension is not connected to that tab');
}
export async function sendToBoundConversationTab(tabs, stored, expectedUrl, send, reattach) {
    if (!stored) {
        throw new Error('Conversation is not bound to a browser tab; re-bind the ChatGPT URL');
    }
    const boundTab = tabs.find((tab) => (tab.id === stored.tabId
        && Number.isInteger(tab.id)
        && tabMatchesExpectedUrl(tab, expectedUrl))) ?? null;
    if (!boundTab) {
        throw new Error('Bound ChatGPT tab is no longer available at that URL; re-bind the ChatGPT URL');
    }
    try {
        return { tab: boundTab, result: await send(boundTab) };
    }
    catch (firstError) {
        if (!reattach)
            throw firstError;
    }
    try {
        await reattach(boundTab);
        return { tab: boundTab, result: await send(boundTab) };
    }
    catch {
        throw new Error('Bound ChatGPT tab is disconnected; re-bind the ChatGPT URL');
    }
}
export async function sendToFirstResponsiveChatGptTab(tabs, send) {
    const candidates = chatGptTabsInPriorityOrder(tabs);
    if (!candidates.length)
        throw new Error('No ChatGPT tab is available');
    let lastError = new Error('No ChatGPT tab has a receiving content script');
    for (const tab of candidates) {
        try {
            return { tab, result: await send(tab) };
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
export class ProviderRequestGate {
    phase = 'idle';
    requestId = null;
    begin() {
        if (this.phase !== 'idle')
            return false;
        this.phase = 'submitting';
        this.requestId = null;
        return true;
    }
    activate(requestId) {
        if (this.phase !== 'submitting' || !requestId)
            return false;
        this.phase = 'active';
        this.requestId = requestId;
        return true;
    }
    abort() {
        if (this.phase !== 'submitting')
            return;
        this.phase = 'idle';
        this.requestId = null;
    }
    release(requestId) {
        if (this.phase !== 'active' || this.requestId !== requestId)
            return false;
        this.phase = 'idle';
        this.requestId = null;
        return true;
    }
}
export class RequestRouteRegistry {
    routes = new Map();
    bind(requestId, providerTabId, clientTabId, conversationId, clientRequestId) {
        this.routes.set(requestId, {
            providerTabId,
            ...(clientTabId === undefined ? {} : { clientTabId }),
            conversationId,
            ...(clientRequestId ? { clientRequestId } : {})
        });
    }
    acceptsProviderEvent(requestId, senderTabId) {
        const route = this.routes.get(requestId);
        return Boolean(route && senderTabId !== undefined && route.providerTabId === senderTabId);
    }
    clientTabId(requestId) {
        return this.routes.get(requestId)?.clientTabId ?? null;
    }
    conversationId(requestId) {
        return this.routes.get(requestId)?.conversationId ?? null;
    }
    clientRequestId(requestId) {
        return this.routes.get(requestId)?.clientRequestId ?? null;
    }
    release(requestId) {
        this.routes.delete(requestId);
    }
}
export function shouldPersistProviderBinding(event) {
    return event.type === 'request.accepted'
        || event.type === 'assistant.completed'
        || event.type === 'provider.error';
}
export function providerEventEnvelope(requestId, event, tabId, clientRequestId) {
    return {
        type: 'provider.event',
        requestId,
        ...(clientRequestId ? { clientRequestId } : {}),
        event,
        ...(tabId === undefined ? {} : { tabId })
    };
}
