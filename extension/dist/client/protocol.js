export const CLIENT_SOURCE = 'chatgpt-web-driver.client';
export const EXTENSION_SOURCE = 'chatgpt-web-driver.extension';
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
];
export function clientBridgeHelloMessage() {
    return {
        source: CLIENT_SOURCE,
        type: 'bridge.hello'
    };
}
export function isClientBridgeHelloMessage(value) {
    if (!value || typeof value !== 'object')
        return false;
    const message = value;
    return message.source === CLIENT_SOURCE && message.type === 'bridge.hello';
}
export function parseClientDriverControlMessage(value) {
    if (!value || typeof value !== 'object')
        return null;
    const message = value;
    if (message.source !== CLIENT_SOURCE || message.type !== 'driver.control')
        return null;
    if (typeof message.requestId !== 'string' || !message.requestId)
        return null;
    if (typeof message.op !== 'string' || !DRIVER_CONTROL_OPS.includes(message.op))
        return null;
    const payload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
        ? message.payload
        : {};
    return {
        requestId: message.requestId,
        op: message.op,
        payload
    };
}
export function parseClientSubmitMessage(value) {
    if (!value || typeof value !== 'object')
        return null;
    const message = value;
    if (message.source !== CLIENT_SOURCE || message.type !== 'provider.submit')
        return null;
    if (typeof message.clientRequestId !== 'string' || !message.clientRequestId)
        return null;
    if (typeof message.conversationId !== 'string' || !message.conversationId)
        return null;
    if (message.externalUrl !== undefined && (typeof message.externalUrl !== 'string' || !message.externalUrl.trim()))
        return null;
    if (typeof message.text !== 'string' || !message.text.trim())
        return null;
    return {
        clientRequestId: message.clientRequestId,
        conversationId: message.conversationId,
        ...(typeof message.externalUrl === 'string' ? { externalUrl: message.externalUrl.trim() } : {}),
        text: message.text
    };
}
export function parseClientConversationRequest(value) {
    if (!value || typeof value !== 'object')
        return null;
    const message = value;
    if (message.source !== CLIENT_SOURCE)
        return null;
    if (message.type !== 'conversation.load' && message.type !== 'conversation.navigate')
        return null;
    if (typeof message.requestId !== 'string' || !message.requestId)
        return null;
    if (typeof message.url !== 'string' || !message.url.trim())
        return null;
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
export function parseClientCatalogRequest(value) {
    if (!value || typeof value !== 'object')
        return null;
    const message = value;
    if (message.source !== CLIENT_SOURCE)
        return null;
    if (typeof message.requestId !== 'string' || !message.requestId)
        return null;
    if (message.type === 'catalog.get' || message.type === 'catalog.refresh') {
        return { type: message.type, requestId: message.requestId };
    }
    if (message.type === 'catalog.resolve' && typeof message.url === 'string' && message.url.trim()) {
        return { type: 'catalog.resolve', requestId: message.requestId, url: message.url.trim() };
    }
    return null;
}
export function extensionDriverControlResultMessage(requestId, result) {
    return {
        source: EXTENSION_SOURCE,
        type: 'driver.control.result',
        requestId,
        result
    };
}
export function bridgeReadyMessage() {
    return {
        source: EXTENSION_SOURCE,
        type: 'bridge.ready'
    };
}
export function extensionSubmitResultMessage(clientRequestId, result) {
    return {
        source: EXTENSION_SOURCE,
        type: 'submit.result',
        clientRequestId,
        result
    };
}
export function extensionProviderEventMessage(envelope) {
    return {
        source: EXTENSION_SOURCE,
        type: 'provider.event',
        requestId: envelope.requestId,
        ...(envelope.clientRequestId ? { clientRequestId: envelope.clientRequestId } : {}),
        event: envelope.event
    };
}
export function extensionConversationResultMessage(requestId, result) {
    return {
        source: EXTENSION_SOURCE,
        type: 'conversation.result',
        requestId,
        result
    };
}
export function extensionCatalogResultMessage(requestId, result) {
    return {
        source: EXTENSION_SOURCE,
        type: 'catalog.result',
        requestId,
        result
    };
}
