import { parseChatGptRoute } from '../catalog.js';
import { CatalogCoordinator } from './catalog-coordinator.js';
import { openVerifiedClientTab } from './client-tab.js';
import { CatalogStore } from './catalog-store.js';
import { ConversationBindingWriteQueue, ConversationUrlMap } from './conversation-map.js';
import { LAST_RELOAD_KEY, PENDING_RELOAD_KEY, isExtensionControlPageUrl, verifyReloadReceipt } from './reload-control.js';
import { authoritativeConversationUrl, chatGptPageUrl, chooseConversationNavigationTab, chooseConversationUrl, providerEventEnvelope, shouldPersistProviderBinding, ProviderRequestGate, RequestRouteRegistry, sendToBoundConversationTab, sendToExistingConversationTab, sendToFirstResponsiveChatGptTab, stableConversationUrl } from './service-router.js';
const routes = new RequestRouteRegistry();
const requestGate = new ProviderRequestGate();
const conversationMap = new ConversationUrlMap(chrome.storage.local);
const catalogStore = new CatalogStore(chrome.storage.local);
const runtimeInstanceId = crypto.randomUUID();
const runtimeBuildInfoPromise = loadRuntimeBuildInfo();
const providerBindingPersistence = new ConversationBindingWriteQueue();
function scheduleProviderBindingPersistence(conversationId, tab, reportedUrl) {
    return providerBindingPersistence.enqueue(conversationId, async () => {
        const current = await conversationMap.load(conversationId);
        await conversationMap.save(conversationId, {
            tabId: tab.id,
            windowId: tab.windowId,
            url: authoritativeConversationUrl(tab, reportedUrl, current?.url),
            fallbackUrl: current?.url
        });
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function loadRuntimeBuildInfo() {
    const response = await fetch(chrome.runtime.getURL('build.json'), { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`Could not load extension build metadata: HTTP ${response.status}`);
    const value = await response.json();
    if (typeof value.buildId !== 'string' || !value.buildId)
        throw new Error('Extension buildId is missing');
    return {
        buildId: value.buildId,
        builtAt: typeof value.builtAt === 'string' ? value.builtAt : '',
        version: typeof value.version === 'string' ? value.version : String(chrome.runtime.getManifest().version ?? '')
    };
}
async function waitForContentScript(tabId, maxAttempts = 80) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { type: 'driver.ping' });
            if (response?.ready === true)
                return;
        }
        catch (error) {
            lastError = error;
        }
        await sleep(250);
    }
    throw lastError ?? new Error('ChatGPT content script did not become ready');
}
async function waitForClientRelay(tabId, maxAttempts = 40) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { type: 'client.ping' });
            if (response?.ready === true)
                return;
        }
        catch (error) {
            lastError = error;
        }
        await sleep(250);
    }
    throw lastError ?? new Error('Human Client relay did not become ready');
}
async function waitForTabComplete(tabId, maxAttempts = 40) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === 'complete')
            return;
        await sleep(250);
    }
    throw new Error(`Timed out waiting for managed tab ${tabId} to finish loading`);
}
async function waitForTabUrl(tabId, expectedUrl, maxAttempts = 80) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const tab = await chrome.tabs.get(tabId);
        const current = typeof tab?.url === 'string' ? tab.url : '';
        if (current.startsWith(expectedUrl) && tab.status === 'complete')
            return;
        await sleep(250);
    }
    throw new Error(`Timed out waiting for ChatGPT navigation to ${expectedUrl}`);
}
async function waitForProjectNavigation(tabId, beforeUrl, maxAttempts = 80) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const tab = await chrome.tabs.get(tabId);
        const current = typeof tab?.url === 'string' ? tab.url : '';
        const route = parseChatGptRoute(current);
        if (current !== beforeUrl && route?.kind === 'project' && tab.status === 'complete')
            return current;
        await sleep(250);
    }
    throw new Error('Timed out waiting for project navigation');
}
const PROVIDER_TAB_KEY = 'chatgpt-web-driver.managed.provider-tab-id';
const SCRATCH_TAB_KEY = 'chatgpt-web-driver.managed.scratch-tab-id';
async function storedManagedTabId(key) {
    const stored = await chrome.storage.session.get(key);
    return Number.isInteger(stored[key]) ? stored[key] : null;
}
async function ensureManagedTab(key, url) {
    const storedId = await storedManagedTabId(key);
    if (storedId !== null) {
        try {
            const existing = await chrome.tabs.get(storedId);
            if (existing?.id === storedId) {
                const current = typeof existing.url === 'string' ? existing.url : '';
                if (current !== url) {
                    await chrome.tabs.update(storedId, { url, active: false });
                    await waitForTabUrl(storedId, url);
                }
                return storedId;
            }
        }
        catch {
            await chrome.storage.session.remove(key);
        }
    }
    const created = await chrome.tabs.create({ url, active: false });
    if (!Number.isInteger(created?.id))
        throw new Error('Chrome did not return a managed ChatGPT tab');
    await chrome.storage.session.set({ [key]: created.id });
    return created.id;
}
async function parkScratchTab(tabId) {
    try {
        await chrome.tabs.remove(tabId).catch(() => { });
    }
    finally {
        await chrome.storage.session.remove(SCRATCH_TAB_KEY).catch(() => { });
    }
}
const scratchStartupCleanup = (async () => {
    const existing = await storedManagedTabId(SCRATCH_TAB_KEY);
    if (existing !== null)
        await parkScratchTab(existing);
})().catch(() => { });
let scratchTail = Promise.resolve();
const scratchReleases = new Map();
async function acquireScratchTab(url) {
    await scratchStartupCleanup;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const previous = scratchTail;
    scratchTail = previous.then(() => gate);
    await previous;
    try {
        const tabId = await ensureManagedTab(SCRATCH_TAB_KEY, url);
        scratchReleases.set(tabId, release);
        return tabId;
    }
    catch (error) {
        release();
        throw error;
    }
}
async function releaseScratchTab(tabId) {
    try {
        await parkScratchTab(tabId);
    }
    finally {
        scratchReleases.get(tabId)?.();
        scratchReleases.delete(tabId);
    }
}
async function managedDriverTabIds() {
    const [provider, scratch] = await Promise.all([
        storedManagedTabId(PROVIDER_TAB_KEY),
        storedManagedTabId(SCRATCH_TAB_KEY)
    ]);
    return new Set([provider, scratch].filter((value) => value !== null));
}
class ChromeCatalogBrowser {
    async create(url) {
        return acquireScratchTab(url);
    }
    async update(tabId, url) {
        await chrome.tabs.update(tabId, { url, active: false });
        await waitForTabUrl(tabId, url);
    }
    async waitReady(tabId) {
        await waitForContentScript(tabId);
    }
    async listProjects(tabId) {
        let lastError = '';
        for (let attempt = 0; attempt < 48; attempt += 1) {
            try {
                const result = await chrome.tabs.sendMessage(tabId, { type: 'driver.catalog.projects' });
                if (result?.ok !== true || !Array.isArray(result.projects)) {
                    lastError = result?.error || 'ChatGPT project discovery failed';
                }
                else {
                    const projects = result.projects.filter((candidate) => (Number.isInteger(candidate?.index)
                        && typeof candidate?.title === 'string'
                        && candidate.title.trim()));
                    if (projects.length)
                        return projects;
                }
            }
            catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            await sleep(250);
        }
        if (lastError)
            throw new Error(lastError);
        return [];
    }
    async openProject(tabId, candidate) {
        const before = await chrome.tabs.get(tabId);
        const beforeUrl = typeof before?.url === 'string' ? before.url : '';
        let lastError = '';
        for (let attempt = 0; attempt < 48; attempt += 1) {
            try {
                const result = await chrome.tabs.sendMessage(tabId, {
                    type: 'driver.catalog.project.open',
                    candidate
                });
                if (result?.ok === true)
                    return waitForProjectNavigation(tabId, beforeUrl);
                lastError = result?.error || `Could not open project ${candidate.title}`;
            }
            catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            await sleep(250);
        }
        throw new Error(lastError || `Could not open project ${candidate.title}`);
    }
    async scan(tabId) {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'driver.catalog.scan' });
        if (result?.ok !== true || !result.catalog) {
            throw new Error(result?.error || 'ChatGPT catalog scan failed');
        }
        return result.catalog;
    }
    async remove(tabId) {
        await releaseScratchTab(tabId);
    }
}
const catalogBrowser = new ChromeCatalogBrowser();
const catalogCoordinator = new CatalogCoordinator(catalogBrowser, catalogStore);
async function inspectCatalogProject(url) {
    const route = parseChatGptRoute(url);
    if (route?.kind !== 'project') {
        return { ok: false, error: 'A valid ChatGPT project URL is required' };
    }
    const tabId = await catalogBrowser.create(route.url);
    try {
        await catalogBrowser.waitReady(tabId);
        const beforeResult = await chrome.tabs.sendMessage(tabId, { type: 'driver.catalog.probe' });
        const catalog = await catalogBrowser.scan(tabId);
        const afterResult = await chrome.tabs.sendMessage(tabId, { type: 'driver.catalog.probe' });
        const tab = await chrome.tabs.get(tabId);
        return {
            ok: true,
            inspect: {
                expectedUrl: route.url,
                actualUrl: tab.url ?? tab.pendingUrl ?? '',
                before: beforeResult?.probe ?? null,
                after: afterResult?.probe ?? null,
                catalog
            }
        };
    }
    finally {
        await catalogBrowser.remove(tabId).catch(() => { });
    }
}
async function scanLiveCatalogSeed() {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    const selected = await sendToFirstResponsiveChatGptTab(tabs, async (tab) => {
        if (!tab.id)
            throw new Error('ChatGPT tab has no id');
        return chrome.tabs.sendMessage(tab.id, { type: 'driver.catalog.scan' });
    });
    const result = selected.result;
    if (result?.ok !== true || !result.catalog) {
        throw new Error(result?.error || 'Live ChatGPT catalog scan failed');
    }
    const seedUrl = typeof result.externalUrl === 'string' && result.externalUrl
        ? result.externalUrl
        : (selected.tab.url ?? selected.tab.pendingUrl ?? '');
    if (!seedUrl)
        throw new Error('Live ChatGPT catalog seed URL was unavailable');
    return { catalog: result.catalog, seedUrl };
}
async function closeOtherLocalClientTabs(keepTabId) {
    const tabs = await chrome.tabs.query({});
    const stale = tabs
        .filter((tab) => Number.isInteger(tab?.id) && tab.id !== keepTabId && isLocalClientUrl(tab.url))
        .map((tab) => tab.id);
    for (const tabId of stale)
        await chrome.tabs.remove(tabId).catch(() => { });
    return stale;
}
async function openFreshDirectBindClient() {
    const build = await runtimeBuildInfoPromise;
    const url = `http://127.0.0.1:4317/?fresh=1&ui=direct-bind-v4&build=${encodeURIComponent(build.buildId)}`;
    const opened = await openVerifiedClientTab(url, {
        create: async (targetUrl) => {
            const created = await chrome.tabs.create({ url: targetUrl, active: true });
            if (!Number.isInteger(created?.id))
                throw new Error('Chrome did not return a client tab id');
            return created.id;
        },
        prepare: async (tabId) => {
            await waitForTabComplete(tabId);
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['client-relay-loader.js']
            });
        },
        verify: async (tabId) => {
            await waitForClientRelay(tabId, 24);
        },
        remove: async (tabId) => {
            await chrome.tabs.remove(tabId);
        }
    });
    return { ok: true, ...opened, buildId: build.buildId };
}
function isLocalClientUrl(value) {
    if (!value)
        return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:'
            && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
            && url.port === '4317';
    }
    catch {
        return false;
    }
}
async function reportExtensionControl(requestId, payload, controlOrigin = 'http://127.0.0.1:4318') {
    await fetch(`${controlOrigin}/__extension-control?requestId=${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });
}
async function cleanupLegacyControlTabs(excludeTabId) {
    const tabs = await chrome.tabs.query({});
    const stale = tabs
        .filter((tab) => Number.isInteger(tab?.id) && tab.id !== excludeTabId && isExtensionControlPageUrl(tab.url))
        .map((tab) => tab.id);
    for (const tabId of stale)
        await chrome.tabs.remove(tabId).catch(() => { });
    return stale;
}
async function reattachExistingConversationTab(tab) {
    if (!Number.isInteger(tab.id))
        throw new Error('ChatGPT tab has no id');
    if (tab.status === 'loading')
        await waitForTabComplete(tab.id);
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script-loader.js']
    });
    await sleep(75);
    await waitForContentScript(tab.id, 24);
}
async function reattachManagedContentScripts(options = {}) {
    const tabs = await chrome.tabs.query({});
    const chatgptTabs = [];
    const clientTabs = [];
    const clients = tabs.filter((tab) => Number.isInteger(tab?.id) && isLocalClientUrl(tab.url));
    const providers = tabs.filter((tab) => Number.isInteger(tab?.id) && chatGptPageUrl(tab.url));
    for (const tab of clients) {
        try {
            if (tab.status === 'loading')
                await waitForTabComplete(tab.id);
            if (options.reloadClients) {
                await chrome.tabs.reload(tab.id);
                await waitForTabComplete(tab.id);
            }
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['client-relay-loader.js']
            });
            await sleep(75);
            await waitForClientRelay(tab.id, 24);
            clientTabs.push(tab.id);
        }
        catch {
            // A stale localhost tab must not block reattaching the control plane to other tabs.
        }
    }
    for (const tab of providers) {
        try {
            if (tab.status === 'loading')
                await waitForTabComplete(tab.id);
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-script-loader.js']
            });
            await sleep(75);
            await waitForContentScript(tab.id, 24);
            chatgptTabs.push(tab.id);
        }
        catch {
            // Stale or navigated ChatGPT tabs are best-effort and cannot fail the reload.
        }
    }
    return { chatgptTabs, clientTabs };
}
async function finalizePendingReload() {
    const stored = await chrome.storage.local.get(PENDING_RELOAD_KEY);
    const pending = stored[PENDING_RELOAD_KEY];
    if (!pending || typeof pending.requestId !== 'string' || !pending.requestId)
        return;
    const build = await runtimeBuildInfoPromise;
    let receipt = verifyReloadReceipt(pending, build.buildId, runtimeInstanceId, Date.now());
    let reattached = { chatgptTabs: [], clientTabs: [] };
    if (receipt.state === 'verified') {
        try {
            reattached = await reattachManagedContentScripts({ reloadClients: true });
        }
        catch (error) {
            receipt = {
                ...receipt,
                state: 'failed',
                error: `Reloaded extension could not reattach managed tabs: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    const payload = { ...receipt, reattached };
    await cleanupLegacyControlTabs(pending.controlTabId);
    await chrome.storage.local.set({ [LAST_RELOAD_KEY]: payload });
    await chrome.storage.local.remove(PENDING_RELOAD_KEY);
    await reportExtensionControl(pending.requestId, payload, pending.controlOrigin).catch(() => { });
    if (Number.isInteger(pending.controlTabId)) {
        await chrome.tabs.remove(pending.controlTabId).catch(() => { });
    }
}
async function extensionStatus(requestId) {
    const build = await runtimeBuildInfoPromise;
    const [stored, tabs, providerTabId, scratchTabId] = await Promise.all([
        chrome.storage.local.get([LAST_RELOAD_KEY, PENDING_RELOAD_KEY]),
        chrome.tabs.query({}),
        storedManagedTabId(PROVIDER_TAB_KEY),
        storedManagedTabId(SCRATCH_TAB_KEY)
    ]);
    const legacyControlTabs = tabs
        .filter((tab) => isExtensionControlPageUrl(tab.url))
        .map((tab) => tab.id)
        .filter((value) => Number.isInteger(value));
    return {
        state: 'status',
        requestId,
        extensionId: chrome.runtime.id,
        version: String(chrome.runtime.getManifest().version ?? ''),
        buildId: build.buildId,
        builtAt: build.builtAt,
        instanceId: runtimeInstanceId,
        lastReloadReceipt: stored[LAST_RELOAD_KEY] ?? null,
        pendingReload: stored[PENDING_RELOAD_KEY] ?? null,
        legacyControlTabs,
        providerTabId,
        scratchTabId
    };
}
async function verifyExtensionReload(message, sender) {
    const requestId = typeof message?.requestId === 'string' ? message.requestId.trim() : '';
    const expectedBuildId = typeof message?.expectedBuildId === 'string' ? message.expectedBuildId.trim() : '';
    const beforeBuildId = typeof message?.beforeBuildId === 'string' ? message.beforeBuildId.trim() : '';
    const beforeInstanceId = typeof message?.beforeInstanceId === 'string' ? message.beforeInstanceId.trim() : '';
    const requestedAt = Number(message?.requestedAt);
    if (!requestId || !expectedBuildId || !beforeBuildId || !beforeInstanceId || !Number.isFinite(requestedAt) || requestedAt <= 0) {
        return { state: 'failed', requestId, error: 'Reload verification requires the accepted reload receipt fields' };
    }
    const build = await runtimeBuildInfoPromise;
    const pending = {
        requestId,
        expectedBuildId,
        beforeBuildId,
        beforeInstanceId,
        requestedAt
    };
    let receipt = verifyReloadReceipt(pending, build.buildId, runtimeInstanceId, Date.now());
    let reattached = { chatgptTabs: [], clientTabs: [] };
    if (receipt.state === 'verified') {
        try {
            reattached = await reattachManagedContentScripts({ reloadClients: false });
        }
        catch (error) {
            receipt = {
                ...receipt,
                state: 'failed',
                error: `Reload verification could not reattach managed tabs: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    const payload = { ...receipt, reattached };
    await cleanupLegacyControlTabs(sender.tab?.id);
    await chrome.storage.local.set({ [LAST_RELOAD_KEY]: payload });
    const stored = await chrome.storage.local.get(PENDING_RELOAD_KEY);
    const storedPending = stored[PENDING_RELOAD_KEY];
    if (storedPending
        && storedPending.expectedBuildId === expectedBuildId
        && storedPending.beforeInstanceId === beforeInstanceId) {
        await chrome.storage.local.remove(PENDING_RELOAD_KEY);
    }
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (!Number.isInteger(tab?.id) || tab.id === sender.tab?.id)
            continue;
        if (isExtensionControlPageUrl(tab.url)) {
            await chrome.tabs.remove(tab.id).catch(() => { });
        }
    }
    return payload;
}
async function startExtensionReload(message, sender) {
    const requestId = typeof message?.requestId === 'string' ? message.requestId.trim() : '';
    const expectedBuildId = typeof message?.expectedBuildId === 'string' ? message.expectedBuildId.trim() : '';
    if (!requestId)
        return { state: 'failed', requestId: '', error: 'requestId is required' };
    if (!expectedBuildId)
        return { state: 'failed', requestId, error: 'expectedBuildId is required' };
    const build = await runtimeBuildInfoPromise;
    const legacyControlPage = isExtensionControlPageUrl(sender.tab?.url);
    const pending = {
        requestId,
        expectedBuildId,
        beforeBuildId: build.buildId,
        beforeInstanceId: runtimeInstanceId,
        requestedAt: Date.now(),
        ...(legacyControlPage && Number.isInteger(sender.tab?.id) ? { controlTabId: sender.tab.id } : {}),
        ...(legacyControlPage ? { controlOrigin: new URL(sender.tab.url).origin } : {})
    };
    await chrome.storage.local.set({ [PENDING_RELOAD_KEY]: pending });
    setTimeout(() => chrome.runtime.reload(), 75);
    return {
        state: 'accepted',
        requestId,
        expectedBuildId,
        beforeBuildId: build.buildId,
        beforeInstanceId: runtimeInstanceId,
        requestedAt: pending.requestedAt
    };
}
async function readConversationSnapshot(tabId, expectedUrl, maxAttempts = 80) {
    let lastResult = null;
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const result = await chrome.tabs.sendMessage(tabId, {
                type: 'driver.conversation.snapshot',
                url: expectedUrl
            });
            lastResult = result;
            if (result?.ok === true && Array.isArray(result.snapshot?.turns) && result.snapshot.turns.length > 0) {
                return result;
            }
            if (result?.ok !== true && typeof result?.error === 'string')
                lastError = new Error(result.error);
        }
        catch (error) {
            lastError = error;
        }
        await sleep(250);
    }
    if (lastResult?.ok === true)
        return lastResult;
    throw lastError ?? new Error('Conversation snapshot did not become available');
}
async function readAndBindConversationSnapshot(tabId, expectedUrl) {
    try {
        const result = await readConversationSnapshot(tabId, expectedUrl);
        if (result?.ok !== true || !result.snapshot) {
            return { ok: false, error: result?.error || 'Conversation snapshot could not be read' };
        }
        const current = await chrome.tabs.get(tabId);
        await conversationMap.save(expectedUrl, {
            tabId,
            windowId: current.windowId,
            url: authoritativeConversationUrl(current, result.externalUrl, expectedUrl),
            fallbackUrl: expectedUrl
        });
        return { ok: true, snapshot: result.snapshot, tabId };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
async function loadConversationSnapshot(url) {
    const expectedUrl = stableConversationUrl(url);
    if (!expectedUrl)
        return { ok: false, error: 'A valid ChatGPT conversation URL is required' };
    const stored = await conversationMap.load(expectedUrl);
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    try {
        const selected = await sendToExistingConversationTab(tabs, stored, expectedUrl, async (candidate) => {
            if (!candidate.id)
                throw new Error('ChatGPT tab has no id');
            await chrome.tabs.sendMessage(candidate.id, { type: 'driver.ping' });
            return true;
        }, reattachExistingConversationTab);
        return readAndBindConversationSnapshot(selected.tab.id, expectedUrl);
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
async function navigateConversationSnapshot(url, fromUrl) {
    const expectedUrl = stableConversationUrl(url);
    if (!expectedUrl)
        return { ok: false, error: 'A valid ChatGPT conversation URL is required' };
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    const currentStable = stableConversationUrl(fromUrl);
    const currentBinding = currentStable ? await conversationMap.load(currentStable) : null;
    const target = chooseConversationNavigationTab(tabs, currentBinding, expectedUrl);
    if (!target?.id) {
        return {
            ok: false,
            error: 'Open at least one ChatGPT tab before switching conversations from the sidebar'
        };
    }
    const currentTargetUrl = stableConversationUrl(target.url ?? target.pendingUrl);
    try {
        if (currentTargetUrl !== expectedUrl) {
            await chrome.tabs.update(target.id, { url: expectedUrl });
            await waitForTabUrl(target.id, expectedUrl);
            const navigated = await chrome.tabs.get(target.id);
            await reattachExistingConversationTab(navigated);
        }
        else {
            try {
                await chrome.tabs.sendMessage(target.id, { type: 'driver.ping' });
            }
            catch {
                await reattachExistingConversationTab(target);
            }
        }
        return readAndBindConversationSnapshot(target.id, expectedUrl);
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
async function probeConversation(url) {
    const expectedUrl = stableConversationUrl(url);
    if (!expectedUrl)
        return { ok: false, error: 'A valid ChatGPT conversation URL is required' };
    const loaded = await loadConversationSnapshot(expectedUrl);
    if (loaded?.ok !== true)
        return loaded;
    const binding = await conversationMap.load(expectedUrl);
    if (!binding?.tabId)
        return { ok: false, error: 'Conversation tab binding was not available after load' };
    try {
        await waitForContentScript(binding.tabId);
        const result = await chrome.tabs.sendMessage(binding.tabId, {
            type: 'driver.conversation.probe',
            url: expectedUrl
        });
        if (result?.ok !== true || !result.probe) {
            return { ok: false, error: result?.error || 'Conversation DOM probe failed' };
        }
        return { ok: true, probe: result.probe };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
async function submitToProvider(message, clientTabId, requestId) {
    if (typeof message?.conversationId !== 'string' || !message.conversationId) {
        return { started: false, error: 'conversationId is required' };
    }
    if (typeof message?.text !== 'string' || !message.text.trim()) {
        return { started: false, error: 'Prompt text is required' };
    }
    const stored = await conversationMap.load(message.conversationId);
    const expectedUrl = chooseConversationUrl(message.externalUrl, stored?.url);
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    const clientRequestId = typeof message?.clientRequestId === 'string' && message.clientRequestId
        ? message.clientRequestId
        : undefined;
    const send = async (tab) => {
        if (!tab.id)
            throw new Error('ChatGPT tab has no id');
        routes.bind(requestId, tab.id, clientTabId, message.conversationId, clientRequestId);
        try {
            return await chrome.tabs.sendMessage(tab.id, {
                type: 'driver.submit',
                requestId,
                text: message.text
            });
        }
        catch (error) {
            routes.release(requestId);
            throw error;
        }
    };
    try {
        const selected = await sendToBoundConversationTab(tabs, stored, expectedUrl, send, reattachExistingConversationTab);
        const tabId = selected.tab.id;
        const result = selected.result;
        const externalUrl = authoritativeConversationUrl(selected.tab, result?.externalUrl, stored?.url ?? expectedUrl);
        if (result?.started !== true) {
            routes.release(requestId);
            return {
                started: false,
                requestId,
                tabId,
                externalUrl,
                error: result?.error || 'ChatGPT content script rejected the request'
            };
        }
        return { started: true, requestId, tabId, externalUrl };
    }
    catch (error) {
        routes.release(requestId);
        return {
            started: false,
            requestId,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
async function watchdogCandidates() {
    const [tabs, managedIds] = await Promise.all([
        chrome.tabs.query({ url: 'https://chatgpt.com/*' }),
        managedDriverTabIds()
    ]);
    return tabs
        .filter((tab) => !managedIds.has(tab.id))
        .map((tab) => {
        const url = stableConversationUrl(tab.url ?? tab.pendingUrl);
        if (!url)
            return null;
        const route = parseChatGptRoute(url);
        return {
            url,
            tabId: tab.id ?? null,
            windowId: tab.windowId ?? null,
            title: tab.title ?? null,
            active: tab.active === true,
            lastAccessed: typeof tab.lastAccessed === 'number' ? tab.lastAccessed : 0,
            projectId: route?.kind === 'conversation' ? (route.projectId ?? null) : null
        };
    })
        .filter(Boolean)
        .sort((a, b) => (Number(b?.active) - Number(a?.active)) || ((b?.lastAccessed ?? 0) - (a?.lastAccessed ?? 0)));
}
async function recentWatchdogTarget() {
    const candidates = await watchdogCandidates();
    const selected = candidates[0];
    if (!selected?.url) {
        return { ok: false, error: 'No ChatGPT conversation tab is available for Watchdog registration' };
    }
    return { ok: true, ...selected };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'provider.ping') {
        sendResponse({ ready: true });
        return;
    }
    if (message?.type === 'client.open') {
        const trustedControlSender = isExtensionControlPageUrl(sender.tab?.url);
        if (!isLocalClientUrl(sender.tab?.url) && !trustedControlSender) {
            sendResponse({ ok: false, error: 'client.open requires a trusted localhost or extension control surface' });
            return;
        }
        void openFreshDirectBindClient()
            .then((result) => {
            sendResponse(result);
            if (message.replaceExisting === true || trustedControlSender) {
                globalThis.setTimeout(() => {
                    void closeOtherLocalClientTabs(result.tabId);
                }, 1_500);
            }
        })
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'watchdog.target') {
        void recentWatchdogTarget()
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'watchdog.candidates') {
        void watchdogCandidates()
            .then((candidates) => sendResponse({ ok: true, candidates }))
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'extension.control') {
        const trustedControlSender = isExtensionControlPageUrl(sender.tab?.url) || isLocalClientUrl(sender.tab?.url);
        if (!trustedControlSender) {
            sendResponse({ state: 'failed', requestId: message?.requestId ?? '', error: 'Extension control requires the trusted localhost control surface' });
            return;
        }
        if (message.op === 'status') {
            void extensionStatus(message.requestId)
                .then(sendResponse)
                .catch((error) => sendResponse({ state: 'failed', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }));
            return true;
        }
        if (message.op === 'reload') {
            void startExtensionReload(message, sender)
                .then(sendResponse)
                .catch((error) => sendResponse({ state: 'failed', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }));
            return true;
        }
        if (message.op === 'reload.verify') {
            void verifyExtensionReload(message, sender)
                .then(sendResponse)
                .catch((error) => sendResponse({ state: 'failed', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }));
            return true;
        }
        sendResponse({ state: 'failed', requestId: message?.requestId ?? '', error: 'Unknown extension control operation' });
        return;
    }
    if (message?.type === 'extension.control.close') {
        if (isExtensionControlPageUrl(sender.tab?.url) && Number.isInteger(sender.tab?.id)) {
            void chrome.tabs.remove(sender.tab.id).catch(() => { });
        }
        sendResponse({ closed: true });
        return;
    }
    if (message?.type === 'catalog.get' || message?.type === 'catalog.refresh' || message?.type === 'catalog.resolve' || message?.type === 'catalog.probe' || message?.type === 'catalog.inspect') {
        void (async () => {
            if (message.type === 'catalog.get') {
                return { ok: true, catalog: await catalogCoordinator.get() };
            }
            if (message.type === 'catalog.refresh') {
                let seed;
                try {
                    seed = await scanLiveCatalogSeed();
                }
                catch {
                    seed = undefined;
                }
                return {
                    ok: true,
                    catalog: await catalogCoordinator.refresh(seed?.catalog, seed?.seedUrl)
                };
            }
            if (message.type === 'catalog.probe') {
                const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
                const selected = await sendToFirstResponsiveChatGptTab(tabs, async (tab) => {
                    if (!tab.id)
                        throw new Error('ChatGPT tab has no id');
                    return chrome.tabs.sendMessage(tab.id, { type: 'driver.catalog.probe' });
                });
                return {
                    ...selected.result,
                    tabId: selected.tab.id,
                    tabUrl: selected.tab.url ?? selected.tab.pendingUrl ?? ''
                };
            }
            if (message.type === 'catalog.inspect') {
                return inspectCatalogProject(message.url);
            }
            const entry = await catalogCoordinator.resolve(message.url);
            return { ok: true, catalog: await catalogCoordinator.get(), ...(entry ? { entry } : {}) };
        })()
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'conversation.probe') {
        void probeConversation(message?.url)
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'conversation.load') {
        void loadConversationSnapshot(message?.url)
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'conversation.navigate') {
        void navigateConversationSnapshot(message?.url, message?.fromUrl)
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (message?.type === 'provider.submit') {
        if (!requestGate.begin()) {
            sendResponse({ started: false, error: 'A ChatGPT request is already active' });
            return;
        }
        const requestId = crypto.randomUUID();
        if (!requestGate.activate(requestId)) {
            requestGate.abort();
            sendResponse({ started: false, error: 'Provider request gate could not reserve submission ownership' });
            return;
        }
        void submitToProvider(message, sender.tab?.id, requestId)
            .then((result) => {
            if (result.started !== true) {
                routes.release(requestId);
                requestGate.release(requestId);
            }
            sendResponse(result);
        })
            .catch((error) => {
            routes.release(requestId);
            requestGate.release(requestId);
            sendResponse({
                started: false,
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        });
        return true;
    }
    if (message?.type === 'driver.event' && typeof message.requestId === 'string' && message.event) {
        if (!routes.acceptsProviderEvent(message.requestId, sender.tab?.id)) {
            sendResponse({ forwarded: false, error: 'Driver event did not match the bound provider tab' });
            return;
        }
        const conversationId = routes.conversationId(message.requestId);
        const clientRequestId = routes.clientRequestId(message.requestId);
        const persistence = (conversationId
            && typeof sender.tab?.id === 'number'
            && shouldPersistProviderBinding(message.event))
            ? scheduleProviderBindingPersistence(conversationId, sender.tab, typeof message.externalUrl === 'string' ? message.externalUrl : undefined)
            : null;
        const envelope = providerEventEnvelope(message.requestId, message.event, sender.tab?.id, clientRequestId ?? undefined);
        void chrome.runtime.sendMessage(envelope).catch(() => { });
        const clientTabId = routes.clientTabId(message.requestId);
        if (clientTabId !== null) {
            void chrome.tabs.sendMessage(clientTabId, {
                type: 'client.provider.event',
                envelope
            }).catch(() => { });
        }
        if (message.event.type === 'assistant.completed' || message.event.type === 'provider.error') {
            routes.release(message.requestId);
            requestGate.release(message.requestId);
        }
        if (persistence) {
            void persistence.then(() => sendResponse({ forwarded: true }), (error) => sendResponse({
                forwarded: true,
                persistenceError: error instanceof Error ? error.message : String(error)
            }));
            return true;
        }
        sendResponse({ forwarded: true });
        return;
    }
});
void finalizePendingReload()
    .catch(() => { })
    .then(() => reattachManagedContentScripts({ reloadClients: false }).catch(() => { }))
    .finally(() => cleanupLegacyControlTabs().catch(() => { }));
