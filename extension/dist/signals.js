const BUTTON = 'button';
const USER_MESSAGE = '[data-message-author-role="user"]';
const ASSISTANT_MESSAGE = '[data-message-author-role="assistant"]';
function buttonHas(button, text) {
    return [
        button.getAttribute('aria-label'),
        button.getAttribute('data-testid'),
        button.textContent
    ].some((value) => value?.toLowerCase().includes(text) ?? false);
}
export function findPrompt(surface) {
    return surface.query('#prompt-textarea')
        ?? surface.queryAll('[contenteditable="true"]')
            .find((element) => element.isContentEditable && (element.getAttribute('role') === 'textbox' || element.getAttribute('aria-label')?.toLowerCase().includes('message')))
        ?? null;
}
export function findSendButton(surface) {
    return surface.queryAll(BUTTON).find((button) => (button.getAttribute('disabled') === null
        && (button.getAttribute('data-testid') === 'send-button' || buttonHas(button, 'send')))) ?? null;
}
export function injectPrompt(surface, prompt, text) {
    prompt.focus();
    if (prompt.isContentEditable) {
        surface.exec('selectAll');
        const inserted = surface.exec('insertText', text);
        if (!inserted)
            prompt.textContent = text;
    }
    else {
        surface.setNativeInputValue(prompt, text);
    }
    prompt.dispatchEvent(surface.inputEvent(text));
}
export function userCount(surface) {
    return surface.queryAll(USER_MESSAGE).length;
}
export function assistantCount(surface) {
    return surface.queryAll(ASSISTANT_MESSAGE).length;
}
export function latestAssistant(surface) {
    return surface.queryAll(ASSISTANT_MESSAGE).at(-1) ?? null;
}
export function latestAssistantText(surface) {
    return latestAssistant(surface)?.textContent?.trim() ?? '';
}
export function latestAssistantSignature(surface) {
    const assistant = latestAssistant(surface);
    if (!assistant)
        return '';
    return assistant.contentSignature?.() ?? assistant.textContent?.trim() ?? '';
}
export function latestAssistantDocument(surface) {
    return latestAssistant(surface)?.semanticDocument?.() ?? null;
}
export function isGenerating(surface) {
    return surface.queryAll(BUTTON).some((button) => (button.getAttribute('data-testid') === 'stop-button' || buttonHas(button, 'stop')));
}
export function hasCompletionAction(surface) {
    return latestAssistant(surface)?.queryAll(BUTTON)
        .some((button) => buttonHas(button, 'copy') || buttonHas(button, 'regenerate')) ?? false;
}
