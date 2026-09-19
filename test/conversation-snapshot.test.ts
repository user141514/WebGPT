import assert from 'node:assert/strict';
import test from 'node:test';
import type { SemanticDocument } from '../src/content/model.ts';
import {
  conversationSnapshotFromSurface,
  type ConversationSnapshot
} from '../src/conversation-snapshot.ts';
import type { DomElement, DomSurface } from '../src/dom.ts';

class Element implements DomElement {
  textContent: string | null;
  readonly role: string;
  readonly document: SemanticDocument | null;

  constructor(role: string, text: string, document: SemanticDocument | null = null) {
    this.role = role;
    this.textContent = text;
    this.document = document;
  }

  getAttribute(name: string): string | null {
    return name === 'data-message-author-role' ? this.role : null;
  }
  queryAll(_selector: string): DomElement[] { return []; }
  semanticDocument(): SemanticDocument | null { return this.document; }
  focus(): void {}
  click(): void {}
  dispatchEvent(_event: Event): boolean { return true; }
}

class Surface implements DomSurface {
  readonly messages: DomElement[];
  constructor(messages: DomElement[]) { this.messages = messages; }
  query(_selector: string): DomElement | null { return null; }
  queryAll(selector: string): DomElement[] {
    return selector === '[data-message-author-role="user"],[data-message-author-role="assistant"]'
      ? this.messages
      : [];
  }
  exec(_command: 'selectAll' | 'insertText', _value?: string): boolean { return true; }
  event(type: string): Event { return new Event(type); }
  inputEvent(): Event { return new Event('input'); }
  setNativeInputValue(_element: DomElement, _value: string): void {}
}

test('captures ordered user and assistant turns with semantic assistant content', () => {
  const document: SemanticDocument = {
    blocks: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'strong', content: [{ type: 'text', text: 'world' }] }] },
      { type: 'code', language: 'ts', code: 'const x = 1;' }
    ]
  };
  const surface = new Surface([
    new Element('user', '  Question one  '),
    new Element('assistant', 'Hello world\nconst x = 1;', document),
    new Element('user', 'Question two'),
    new Element('assistant', 'Plain answer')
  ]);

  const snapshot = conversationSnapshotFromSurface(
    surface,
    'https://chatgpt.com/c/abc',
    'Example conversation'
  );

  assert.deepEqual(snapshot, {
    url: 'https://chatgpt.com/c/abc',
    title: 'Example conversation',
    turns: [
      { role: 'user', text: 'Question one' },
      {
        role: 'assistant',
        text: 'Hello world\nconst x = 1;',
        document,
        markdown: 'Hello **world**\n\n\`\`\`ts\nconst x = 1;\n\`\`\`'
      },
      { role: 'user', text: 'Question two' },
      { role: 'assistant', text: 'Plain answer' }
    ]
  } satisfies ConversationSnapshot);
});

test('ignores unsupported author roles and empty DOM markers', () => {
  const surface = new Surface([
    new Element('system', 'hidden'),
    new Element('user', 'question'),
    new Element('assistant', '')
  ]);

  const snapshot = conversationSnapshotFromSurface(surface, 'https://chatgpt.com/c/abc', 'Title');
  assert.deepEqual(snapshot.turns, [
    { role: 'user', text: 'question' }
  ]);
});
