import { mergeCatalogs } from '../catalog.js';
import { catalogGroups, catalogGroupsWithLoading, conversationFromUrl, conversationTarget, hasBoundConversation, initialConversationUrl, loadingCatalogGroupId } from './catalog-view.js';
import { defaultExpandedCatalogGroups, ensureActiveCatalogGroupExpanded, normalizeExpandedCatalogGroups, parseExpandedCatalogGroups, serializeExpandedCatalogGroups, toggleCatalogGroup } from './catalog-tree.js';
import { isNearConversationBottom, shouldFollowConversationOutput, snapshotToTranscriptTurns } from './conversation-view.js';
import { bindStatusView } from './bind-status.js';
import { BridgeHeartbeat } from './heartbeat.js';
import { renderSemanticDocument } from './render-content.js';
import { SelectionEpoch } from './selection-epoch.js';
import { CLIENT_SOURCE, EXTENSION_SOURCE, clientBridgeHelloMessage } from './protocol.js';
import { initialClientState, ProviderEventFrameBuffer, reduceClientState } from './state.js';
import { liveStatusPayload, smokePromptFromUrl } from './smoke.js';
import { nextTheme, normalizeTheme, themeToggleView } from './theme.js';
const ACTIVE_URL_KEY = 'chatgpt-web-driver.active-conversation-url';
const CATALOG_TREE_KEY = 'chatgpt-web-driver.catalog-tree.expanded';
const SIDEBAR_COLLAPSED_KEY = 'chatgpt-web-driver.sidebar-collapsed';
const THEME_KEY = 'chatgpt-web-driver.theme';
const EMPTY_CATALOG = { projects: [], conversations: [] };
function required(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing client element: ${selector}`);
    return element;
}
const form = required('#composer-form');
const textarea = required('#composer-input');
const sendButton = required('#composer-send');
const transcript = required('#transcript');
const conversationScroller = required('.conversation');
const phaseBadge = required('#phase-badge');
const bridgeBadge = required('#bridge-badge');
const eventLog = required('#event-log');
const emptyState = required('#empty-state');
const conversationTitle = required('#conversation-title');
const conversationSubtitle = required('#conversation-subtitle');
const catalogList = required('#catalog-list');
const catalogStatus = required('#catalog-status');
const catalogRefresh = required('#catalog-refresh');
const conversationUrlForm = required('#conversation-url-form');
const conversationUrlInput = required('#conversation-url-input');
const bindStatusElement = required('#bind-status');
const bindStatusTitle = required('#bind-status-title');
const bindStatusDetail = required('#bind-status-detail');
const sidebarToggle = required('#sidebar-toggle');
const sidebarCollapse = required('#sidebar-collapse');
const themeToggle = required('#theme-toggle');
let state = initialClientState();
const turns = [];
let activeTurn = null;
const bridgeHeartbeat = new BridgeHeartbeat(3_000);
let activeConversationId = '';
let activeConversationUrl = null;
let activeConversationTitle = 'No page bound';
let bindStatus = { state: 'idle' };
let catalog = EMPTY_CATALOG;
let expandedCatalogGroups = parseExpandedCatalogGroups(localStorage.getItem(CATALOG_TREE_KEY));
let catalogExpansionInitialized = localStorage.getItem(CATALOG_TREE_KEY) !== null;
let catalogBusy = false;
let conversationLoading = false;
let conversationLoadingUrl = null;
let historyHydrated = false;
let historyMessageCount = 0;
let catalogBootstrapped = false;
let catalogStatusText = 'Waiting for extension…';
let sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
let theme = normalizeTheme(localStorage.getItem(THEME_KEY));
if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === null && window.matchMedia('(max-width: 760px)').matches) {
    sidebarCollapsed = true;
}
const pendingCatalogRequests = new Map();
const pendingConversationRequests = new Map();
const selectionEpoch = new SelectionEpoch();
const initialRequestedUrl = initialConversationUrl(location.href, sessionStorage.getItem(ACTIVE_URL_KEY));
const smokePrompt = smokePromptFromUrl(location.href);
let smokeSubmitted = false;
let transcriptDirty = true;
let forceFollowTranscript = false;
function busy(phase) {
    return ['submitting', 'submitted', 'accepted', 'generating', 'settling'].includes(phase);
}
function appendEvent(value) {
    const row = document.createElement('div');
    row.textContent = JSON.stringify(value);
    eventLog.append(row);
    while (eventLog.children.length > 100)
        eventLog.firstElementChild?.remove();
    eventLog.scrollTop = eventLog.scrollHeight;
}
function applyTheme() {
    document.body.dataset.theme = theme;
    const view = themeToggleView(theme);
    themeToggle.textContent = view.icon;
    themeToggle.setAttribute('aria-label', view.label);
    themeToggle.setAttribute('title', view.label);
    themeToggle.setAttribute('aria-pressed', String(view.pressed));
}
function setTheme(next) {
    theme = next;
    localStorage.setItem(THEME_KEY, theme);
    applyTheme();
}
function applySidebarState() {
    document.body.dataset.sidebarCollapsed = String(sidebarCollapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!sidebarCollapsed));
}
function setSidebarCollapsed(collapsed) {
    sidebarCollapsed = collapsed;
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    applySidebarState();
}
function resizeComposer() {
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
}
function markTranscriptDirty(forceFollow = false) {
    transcriptDirty = true;
    if (forceFollow)
        forceFollowTranscript = true;
}
function syncActiveTurn() {
    if (!activeTurn)
        return;
    const changed = activeTurn.requestId !== state.requestId
        || activeTurn.assistantText !== state.assistantText
        || activeTurn.assistantDocument !== state.assistantDocument
        || activeTurn.assistantMarkdown !== state.assistantMarkdown
        || activeTurn.phase !== state.phase
        || activeTurn.error !== state.error;
    if (!changed)
        return;
    activeTurn.requestId = state.requestId;
    activeTurn.assistantText = state.assistantText;
    activeTurn.assistantDocument = state.assistantDocument;
    activeTurn.assistantMarkdown = state.assistantMarkdown;
    activeTurn.phase = state.phase;
    activeTurn.error = state.error;
    markTranscriptDirty();
}
function turnProcessCopy(turn) {
    if (turn.error || turn.phase === 'completed' || turn.phase === 'error')
        return '';
    if (turn.phase === 'submitting')
        return 'Sending…';
    if (turn.phase === 'submitted')
        return 'Waiting for ChatGPT…';
    if (turn.phase === 'accepted')
        return 'Thinking…';
    if (turn.phase === 'generating') {
        return turn.assistantText || turn.assistantDocument?.blocks.length ? 'Writing…' : 'Thinking…';
    }
    if (turn.phase === 'settling')
        return 'Finishing…';
    return '';
}
function renderTranscript() {
    if (!transcriptDirty)
        return;
    const previousTop = conversationScroller.scrollTop;
    const wasNearBottom = isNearConversationBottom(conversationScroller);
    const followOutput = shouldFollowConversationOutput({
        wasNearBottom,
        contentChanged: true,
        force: forceFollowTranscript
    });
    emptyState.hidden = turns.length > 0;
    transcript.replaceChildren();
    for (const turn of turns) {
        const group = document.createElement('article');
        group.className = 'turn';
        if (turn.userText) {
            const user = document.createElement('section');
            user.className = 'message user-message';
            const userLabel = document.createElement('div');
            userLabel.className = 'message-label';
            userLabel.textContent = 'You';
            const userBody = document.createElement('div');
            userBody.className = 'message-body';
            userBody.textContent = turn.userText;
            user.append(userLabel, userBody);
            group.append(user);
        }
        const showAssistant = Boolean(turn.assistantDocument?.blocks.length
            || turn.assistantText
            || turn.error
            || turn.phase !== 'completed');
        if (showAssistant) {
            const assistant = document.createElement('section');
            assistant.className = 'message assistant-message';
            const assistantLabel = document.createElement('div');
            assistantLabel.className = 'message-label';
            assistantLabel.textContent = 'ChatGPT';
            const processCopy = turnProcessCopy(turn);
            assistant.append(assistantLabel);
            if (processCopy) {
                const process = document.createElement('div');
                process.className = 'assistant-status';
                process.textContent = processCopy;
                assistant.append(process);
            }
            if (turn.assistantDocument?.blocks.length || turn.assistantText || turn.error) {
                const assistantBody = document.createElement('div');
                assistantBody.className = 'assistant-body';
                if (turn.assistantDocument?.blocks.length) {
                    renderSemanticDocument(document, turn.assistantDocument, assistantBody);
                }
                else {
                    assistantBody.textContent = turn.assistantText || `Error: ${turn.error}`;
                }
                assistant.append(assistantBody);
            }
            group.append(assistant);
        }
        if (group.childElementCount)
            transcript.append(group);
    }
    if (followOutput) {
        conversationScroller.scrollTop = conversationScroller.scrollHeight;
    }
    else {
        conversationScroller.scrollTop = previousTop;
    }
    transcriptDirty = false;
    forceFollowTranscript = false;
}
function projectTitleForConversation(conversation) {
    if (!conversation?.projectId)
        return null;
    return catalog.projects.find((project) => project.projectId === conversation.projectId)?.title
        ?? conversation.projectId;
}
function persistCatalogExpansion() {
    localStorage.setItem(CATALOG_TREE_KEY, serializeExpandedCatalogGroups(expandedCatalogGroups));
}
function syncCatalogExpansion() {
    const groups = catalogGroups(catalog);
    if (!catalogExpansionInitialized) {
        expandedCatalogGroups = defaultExpandedCatalogGroups(groups, activeConversationUrl);
        catalogExpansionInitialized = true;
    }
    else {
        expandedCatalogGroups = normalizeExpandedCatalogGroups(expandedCatalogGroups, groups);
        expandedCatalogGroups = ensureActiveCatalogGroupExpanded(expandedCatalogGroups, groups, activeConversationUrl);
    }
    persistCatalogExpansion();
}
function expandActiveCatalogGroup() {
    expandedCatalogGroups = ensureActiveCatalogGroupExpanded(expandedCatalogGroups, catalogGroups(catalog), activeConversationUrl);
    persistCatalogExpansion();
}
function renderCatalog() {
    catalogList.replaceChildren();
    const groups = catalogGroupsWithLoading(catalog, conversationLoadingUrl);
    if (!groups.length) {
        const empty = document.createElement('div');
        empty.className = 'catalog-status';
        empty.textContent = 'No indexed conversations yet.';
        catalogList.append(empty);
        return;
    }
    const loadingGroupId = loadingCatalogGroupId(conversationLoadingUrl);
    for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'catalog-group';
        section.dataset.project = String(Boolean(group.projectId));
        const expanded = expandedCatalogGroups.has(group.id);
        const activeInGroup = group.conversations.some((conversation) => conversation.url === activeConversationUrl);
        section.dataset.active = String(activeInGroup);
        section.dataset.loading = String(group.id === loadingGroupId);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'catalog-group-toggle';
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.addEventListener('click', () => {
            expandedCatalogGroups = toggleCatalogGroup(expandedCatalogGroups, group.id);
            persistCatalogExpansion();
            renderCatalog();
        });
        const chevron = document.createElement('span');
        chevron.className = 'catalog-group-chevron';
        chevron.textContent = '›';
        const label = document.createElement('span');
        label.className = 'catalog-group-label';
        label.textContent = group.title;
        const count = document.createElement('span');
        count.className = 'catalog-group-count';
        const groupLoading = group.id === loadingGroupId;
        count.dataset.loading = String(groupLoading);
        count.setAttribute('aria-label', groupLoading ? 'Loading conversation' : `${group.conversations.length} conversations`);
        count.textContent = groupLoading ? '' : (group.conversations.length ? String(group.conversations.length) : '—');
        toggle.append(chevron, label, count);
        section.append(toggle);
        const children = document.createElement('div');
        children.className = 'catalog-group-children';
        children.hidden = !expanded;
        if (!group.conversations.length) {
            const empty = document.createElement('div');
            empty.className = 'catalog-group-empty';
            empty.textContent = 'Not indexed';
            children.append(empty);
        }
        for (const conversation of group.conversations) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'catalog-conversation';
            button.textContent = conversation.title;
            button.title = conversation.url;
            button.dataset.active = String(activeConversationUrl === conversation.url);
            button.disabled = busy(state.phase) || conversationLoading;
            button.addEventListener('click', () => selectConversation(conversation));
            children.append(button);
        }
        section.append(children);
        catalogList.append(section);
    }
}
function render() {
    syncActiveTurn();
    const isBusy = busy(state.phase);
    const connected = state.phase !== 'disconnected';
    const activeEntry = activeConversationUrl
        ? catalog.conversations.find((conversation) => conversation.url === activeConversationUrl) ?? null
        : null;
    const projectTitle = projectTitleForConversation(activeEntry);
    bridgeBadge.textContent = connected ? 'Extension connected' : 'Extension disconnected';
    bridgeBadge.dataset.connected = String(connected);
    phaseBadge.textContent = state.phase;
    conversationTitle.textContent = activeConversationTitle;
    conversationSubtitle.textContent = activeConversationUrl
        ? [projectTitle, activeConversationUrl].filter(Boolean).join(' · ')
        : 'Bind the URL of an already-open ChatGPT conversation.';
    const hasTarget = hasBoundConversation(activeConversationUrl);
    sendButton.disabled = !connected || !hasTarget || isBusy || conversationLoading;
    textarea.disabled = !connected || !hasTarget || isBusy || conversationLoading;
    textarea.placeholder = hasTarget ? 'Message ChatGPT' : 'Bind a ChatGPT URL first';
    catalogRefresh.disabled = !connected || isBusy || catalogBusy || conversationLoading;
    conversationUrlInput.disabled = isBusy || catalogBusy || conversationLoading;
    const urlSubmit = conversationUrlForm.querySelector('button[type="submit"]');
    if (urlSubmit)
        urlSubmit.disabled = !connected || isBusy || catalogBusy || conversationLoading;
    catalogStatus.textContent = catalogStatusText;
    const bindView = bindStatusView(bindStatus);
    bindStatusElement.dataset.state = bindView.tone;
    bindStatusTitle.textContent = bindView.title;
    bindStatusDetail.textContent = bindView.detail;
    renderCatalog();
    renderTranscript();
}
function reportLiveStatus() {
    void fetch('/__live', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(liveStatusPayload(state, {
            conversationUrl: activeConversationUrl,
            historyMessages: historyMessageCount,
            historyHydrated
        }))
    }).catch(() => {
        // Diagnostic-only; reporting must never affect the client loop.
    });
}
function dispatch(action) {
    const nextState = reduceClientState(state, action);
    if (nextState === state)
        return;
    state = nextState;
    render();
    reportLiveStatus();
}
const providerEventBuffer = new ProviderEventFrameBuffer(dispatch, {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle)
});
function postToExtension(message) {
    window.postMessage(message, location.origin);
}
function sendHello() {
    postToExtension(clientBridgeHelloMessage());
}
function requestCatalog() {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
            pendingCatalogRequests.delete(requestId);
            resolve({ ok: false, error: 'Timed out waiting for the extension catalog' });
        }, 30_000);
        pendingCatalogRequests.set(requestId, { resolve, timeout });
        postToExtension({
            source: CLIENT_SOURCE,
            type: 'catalog.get',
            requestId
        });
    });
}
function requestConversation(type, url, fromUrl) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
            pendingConversationRequests.delete(requestId);
            resolve({ ok: false, error: 'Timed out waiting for the conversation snapshot' });
        }, 45_000);
        pendingConversationRequests.set(requestId, { resolve, timeout });
        postToExtension({
            source: CLIENT_SOURCE,
            type,
            requestId,
            url,
            ...(type === 'conversation.navigate' && fromUrl ? { fromUrl } : {})
        });
    });
}
function requestConversationLoad(url) {
    return requestConversation('conversation.load', url);
}
function requestConversationNavigate(url, fromUrl) {
    return requestConversation('conversation.navigate', url, fromUrl);
}
function applyCatalog(result) {
    if (!result.ok) {
        catalogStatusText = result.error;
        return;
    }
    catalog = mergeCatalogs(catalog, result.catalog);
    syncCatalogExpansion();
    catalogStatusText = `${catalog.projects.length} projects · ${catalog.conversations.length} conversations`;
}
async function loadCatalog() {
    if (catalogBusy || state.phase === 'disconnected')
        return;
    catalogBusy = true;
    catalogStatusText = 'Loading cached conversations…';
    render();
    const result = await requestCatalog();
    applyCatalog(result);
    catalogBusy = false;
    render();
}
function selectConversation(conversation) {
    if (busy(state.phase) || conversation.url === activeConversationUrl)
        return;
    void resolveConversation(conversation.url, conversation.title, 'navigate');
}
async function resolveConversation(url, titleHint, mode = 'bind') {
    const value = url.trim();
    if (!value || busy(state.phase) || conversationLoading)
        return;
    const direct = conversationFromUrl(value, titleHint);
    if (!direct) {
        const error = 'Paste a valid ChatGPT conversation URL (/c/... or /g/.../c/...).';
        bindStatus = { state: 'error', error };
        catalogStatusText = error;
        render();
        return;
    }
    const cached = catalog.conversations.find((conversation) => conversation.url === direct.url) ?? null;
    const candidate = cached ?? direct;
    const selectionToken = selectionEpoch.begin();
    const previousUrl = activeConversationUrl;
    conversationLoading = true;
    conversationLoadingUrl = direct.url;
    bindStatus = { state: 'binding', url: direct.url };
    catalogStatusText = mode === 'navigate'
        ? 'Switching the existing ChatGPT tab…'
        : 'Binding to the already-open ChatGPT tab…';
    render();
    const result = mode === 'navigate'
        ? await requestConversationNavigate(candidate.url, previousUrl)
        : await requestConversationLoad(candidate.url);
    if (!selectionEpoch.isCurrent(selectionToken))
        return;
    if (!result.ok) {
        conversationLoading = false;
        conversationLoadingUrl = null;
        bindStatus = { state: 'error', error: result.error };
        catalogStatusText = result.error;
        render();
        return;
    }
    const target = conversationTarget(candidate);
    activeConversationId = target.conversationId;
    activeConversationUrl = target.externalUrl;
    activeConversationTitle = result.snapshot.title?.trim() || target.title;
    catalog = mergeCatalogs(catalog, {
        projects: [],
        conversations: [{ ...candidate, title: activeConversationTitle }]
    });
    syncCatalogExpansion();
    historyHydrated = true;
    historyMessageCount = result.snapshot.turns.length;
    sessionStorage.setItem(ACTIVE_URL_KEY, target.externalUrl);
    conversationUrlInput.value = target.externalUrl;
    expandActiveCatalogGroup();
    const hydrated = snapshotToTranscriptTurns(result.snapshot);
    turns.splice(0, turns.length, ...hydrated);
    activeTurn = null;
    markTranscriptDirty(true);
    conversationLoading = false;
    conversationLoadingUrl = null;
    bindStatus = {
        state: 'bound',
        title: activeConversationTitle,
        url: target.externalUrl,
        tabId: result.tabId,
        messages: result.snapshot.turns.length
    };
    catalogStatusText = 'Bound to existing tab · ' + result.snapshot.turns.length + ' messages visible';
    dispatch({ type: 'conversation.switch' });
}
async function bootstrapCatalog() {
    await loadCatalog();
    if (initialRequestedUrl)
        await resolveConversation(initialRequestedUrl);
}
window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin)
        return;
    const message = event.data;
    if (!message || typeof message !== 'object' || message.source !== EXTENSION_SOURCE)
        return;
    appendEvent(message);
    if (message.type === 'bridge.ready') {
        bridgeHeartbeat.markReady(Date.now());
        dispatch({ type: 'bridge.ready' });
        if (!catalogBootstrapped) {
            catalogBootstrapped = true;
            void bootstrapCatalog();
        }
        if (smokePrompt && !smokeSubmitted) {
            smokeSubmitted = true;
            textarea.value = smokePrompt;
            queueMicrotask(() => form.requestSubmit());
        }
        return;
    }
    if (message.type === 'conversation.result' && typeof message.requestId === 'string') {
        const pending = pendingConversationRequests.get(message.requestId);
        if (!pending)
            return;
        pendingConversationRequests.delete(message.requestId);
        window.clearTimeout(pending.timeout);
        pending.resolve(message.result);
        return;
    }
    if (message.type === 'catalog.result' && typeof message.requestId === 'string') {
        const pending = pendingCatalogRequests.get(message.requestId);
        if (!pending)
            return;
        pendingCatalogRequests.delete(message.requestId);
        window.clearTimeout(pending.timeout);
        pending.resolve(message.result);
        return;
    }
    if (message.type === 'submit.result' && typeof message.clientRequestId === 'string') {
        dispatch({
            type: 'submit.result',
            clientRequestId: message.clientRequestId,
            result: message.result
        });
        return;
    }
    if (message.type === 'provider.event' && typeof message.requestId === 'string' && message.event) {
        providerEventBuffer.push(message.requestId, message.event, message.clientRequestId);
    }
});
form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.phase === 'disconnected'
        || !hasBoundConversation(activeConversationUrl)
        || busy(state.phase)
        || conversationLoading)
        return;
    const text = textarea.value.trim();
    if (!text)
        return;
    const clientRequestId = crypto.randomUUID();
    activeTurn = {
        clientRequestId,
        requestId: null,
        userText: text,
        assistantText: '',
        assistantDocument: null,
        assistantMarkdown: null,
        phase: 'submitting',
        error: null
    };
    turns.push(activeTurn);
    markTranscriptDirty(true);
    textarea.value = '';
    resizeComposer();
    dispatch({ type: 'submit.local', clientRequestId });
    appendEvent({
        source: CLIENT_SOURCE,
        type: 'provider.submit',
        clientRequestId,
        conversationId: activeConversationId,
        ...(activeConversationUrl ? { externalUrl: activeConversationUrl } : {}),
        text
    });
    postToExtension({
        source: CLIENT_SOURCE,
        type: 'provider.submit',
        clientRequestId,
        conversationId: activeConversationId,
        ...(activeConversationUrl ? { externalUrl: activeConversationUrl } : {}),
        text
    });
});
conversationUrlForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void resolveConversation(conversationUrlInput.value);
});
catalogRefresh.addEventListener('click', () => {
    void loadCatalog();
});
sidebarToggle.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
sidebarCollapse.addEventListener('click', () => setSidebarCollapsed(true));
themeToggle.addEventListener('click', () => setTheme(nextTheme(theme)));
textarea.addEventListener('input', resizeComposer);
textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});
applyTheme();
applySidebarState();
resizeComposer();
sendHello();
window.setInterval(() => {
    sendHello();
    if (!bridgeHeartbeat.isAlive(Date.now()) && state.phase !== 'disconnected') {
        dispatch({ type: 'bridge.disconnected' });
    }
}, 1_000);
render();
reportLiveStatus();
