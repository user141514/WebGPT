import { mergeCatalogs, type CatalogConversation, type ConversationCatalog } from '../catalog.js';
import { catalogGroups, conversationFromUrl, conversationTarget, hasBoundConversation, initialConversationUrl } from './catalog-view.js';
import {
  defaultExpandedCatalogGroups,
  ensureActiveCatalogGroupExpanded,
  normalizeExpandedCatalogGroups,
  parseExpandedCatalogGroups,
  serializeExpandedCatalogGroups,
  toggleCatalogGroup
} from './catalog-tree.js';
import {
  isNearConversationBottom,
  shouldFollowConversationOutput,
  snapshotToTranscriptTurns,
  type TranscriptTurn
} from './conversation-view.js';
import { bindStatusView, type BindStatusInput } from './bind-status.js';
import { BridgeHeartbeat } from './heartbeat.js';
import { renderSemanticDocument } from './render-content.js';
import { SelectionEpoch } from './selection-epoch.js';
import {
  CLIENT_SOURCE,
  EXTENSION_SOURCE,
  clientBridgeHelloMessage,
  type CatalogResult,
  type ConversationLoadResult
} from './protocol.js';
import {
  initialClientState,
  ProviderEventFrameBuffer,
  reduceClientState,
  type ClientAction,
  type ClientPhase,
  type ClientState
} from './state.js';
import { liveStatusPayload, smokePromptFromUrl } from './smoke.js';

interface PendingCatalogRequest {
  resolve: (result: CatalogResult) => void;
  timeout: number;
}

interface PendingConversationRequest {
  resolve: (result: ConversationLoadResult) => void;
  timeout: number;
}

const ACTIVE_URL_KEY = 'chatgpt-web-driver.active-conversation-url';
const CATALOG_TREE_KEY = 'chatgpt-web-driver.catalog-tree.expanded';
const EMPTY_CATALOG: ConversationCatalog = { projects: [], conversations: [] };

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing client element: ${selector}`);
  return element;
}

const form = required<HTMLFormElement>('#composer-form');
const textarea = required<HTMLTextAreaElement>('#composer-input');
const sendButton = required<HTMLButtonElement>('#composer-send');
const transcript = required<HTMLElement>('#transcript');
const conversationScroller = required<HTMLElement>('.conversation');
const phaseBadge = required<HTMLElement>('#phase-badge');
const bridgeBadge = required<HTMLElement>('#bridge-badge');
const eventLog = required<HTMLElement>('#event-log');
const emptyState = required<HTMLElement>('#empty-state');
const conversationTitle = required<HTMLElement>('#conversation-title');
const conversationSubtitle = required<HTMLElement>('#conversation-subtitle');
const catalogList = required<HTMLElement>('#catalog-list');
const catalogStatus = required<HTMLElement>('#catalog-status');
const catalogRefresh = required<HTMLButtonElement>('#catalog-refresh');
const conversationUrlForm = required<HTMLFormElement>('#conversation-url-form');
const conversationUrlInput = required<HTMLInputElement>('#conversation-url-input');
const bindStatusElement = required<HTMLElement>('#bind-status');
const bindStatusTitle = required<HTMLElement>('#bind-status-title');
const bindStatusDetail = required<HTMLElement>('#bind-status-detail');

let state: ClientState = initialClientState();
const turns: TranscriptTurn[] = [];
let activeTurn: TranscriptTurn | null = null;
const bridgeHeartbeat = new BridgeHeartbeat(3_000);
let activeConversationId = '';
let activeConversationUrl: string | null = null;
let activeConversationTitle = 'No page bound';
let bindStatus: BindStatusInput = { state: 'idle' };
let catalog: ConversationCatalog = EMPTY_CATALOG;
let expandedCatalogGroups = parseExpandedCatalogGroups(localStorage.getItem(CATALOG_TREE_KEY));
let catalogExpansionInitialized = localStorage.getItem(CATALOG_TREE_KEY) !== null;
let catalogBusy = false;
let conversationLoading = false;
let historyHydrated = false;
let historyMessageCount = 0;
let catalogBootstrapped = false;
let catalogStatusText = 'Waiting for extension…';
const pendingCatalogRequests = new Map<string, PendingCatalogRequest>();
const pendingConversationRequests = new Map<string, PendingConversationRequest>();
const selectionEpoch = new SelectionEpoch();
const initialRequestedUrl = initialConversationUrl(
  location.href,
  sessionStorage.getItem(ACTIVE_URL_KEY)
);
const smokePrompt = smokePromptFromUrl(location.href);
let smokeSubmitted = false;
let transcriptDirty = true;
let forceFollowTranscript = false;

function busy(phase: ClientPhase): boolean {
  return ['submitting', 'submitted', 'accepted', 'generating', 'settling'].includes(phase);
}

function appendEvent(value: unknown): void {
  const row = document.createElement('div');
  row.textContent = JSON.stringify(value);
  eventLog.append(row);
  while (eventLog.children.length > 100) eventLog.firstElementChild?.remove();
  eventLog.scrollTop = eventLog.scrollHeight;
}

function markTranscriptDirty(forceFollow = false): void {
  transcriptDirty = true;
  if (forceFollow) forceFollowTranscript = true;
}

function syncActiveTurn(): void {
  if (!activeTurn) return;
  const changed = activeTurn.requestId !== state.requestId
    || activeTurn.assistantText !== state.assistantText
    || activeTurn.assistantDocument !== state.assistantDocument
    || activeTurn.assistantMarkdown !== state.assistantMarkdown
    || activeTurn.phase !== state.phase
    || activeTurn.error !== state.error;
  if (!changed) return;

  activeTurn.requestId = state.requestId;
  activeTurn.assistantText = state.assistantText;
  activeTurn.assistantDocument = state.assistantDocument;
  activeTurn.assistantMarkdown = state.assistantMarkdown;
  activeTurn.phase = state.phase;
  activeTurn.error = state.error;
  markTranscriptDirty();
}

function turnProcessCopy(turn: TranscriptTurn): string {
  if (turn.error || turn.phase === 'completed' || turn.phase === 'error') return '';
  if (turn.phase === 'submitting') return 'Sending…';
  if (turn.phase === 'submitted') return 'Waiting for ChatGPT…';
  if (turn.phase === 'accepted') return 'Thinking…';
  if (turn.phase === 'generating') {
    return turn.assistantText || turn.assistantDocument?.blocks.length ? 'Writing…' : 'Thinking…';
  }
  if (turn.phase === 'settling') return 'Finishing…';
  return '';
}

function renderTranscript(): void {
  if (!transcriptDirty) return;

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

    const showAssistant = Boolean(
      turn.assistantDocument?.blocks.length
      || turn.assistantText
      || turn.error
      || turn.phase !== 'completed'
    );
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
        } else {
          assistantBody.textContent = turn.assistantText || `Error: ${turn.error}`;
        }
        assistant.append(assistantBody);
      }
      group.append(assistant);
    }

    if (group.childElementCount) transcript.append(group);
  }

  if (followOutput) {
    conversationScroller.scrollTop = conversationScroller.scrollHeight;
  } else {
    conversationScroller.scrollTop = previousTop;
  }
  transcriptDirty = false;
  forceFollowTranscript = false;
}

function projectTitleForConversation(conversation: CatalogConversation | null): string | null {
  if (!conversation?.projectId) return null;
  return catalog.projects.find((project) => project.projectId === conversation.projectId)?.title
    ?? conversation.projectId;
}

function persistCatalogExpansion(): void {
  localStorage.setItem(CATALOG_TREE_KEY, serializeExpandedCatalogGroups(expandedCatalogGroups));
}

function syncCatalogExpansion(): void {
  const groups = catalogGroups(catalog);
  if (!catalogExpansionInitialized) {
    expandedCatalogGroups = defaultExpandedCatalogGroups(groups, activeConversationUrl);
    catalogExpansionInitialized = true;
  } else {
    expandedCatalogGroups = normalizeExpandedCatalogGroups(expandedCatalogGroups, groups);
    expandedCatalogGroups = ensureActiveCatalogGroupExpanded(
      expandedCatalogGroups,
      groups,
      activeConversationUrl
    );
  }
  persistCatalogExpansion();
}

function expandActiveCatalogGroup(): void {
  expandedCatalogGroups = ensureActiveCatalogGroupExpanded(
    expandedCatalogGroups,
    catalogGroups(catalog),
    activeConversationUrl
  );
  persistCatalogExpansion();
}

function renderCatalog(): void {
  catalogList.replaceChildren();
  const groups = catalogGroups(catalog);

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-status';
    empty.textContent = 'No indexed conversations yet.';
    catalogList.append(empty);
    return;
  }

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'catalog-group';
    section.dataset.project = String(Boolean(group.projectId));
    const expanded = expandedCatalogGroups.has(group.id);
    const activeInGroup = group.conversations.some((conversation) => conversation.url === activeConversationUrl);
    section.dataset.active = String(activeInGroup);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'catalog-group-toggle';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.disabled = catalogBusy;
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
    count.textContent = group.conversations.length ? String(group.conversations.length) : '—';

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
      button.disabled = busy(state.phase) || conversationLoading || catalogBusy;
      button.addEventListener('click', () => selectConversation(conversation));
      children.append(button);
    }

    section.append(children);
    catalogList.append(section);
  }
}

function render(): void {
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
  const urlSubmit = conversationUrlForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (urlSubmit) urlSubmit.disabled = !connected || isBusy || catalogBusy || conversationLoading;
  catalogStatus.textContent = catalogStatusText;
  const bindView = bindStatusView(bindStatus);
  bindStatusElement.dataset.state = bindView.tone;
  bindStatusTitle.textContent = bindView.title;
  bindStatusDetail.textContent = bindView.detail;

  renderCatalog();
  renderTranscript();
}

function reportLiveStatus(): void {
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

function dispatch(action: ClientAction): void {
  const nextState = reduceClientState(state, action);
  if (nextState === state) return;
  state = nextState;
  render();
  reportLiveStatus();
}

const providerEventBuffer = new ProviderEventFrameBuffer(dispatch, {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle)
});

function postToExtension(message: unknown): void {
  window.postMessage(message, location.origin);
}

function sendHello(): void {
  postToExtension(clientBridgeHelloMessage());
}

function requestCatalog(): Promise<CatalogResult> {
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

function requestConversation(
  type: 'conversation.load' | 'conversation.navigate',
  url: string,
  fromUrl?: string | null
): Promise<ConversationLoadResult> {
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

function requestConversationLoad(url: string): Promise<ConversationLoadResult> {
  return requestConversation('conversation.load', url);
}

function requestConversationNavigate(url: string, fromUrl?: string | null): Promise<ConversationLoadResult> {
  return requestConversation('conversation.navigate', url, fromUrl);
}

function applyCatalog(result: CatalogResult): void {
  if (!result.ok) {
    catalogStatusText = result.error;
    return;
  }
  catalog = mergeCatalogs(catalog, result.catalog);
  syncCatalogExpansion();
  catalogStatusText = `${catalog.projects.length} projects · ${catalog.conversations.length} conversations`;
}

async function loadCatalog(): Promise<void> {
  if (catalogBusy || state.phase === 'disconnected') return;
  catalogBusy = true;
  catalogStatusText = 'Loading cached conversations…';
  render();

  const result = await requestCatalog();
  applyCatalog(result);

  catalogBusy = false;
  render();
}

function selectConversation(conversation: CatalogConversation): void {
  if (busy(state.phase) || conversation.url === activeConversationUrl) return;
  void resolveConversation(conversation.url, conversation.title, 'navigate');
}

async function resolveConversation(
  url: string,
  titleHint?: string,
  mode: 'bind' | 'navigate' = 'bind'
): Promise<void> {
  const value = url.trim();
  if (!value || busy(state.phase) || conversationLoading) return;

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
  bindStatus = { state: 'binding', url: direct.url };
  catalogStatusText = mode === 'navigate'
    ? 'Switching the existing ChatGPT tab…'
    : 'Binding to the already-open ChatGPT tab…';
  render();

  const result = mode === 'navigate'
    ? await requestConversationNavigate(candidate.url, previousUrl)
    : await requestConversationLoad(candidate.url);
  if (!selectionEpoch.isCurrent(selectionToken)) return;

  if (!result.ok) {
    conversationLoading = false;
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

async function bootstrapCatalog(): Promise<void> {
  await loadCatalog();
  if (initialRequestedUrl) await resolveConversation(initialRequestedUrl);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || typeof message !== 'object' || message.source !== EXTENSION_SOURCE) return;

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
    if (!pending) return;
    pendingConversationRequests.delete(message.requestId);
    window.clearTimeout(pending.timeout);
    pending.resolve(message.result as ConversationLoadResult);
    return;
  }

  if (message.type === 'catalog.result' && typeof message.requestId === 'string') {
    const pending = pendingCatalogRequests.get(message.requestId);
    if (!pending) return;
    pendingCatalogRequests.delete(message.requestId);
    window.clearTimeout(pending.timeout);
    pending.resolve(message.result as CatalogResult);
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
  if (
    state.phase === 'disconnected'
    || !hasBoundConversation(activeConversationUrl)
    || busy(state.phase)
    || conversationLoading
  ) return;

  const text = textarea.value.trim();
  if (!text) return;

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

textarea.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

sendHello();
window.setInterval(() => {
  sendHello();
  if (!bridgeHeartbeat.isAlive(Date.now()) && state.phase !== 'disconnected') {
    dispatch({ type: 'bridge.disconnected' });
  }
}, 1_000);
render();
reportLiveStatus();
