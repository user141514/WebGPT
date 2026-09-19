import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatGptDriver, type DriverEvent, type DomElement, type DomSurface } from '../src/index.ts';
import type { SemanticDocument } from '../src/content/index.ts';

class FakeElement implements DomElement {
  textContent = '';
  value = '';
  isContentEditable = false;
  clicks = 0;
  focused = false;
  dispatches: string[] = [];
  readonly events: Event[] = [];

  readonly children = new Map<string, DomElement[]>();
  readonly attributes: Record<string, string>;
  signature: string | null = null;
  semantic: SemanticDocument | null = null;

  constructor(attributes: Record<string, string> = {}) {
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  queryAll(selector: string): DomElement[] {
    return this.children.get(selector) ?? [];
  }

  contentSignature(): string {
    return this.signature ?? this.textContent ?? '';
  }

  semanticDocument(): SemanticDocument | null {
    return this.semantic;
  }

  focus(): void { this.focused = true; }
  click(): void { this.clicks += 1; }
  dispatchEvent(event: Event): boolean {
    this.dispatches.push(event.type);
    this.events.push(event);
    return true;
  }
}

class FakeSurface implements DomSurface {
  readonly queries = new Map<string, DomElement | null>();
  readonly lists = new Map<string, DomElement[]>();
  readonly commands: string[] = [];
  readonly nativeSets: Array<{ element: DomElement; value: string }> = [];
  insertTextSucceeds = true;

  query(selector: string): DomElement | null { return this.queries.get(selector) ?? null; }
  inputEvent(): Event { return new Event('input', { bubbles: true }); }
  queryAll(selector: string): DomElement[] { return this.lists.get(selector) ?? []; }
  exec(command: 'selectAll' | 'insertText', _value?: string): boolean {
    this.commands.push(command);
    return command === 'insertText' ? this.insertTextSucceeds : true;
  }
  event(type: string): Event { return new Event(type, { bubbles: true }); }
  setNativeInputValue(element: DomElement, value: string): void {
    this.nativeSets.push({ element, value });
    element.value = value;
  }
}

test('injects into the preferred prompt editor and submits through the enabled send button', () => {
  const surface = new FakeSurface();
  const prompt = new FakeElement();
  const send = new FakeElement({ 'aria-label': 'Send prompt' });
  surface.queries.set('#prompt-textarea', prompt);
  surface.lists.set('button', [send]);
  const driver = new ChatGptDriver(surface, () => {});

  assert.equal(driver.submit('hello'), true);
  assert.deepEqual(surface.nativeSets, [{ element: prompt, value: 'hello' }]);
  assert.deepEqual(prompt.dispatches, ['input']);
  assert.equal(prompt.events[0]?.type, 'input');
  assert.equal(prompt.events[0]?.bubbles, true);
  assert.equal(send.clicks, 1);
});

test('prepares prompt before waiting for the send control to become available', () => {
  const surface = new FakeSurface();
  const prompt = new FakeElement();
  const send = new FakeElement({ 'data-testid': 'send-button' });
  surface.queries.set('#prompt-textarea', prompt);
  const driver = new ChatGptDriver(surface, () => {});

  assert.equal(driver.prepare('hello'), true);
  assert.deepEqual(surface.nativeSets, [{ element: prompt, value: 'hello' }]);
  assert.equal(driver.submitPrepared(), false);

  surface.lists.set('button', [send]);
  assert.equal(driver.submitPrepared(), true);
  assert.equal(send.clicks, 1);
});

test('uses a semantic contenteditable fallback and browser insertion path', () => {
  const surface = new FakeSurface();
  const prompt = new FakeElement({ role: 'textbox', contenteditable: 'true' });
  prompt.isContentEditable = true;
  const send = new FakeElement({ 'data-testid': 'send-button' });
  surface.lists.set('[contenteditable="true"]', [prompt]);
  surface.lists.set('button', [send]);
  const driver = new ChatGptDriver(surface, () => {});

  assert.equal(driver.submit('hello'), true);
  assert.deepEqual(surface.commands, ['selectAll', 'insertText']);
  assert.equal(prompt.dispatches[0], 'input');
  assert.equal(send.clicks, 1);
});

test('falls back to textContent when browser insertText rejects a contenteditable prompt', () => {
  const surface = new FakeSurface();
  const prompt = new FakeElement({ role: 'textbox', contenteditable: 'true' });
  prompt.isContentEditable = true;
  const send = new FakeElement({ 'data-testid': 'send-button' });
  surface.insertTextSucceeds = false;
  surface.lists.set('[contenteditable="true"]', [prompt]);
  surface.lists.set('button', [send]);
  const driver = new ChatGptDriver(surface, () => {});

  assert.equal(driver.submit('fallback text'), true);
  assert.equal(prompt.textContent, 'fallback text');
  assert.deepEqual(prompt.dispatches, ['input']);
  assert.equal(send.clicks, 1);
});

test('does not emit the previous assistant as the new response after user-count acceptance', () => {
  const surface = new FakeSurface();
  const events: DriverEvent[] = [];
  const prompt = new FakeElement();
  const send = new FakeElement({ 'data-testid': 'send-button' });
  const previousAssistant = new FakeElement();
  previousAssistant.textContent = 'old answer';
  previousAssistant.children.set('button', [new FakeElement({ 'aria-label': 'Copy response' })]);
  surface.queries.set('#prompt-textarea', prompt);
  surface.lists.set('button', [send]);
  surface.lists.set('[data-message-author-role="user"]', [new FakeElement()]);
  surface.lists.set('[data-message-author-role="assistant"]', [previousAssistant]);
  const driver = new ChatGptDriver(surface, (event) => events.push(event), { completionActionSettleMs: 0 });

  assert.equal(driver.submit('new question'), true);
  surface.lists.set('[data-message-author-role="user"]', [new FakeElement(), new FakeElement()]);
  driver.observe();

  assert.deepEqual(events, [{ type: 'request.accepted' }]);

  const currentAssistant = new FakeElement();
  currentAssistant.textContent = 'new answer';
  currentAssistant.children.set('button', [new FakeElement({ 'aria-label': 'Copy response' })]);
  surface.lists.set('[data-message-author-role="assistant"]', [previousAssistant, currentAssistant]);
  driver.observe();

  assert.deepEqual(events.slice(-3), [
    { type: 'assistant.status', status: 'complete' },
    { type: 'assistant.snapshot', text: 'new answer' },
    { type: 'assistant.completed', text: 'new answer' }
  ]);
});

test('accepts a request when the assistant count increases without a user count increase', () => {
  const surface = new FakeSurface();
  const events: DriverEvent[] = [];
  const prompt = new FakeElement();
  const send = new FakeElement({ 'aria-label': 'Send prompt' });
  surface.queries.set('#prompt-textarea', prompt);
  surface.lists.set('button', [send]);
  surface.lists.set('[data-message-author-role="user"]', [new FakeElement()]);
  surface.lists.set('[data-message-author-role="assistant"]', [new FakeElement()]);
  const driver = new ChatGptDriver(surface, (event) => events.push(event));

  assert.equal(driver.submit('question'), true);
  surface.lists.set('[data-message-author-role="assistant"]', [new FakeElement(), new FakeElement()]);
  driver.observe();

  assert.equal(events[0]?.type, 'request.accepted');
});

test('refreshes semantic snapshots when DOM structure changes without text changes', () => {
  const surface = new FakeSurface();
  const events: DriverEvent[] = [];
  const prompt = new FakeElement();
  const send = new FakeElement({ 'data-testid': 'send-button' });
  const oldAssistant = new FakeElement();
  surface.queries.set('#prompt-textarea', prompt);
  surface.lists.set('button', [send]);
  surface.lists.set('[data-message-author-role="user"]', [new FakeElement()]);
  surface.lists.set('[data-message-author-role="assistant"]', [oldAssistant]);
  const driver = new ChatGptDriver(surface, (event) => events.push(event));

  assert.equal(driver.submit('question'), true);
  const assistant = new FakeElement();
  assistant.textContent = 'same visible text';
  assistant.signature = 'structure-v1';
  assistant.semantic = {
    blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'same visible text' }] }]
  };
  surface.lists.set('[data-message-author-role="assistant"]', [oldAssistant, assistant]);
  driver.observe();

  assistant.signature = 'structure-v2';
  assistant.semantic = {
    blocks: [{ type: 'heading', level: 2, content: [{ type: 'text', text: 'same visible text' }] }]
  };
  driver.observe();

  const snapshots = events.filter((event) => event.type === 'assistant.snapshot');
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0], {
    type: 'assistant.snapshot',
    text: 'same visible text',
    document: {
      blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'same visible text' }] }]
    },
    markdown: 'same visible text'
  });
  assert.deepEqual(snapshots[1], {
    type: 'assistant.snapshot',
    text: 'same visible text',
    document: {
      blocks: [{ type: 'heading', level: 2, content: [{ type: 'text', text: 'same visible text' }] }]
    },
    markdown: '## same visible text'
  });
});

test('confirms acceptance and emits generating, snapshots, and completion from DOM signals', () => {
  const surface = new FakeSurface();
  const events: DriverEvent[] = [];
  const user = new FakeElement();
  const previousAssistant = new FakeElement();
  const assistant = new FakeElement();
  const stop = new FakeElement({ 'aria-label': 'Stop generating' });
  const complete = new FakeElement({ 'aria-label': 'Copy response' });
  const prompt = new FakeElement();
  const send = new FakeElement({ 'aria-label': 'Send prompt' });
  surface.queries.set('#prompt-textarea', prompt);
  surface.lists.set('[data-message-author-role="user"]', [user]);
  surface.lists.set('[data-message-author-role="assistant"]', [previousAssistant]);
  surface.lists.set('button', [send]);
  const driver = new ChatGptDriver(surface, (event) => events.push(event), { completionActionSettleMs: 0 });

  assert.equal(driver.submit('question'), true);
  surface.lists.set('[data-message-author-role="user"]', [user, new FakeElement()]);
  surface.lists.set('[data-message-author-role="assistant"]', [previousAssistant, assistant]);
  assistant.textContent = 'partial';
  surface.lists.set('button', [stop]);
  driver.observe();
  assistant.children.set('button', [complete]);
  surface.lists.set('button', [send]);
  assistant.textContent = 'final answer';
  driver.observe();

  assert.deepEqual(events, [
    { type: 'request.accepted' },
    { type: 'assistant.status', status: 'generating' },
    { type: 'assistant.snapshot', text: 'partial' },
    { type: 'assistant.status', status: 'complete' },
    { type: 'assistant.snapshot', text: 'final answer' },
    { type: 'assistant.completed', text: 'final answer' }
  ]);
});
