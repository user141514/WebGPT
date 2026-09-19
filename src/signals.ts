import type { SemanticDocument } from './content/model.js';
import type { DomElement, DomSurface } from './dom.js';

const BUTTON = 'button';
const USER_MESSAGE = '[data-message-author-role="user"]';
const ASSISTANT_MESSAGE = '[data-message-author-role="assistant"]';

function buttonHas(button: DomElement, text: string): boolean {
  return [
    button.getAttribute('aria-label'),
    button.getAttribute('data-testid'),
    button.textContent
  ].some((value) => value?.toLowerCase().includes(text) ?? false);
}

export function findPrompt(surface: DomSurface): DomElement | null {
  return surface.query('#prompt-textarea')
    ?? surface.queryAll('[contenteditable="true"]')
      .find((element) => element.isContentEditable && (element.getAttribute('role') === 'textbox' || element.getAttribute('aria-label')?.toLowerCase().includes('message')))
    ?? null;
}

export function findSendButton(surface: DomSurface): DomElement | null {
  return surface.queryAll(BUTTON).find((button) => (
    button.getAttribute('disabled') === null
    && (button.getAttribute('data-testid') === 'send-button' || buttonHas(button, 'send'))
  )) ?? null;
}

export function injectPrompt(surface: DomSurface, prompt: DomElement, text: string): void {
  prompt.focus();
  if (prompt.isContentEditable) {
    surface.exec('selectAll');
    const inserted = surface.exec('insertText', text);
    if (!inserted) prompt.textContent = text;
  } else {
    surface.setNativeInputValue(prompt, text);
  }
  prompt.dispatchEvent(surface.inputEvent(text));
}

export function userCount(surface: DomSurface): number {
  return surface.queryAll(USER_MESSAGE).length;
}

export function assistantCount(surface: DomSurface): number {
  return surface.queryAll(ASSISTANT_MESSAGE).length;
}

export function latestAssistant(surface: DomSurface): DomElement | null {
  return surface.queryAll(ASSISTANT_MESSAGE).at(-1) ?? null;
}

export function latestAssistantText(surface: DomSurface): string {
  return latestAssistant(surface)?.textContent?.trim() ?? '';
}

export function latestAssistantSignature(surface: DomSurface): string {
  const assistant = latestAssistant(surface);
  if (!assistant) return '';
  return assistant.contentSignature?.() ?? assistant.textContent?.trim() ?? '';
}

export function latestAssistantDocument(surface: DomSurface): SemanticDocument | null {
  return latestAssistant(surface)?.semanticDocument?.() ?? null;
}

export function isGenerating(surface: DomSurface): boolean {
  return surface.queryAll(BUTTON).some((button) => (
    button.getAttribute('data-testid') === 'stop-button' || buttonHas(button, 'stop')
  ));
}

export function hasCompletionAction(surface: DomSurface): boolean {
  return latestAssistant(surface)?.queryAll(BUTTON)
    .some((button) => buttonHas(button, 'copy') || buttonHas(button, 'regenerate')) ?? false;
}
