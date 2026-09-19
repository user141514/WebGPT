const MESSAGE_SELECTOR = '[data-message-author-role="user"],[data-message-author-role="assistant"]';
export function stableMessageId(element) {
    const own = element.getAttribute('data-message-id');
    if (own)
        return own;
    return element.closest('[data-message-id]')?.getAttribute('data-message-id') ?? null;
}
export function turnTestId(element) {
    const own = element.getAttribute('data-testid');
    if (own?.startsWith('conversation-turn-'))
        return own;
    const host = element.closest('[data-testid^="conversation-turn-"]');
    return host?.getAttribute('data-testid') ?? null;
}
function overflowY(element) {
    return element.ownerDocument?.defaultView?.getComputedStyle?.(element).overflowY ?? '';
}
function scrollable(element) {
    const target = element;
    return target.scrollHeight > target.clientHeight + 4
        && /(auto|scroll|overlay)/i.test(overflowY(element));
}
export function nearestConversationScrollContainer(element) {
    let current = element.parentElement;
    while (current) {
        if (scrollable(current))
            return current;
        current = current.parentElement;
    }
    const document = element.ownerDocument;
    const scrolling = document?.scrollingElement;
    if (scrolling && scrollable(scrolling))
        return scrolling;
    return null;
}
export function conversationDomProbe(document) {
    const messages = [...document.querySelectorAll(MESSAGE_SELECTOR)];
    const container = messages.length
        ? nearestConversationScrollContainer(messages.at(-1))
        : null;
    return {
        messageCount: messages.length,
        messages: messages.map((element) => ({
            role: element.getAttribute('data-message-author-role') ?? '',
            messageId: stableMessageId(element),
            turnTestId: turnTestId(element)
        })),
        scroll: container
            ? {
                tag: container.tagName.toLowerCase(),
                scrollTop: container.scrollTop,
                scrollHeight: container.scrollHeight,
                clientHeight: container.clientHeight,
                overflowY: overflowY(container)
            }
            : null
    };
}
