export { ChatGptDriver } from './driver.js';
export type { DriverEvent, DriverOptions } from './driver.js';
export type { DomElement, DomSurface } from './dom.js';
export { BrowserDomElement, BrowserDomSurface } from './browser-dom.js';
export type { BrowserDomConstructors } from './browser-dom.js';
export { ContentController } from './extension/content-controller.js';
export type {
  ContentControllerOptions,
  ContentProviderEvent,
  IntervalScheduler,
  ProviderRuntimeEvent,
  SubmitResult
} from './extension/content-controller.js';
export {
  authoritativeConversationUrl,
  chatGptPageUrl,
  chatGptTabsInPriorityOrder,
  chooseConversationUrl,
  chooseChatGptTab,
  chooseConversationNavigationTab,
  isChatGptUrl,
  providerEventEnvelope,
  shouldPersistProviderBinding,
  ProviderRequestGate,
  RequestRouteRegistry,
  sendToBoundConversationTab,
  sendToExistingConversationTab,
  sendToFirstResponsiveChatGptTab,
  stableConversationUrl,
  tabsForConversation
} from './extension/service-router.js';
export type { ConversationBinding, ProviderEventEnvelope, ProviderTab } from './extension/service-router.js';
