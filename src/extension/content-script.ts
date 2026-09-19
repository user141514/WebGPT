import { BrowserDomSurface } from '../browser-dom.js';
import { catalogKeyForUrl } from '../catalog.js';
import { conversationSnapshotFromSurface } from '../conversation-snapshot.js';
import { conversationDomProbe } from './conversation-dom.js';
import { scanConversationHistory } from './conversation-history.js';
import {
  activateProjectCandidate,
  catalogProbeFromDocument,
  projectCandidatesFromDocument,
  scanCatalogDocument
} from './catalog-dom.js';
import { ContentController } from './content-controller.js';
import { submitDriverMessage } from './content-submit.js';

declare const chrome: any;

const surface = new BrowserDomSurface(document);

const controller = new ContentController(
  surface,
  (envelope) => {
    void chrome.runtime.sendMessage({
      type: 'driver.event',
      ...envelope,
      externalUrl: location.href
    });
  }
);

const observationRoot = document.documentElement ?? document.body;
if (observationRoot && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => controller.requestObservation());
  observer.observe(observationRoot, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-message-author-role', 'data-testid', 'disabled']
  });
}

chrome.runtime.onMessage.addListener((message: any, _sender: unknown, sendResponse: (value: unknown) => void) => {
  if (message?.type === 'driver.ping') {
    sendResponse({ ready: true, externalUrl: location.href });
    return;
  }
  if (message?.type === 'driver.conversation.probe') {
    const expectedUrl = catalogKeyForUrl(message?.url ?? '');
    const actualUrl = catalogKeyForUrl(location.href);
    if (!expectedUrl || !actualUrl || expectedUrl !== actualUrl) {
      sendResponse({
        ok: false,
        error: `Conversation URL mismatch: expected ${expectedUrl ?? message?.url ?? ''}, got ${actualUrl ?? location.href}`,
        externalUrl: location.href
      });
      return;
    }
    sendResponse({ ok: true, probe: conversationDomProbe(document), externalUrl: location.href });
    return;
  }

  if (message?.type === 'driver.conversation.history.scan') {
    const expectedUrl = catalogKeyForUrl(message?.url ?? '');
    const actualUrl = catalogKeyForUrl(location.href);
    if (!expectedUrl || !actualUrl || expectedUrl !== actualUrl) {
      sendResponse({
        ok: false,
        error: `Conversation URL mismatch: expected ${expectedUrl ?? message?.url ?? ''}, got ${actualUrl ?? location.href}`,
        externalUrl: location.href
      });
      return;
    }
    void scanConversationHistory(document, actualUrl, document.title)
      .then((result) => sendResponse({ ok: true, ...result, externalUrl: location.href }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        externalUrl: location.href
      }));
    return true;
  }

  if (message?.type === 'driver.conversation.snapshot') {
    const expectedUrl = catalogKeyForUrl(message?.url ?? '');
    const actualUrl = catalogKeyForUrl(location.href);
    if (!expectedUrl) {
      sendResponse({ ok: false, error: 'A valid ChatGPT conversation URL is required', externalUrl: location.href });
      return;
    }
    if (!actualUrl || actualUrl !== expectedUrl) {
      sendResponse({
        ok: false,
        error: `Conversation URL mismatch: expected ${expectedUrl}, got ${actualUrl ?? location.href}`,
        externalUrl: location.href
      });
      return;
    }
    sendResponse({
      ok: true,
      snapshot: conversationSnapshotFromSurface(surface, actualUrl, document.title),
      externalUrl: location.href
    });
    return;
  }

  if (message?.type === 'driver.catalog.probe') {
    sendResponse({
      ok: true,
      probe: catalogProbeFromDocument(document, location.href),
      externalUrl: location.href
    });
    return;
  }
  if (message?.type === 'driver.catalog.projects') {
    sendResponse({
      ok: true,
      projects: projectCandidatesFromDocument(document),
      externalUrl: location.href
    });
    return;
  }
  if (message?.type === 'driver.catalog.project.open') {
    const candidate = message?.candidate;
    if (!candidate || !Number.isInteger(candidate.index) || typeof candidate.title !== 'string' || !candidate.title.trim()) {
      sendResponse({ ok: false, error: 'A valid project candidate is required', externalUrl: location.href });
      return;
    }
    const available = projectCandidatesFromDocument(document);
    const exists = available.some((item) => (
      item.index === candidate.index && item.title === candidate.title
    )) || available.some((item) => item.title === candidate.title);
    if (!exists) {
      sendResponse({ ok: false, error: 'Project candidate is no longer available', externalUrl: location.href });
      return;
    }
    sendResponse({ ok: true, externalUrl: location.href });
    globalThis.setTimeout(() => {
      activateProjectCandidate(document, candidate);
    }, 0);
    return;
  }
  if (message?.type === 'driver.catalog.scan') {
    void scanCatalogDocument(document, location.href)
      .then((catalog) => sendResponse({ ok: true, catalog, externalUrl: location.href }))
      .catch((error) => sendResponse({
        ok: false,
        externalUrl: location.href,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }
  if (message?.type !== 'driver.submit') return;

  void submitDriverMessage(controller, message)
    .then((result) => sendResponse({
      ...result,
      externalUrl: location.href
    }))
    .catch((error) => sendResponse({
      started: false,
      externalUrl: location.href,
      error: error instanceof Error ? error.message : String(error)
    }));
  return true;
});
