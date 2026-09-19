import type { CatalogConversation, ConversationCatalog } from '../catalog.js';
import type { ConversationSnapshot } from '../conversation-snapshot.js';
import type { ProviderEventEnvelope } from '../extension/service-router.js';
import type { ClientSubmitResult } from './state.js';

export const CLIENT_SOURCE = 'chatgpt-web-driver.client';
export const EXTENSION_SOURCE = 'chatgpt-web-driver.extension';

export interface ClientBridgeHelloMessage {
  source: typeof CLIENT_SOURCE;
  type: 'bridge.hello';
}

export const DRIVER_CONTROL_OPS = [
  'extension.status',
  'extension.reload',
  'extension.reload.verify',
  'catalog.get',
  'catalog.refresh',
  'catalog.resolve',
  'catalog.probe',
  'catalog.inspect',
  'client.open',
  'conversation.load',
  'conversation.navigate',
  'conversation.probe',
  'watchdog.target',
  'watchdog.candidates'
] as const;

export type DriverControlOp = typeof DRIVER_CONTROL_OPS[number];

export interface ClientDriverControlMessage {
  source: typeof CLIENT_SOURCE;
  type: 'driver.control';
  requestId: string;
  op: DriverControlOp;
  payload?: Record<string, unknown>;
}

export interface ParsedClientDriverControlMessage {
  requestId: string;
  op: DriverControlOp;
  payload: Record<string, unknown>;
}

export interface ClientSubmitMessage {
  source: typeof CLIENT_SOURCE;
  type: 'provider.submit';
  clientRequestId: string;
  conversationId: string;
  externalUrl?: string;
  text: string;
}

export interface ParsedClientSubmit {
  clientRequestId: string;
  conversationId: string;
  externalUrl?: string;
  text: string;
}

export type ClientCatalogRequest =
  | { source: typeof CLIENT_SOURCE; type: 'catalog.get'; requestId: string }
  | { source: typeof CLIENT_SOURCE; type: 'catalog.refresh'; requestId: string }
  | { source: typeof CLIENT_SOURCE; type: 'catalog.resolve'; requestId: string; url: string };

export type ClientConversationRequest =
  | {
      source: typeof CLIENT_SOURCE;
      type: 'conversation.load';
      requestId: string;
      url: string;
    }
  | {
      source: typeof CLIENT_SOURCE;
      type: 'conversation.navigate';
      requestId: string;
      url: string;
      fromUrl?: string;
    };

export type ParsedClientConversationRequest =
  | { type: 'conversation.load'; requestId: string; url: string }
  | { type: 'conversation.navigate'; requestId: string; url: string; fromUrl?: string };

export type ParsedClientCatalogRequest =
  | { type: 'catalog.get'; requestId: string }
  | { type: 'catalog.refresh'; requestId: string }
  | { type: 'catalog.resolve'; requestId: string; url: string };

export type CatalogResult =
  | { ok: true; catalog: ConversationCatalog; entry?: CatalogConversation }
  | { ok: false; error: string };

export type ConversationLoadResult =
  | { ok: true; snapshot: ConversationSnapshot; tabId?: number }
  | { ok: false; error: string };

export interface ExtensionDriverControlResultMessage {
  source: typeof EXTENSION_SOURCE;
  type: 'driver.control.result';
  requestId: string;
  result: unknown;
}

export interface ExtensionBridgeReadyMessage {
  source: typeof EXTENSION_SOURCE;
  type: 'bridge.ready';
}

export interface ExtensionSubmitResultMessage {
  source: typeof EXTENSION_SOURCE;
  type: 'submit.result';
  clientRequestId: string;
  result: ClientSubmitResult;
}

export interface ExtensionProviderEventMessage {
  source: typeof EXTENSION_SOURCE;
  type: 'provider.event';
  requestId: string;
  clientRequestId?: string;
  event: ProviderEventEnvelope['event'];
}

export interface ExtensionCatalogResultMessage {
  source: typeof EXTENSION_SOURCE;
  type: 'catalog.result';
  requestId: string;
  result: CatalogResult;
}

export interface ExtensionConversationResultMessage {
  source: typeof EXTENSION_SOURCE;
  type: 'conversation.result';
  requestId: string;
  result: ConversationLoadResult;
}

export function clientBridgeHelloMessage(): ClientBridgeHelloMessage {
  return {
    source: CLIENT_SOURCE,
    type: 'bridge.hello'
  };
}

export function isClientBridgeHelloMessage(value: unknown): value is ClientBridgeHelloMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ClientBridgeHelloMessage>;
  return message.source === CLIENT_SOURCE && message.type === 'bridge.hello';
}

export function parseClientDriverControlMessage(value: unknown): ParsedClientDriverControlMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<ClientDriverControlMessage>;
  if (message.source !== CLIENT_SOURCE || message.type !== 'driver.control') return null;
  if (typeof message.requestId !== 'string' || !message.requestId) return null;
  if (typeof message.op !== 'string' || !(DRIVER_CONTROL_OPS as readonly string[]).includes(message.op)) return null;
  const payload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
    ? message.payload as Record<string, unknown>
    : {};
  return {
    requestId: message.requestId,
    op: message.op as DriverControlOp,
    payload
  };
}

export function parseClientSubmitMessage(value: unknown): ParsedClientSubmit | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<ClientSubmitMessage>;
  if (message.source !== CLIENT_SOURCE || message.type !== 'provider.submit') return null;
  if (typeof message.clientRequestId !== 'string' || !message.clientRequestId) return null;
  if (typeof message.conversationId !== 'string' || !message.conversationId) return null;
  if (message.externalUrl !== undefined && (typeof message.externalUrl !== 'string' || !message.externalUrl.trim())) return null;
  if (typeof message.text !== 'string' || !message.text.trim()) return null;
  return {
    clientRequestId: message.clientRequestId,
    conversationId: message.conversationId,
    ...(typeof message.externalUrl === 'string' ? { externalUrl: message.externalUrl.trim() } : {}),
    text: message.text
  };
}

export function parseClientConversationRequest(value: unknown): ParsedClientConversationRequest | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<ClientConversationRequest>;
  if (message.source !== CLIENT_SOURCE) return null;
  if (message.type !== 'conversation.load' && message.type !== 'conversation.navigate') return null;
  if (typeof message.requestId !== 'string' || !message.requestId) return null;
  if (typeof message.url !== 'string' || !message.url.trim()) return null;
  if (message.type === 'conversation.navigate') {
    const fromUrl = typeof message.fromUrl === 'string' ? message.fromUrl.trim() : '';
    return {
      type: 'conversation.navigate',
      requestId: message.requestId,
      url: message.url.trim(),
      ...(fromUrl ? { fromUrl } : {})
    };
  }
  return {
    type: 'conversation.load',
    requestId: message.requestId,
    url: message.url.trim()
  };
}

export function parseClientCatalogRequest(value: unknown): ParsedClientCatalogRequest | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<ClientCatalogRequest>;
  if (message.source !== CLIENT_SOURCE) return null;
  if (typeof message.requestId !== 'string' || !message.requestId) return null;
  if (message.type === 'catalog.get' || message.type === 'catalog.refresh') {
    return { type: message.type, requestId: message.requestId };
  }
  if (message.type === 'catalog.resolve' && typeof (message as any).url === 'string' && (message as any).url.trim()) {
    return { type: 'catalog.resolve', requestId: message.requestId, url: (message as any).url.trim() };
  }
  return null;
}

export function extensionDriverControlResultMessage(
  requestId: string,
  result: unknown
): ExtensionDriverControlResultMessage {
  return {
    source: EXTENSION_SOURCE,
    type: 'driver.control.result',
    requestId,
    result
  };
}

export function bridgeReadyMessage(): ExtensionBridgeReadyMessage {
  return {
    source: EXTENSION_SOURCE,
    type: 'bridge.ready'
  };
}

export function extensionSubmitResultMessage(
  clientRequestId: string,
  result: ClientSubmitResult
): ExtensionSubmitResultMessage {
  return {
    source: EXTENSION_SOURCE,
    type: 'submit.result',
    clientRequestId,
    result
  };
}

export function extensionProviderEventMessage(
  envelope: ProviderEventEnvelope
): ExtensionProviderEventMessage {
  return {
    source: EXTENSION_SOURCE,
    type: 'provider.event',
    requestId: envelope.requestId,
    ...(envelope.clientRequestId ? { clientRequestId: envelope.clientRequestId } : {}),
    event: envelope.event
  };
}

export function extensionConversationResultMessage(
  requestId: string,
  result: ConversationLoadResult
): ExtensionConversationResultMessage {
  return {
    source: EXTENSION_SOURCE,
    type: 'conversation.result',
    requestId,
    result
  };
}

export function extensionCatalogResultMessage(
  requestId: string,
  result: CatalogResult
): ExtensionCatalogResultMessage {
  return {
    source: EXTENSION_SOURCE,
    type: 'catalog.result',
    requestId,
    result
  };
}
