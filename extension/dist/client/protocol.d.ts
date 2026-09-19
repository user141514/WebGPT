import type { CatalogConversation, ConversationCatalog } from '../catalog.js';
import type { ConversationSnapshot } from '../conversation-snapshot.js';
import type { ProviderEventEnvelope } from '../extension/service-router.js';
import type { ClientSubmitResult } from './state.js';
export declare const CLIENT_SOURCE = "chatgpt-web-driver.client";
export declare const EXTENSION_SOURCE = "chatgpt-web-driver.extension";
export interface ClientBridgeHelloMessage {
    source: typeof CLIENT_SOURCE;
    type: 'bridge.hello';
}
export declare const DRIVER_CONTROL_OPS: readonly ["extension.status", "extension.reload", "extension.reload.verify", "catalog.get", "catalog.refresh", "catalog.resolve", "catalog.probe", "catalog.inspect", "client.open", "conversation.load", "conversation.navigate", "conversation.probe", "watchdog.target", "watchdog.candidates"];
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
export type ClientCatalogRequest = {
    source: typeof CLIENT_SOURCE;
    type: 'catalog.get';
    requestId: string;
} | {
    source: typeof CLIENT_SOURCE;
    type: 'catalog.refresh';
    requestId: string;
} | {
    source: typeof CLIENT_SOURCE;
    type: 'catalog.resolve';
    requestId: string;
    url: string;
};
export type ClientConversationRequest = {
    source: typeof CLIENT_SOURCE;
    type: 'conversation.load';
    requestId: string;
    url: string;
} | {
    source: typeof CLIENT_SOURCE;
    type: 'conversation.navigate';
    requestId: string;
    url: string;
    fromUrl?: string;
};
export type ParsedClientConversationRequest = {
    type: 'conversation.load';
    requestId: string;
    url: string;
} | {
    type: 'conversation.navigate';
    requestId: string;
    url: string;
    fromUrl?: string;
};
export type ParsedClientCatalogRequest = {
    type: 'catalog.get';
    requestId: string;
} | {
    type: 'catalog.refresh';
    requestId: string;
} | {
    type: 'catalog.resolve';
    requestId: string;
    url: string;
};
export type CatalogResult = {
    ok: true;
    catalog: ConversationCatalog;
    entry?: CatalogConversation;
} | {
    ok: false;
    error: string;
};
export type ConversationLoadResult = {
    ok: true;
    snapshot: ConversationSnapshot;
    tabId?: number;
} | {
    ok: false;
    error: string;
};
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
export declare function clientBridgeHelloMessage(): ClientBridgeHelloMessage;
export declare function isClientBridgeHelloMessage(value: unknown): value is ClientBridgeHelloMessage;
export declare function parseClientDriverControlMessage(value: unknown): ParsedClientDriverControlMessage | null;
export declare function parseClientSubmitMessage(value: unknown): ParsedClientSubmit | null;
export declare function parseClientConversationRequest(value: unknown): ParsedClientConversationRequest | null;
export declare function parseClientCatalogRequest(value: unknown): ParsedClientCatalogRequest | null;
export declare function extensionDriverControlResultMessage(requestId: string, result: unknown): ExtensionDriverControlResultMessage;
export declare function bridgeReadyMessage(): ExtensionBridgeReadyMessage;
export declare function extensionSubmitResultMessage(clientRequestId: string, result: ClientSubmitResult): ExtensionSubmitResultMessage;
export declare function extensionProviderEventMessage(envelope: ProviderEventEnvelope): ExtensionProviderEventMessage;
export declare function extensionConversationResultMessage(requestId: string, result: ConversationLoadResult): ExtensionConversationResultMessage;
export declare function extensionCatalogResultMessage(requestId: string, result: CatalogResult): ExtensionCatalogResultMessage;
