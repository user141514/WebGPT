import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserDomElement, BrowserDomSurface } from '../src/index.ts';

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;

  constructor(type: string, init: { bubbles?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
  }
}

class FakeNode {
  textContent: string | null = '';
  value = '';
  isContentEditable = false;
  clicks = 0;
  focused = false;
  readonly attrs = new Map<string, string>();
  readonly children = new Map<string, FakeNode[]>();
  readonly dispatched: FakeEvent[] = [];

  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  querySelectorAll(selector: string): FakeNode[] { return this.children.get(selector) ?? []; }
  focus(): void { this.focused = true; }
  click(): void { this.clicks += 1; }
  dispatchEvent(event: FakeEvent): boolean { this.dispatched.push(event); return true; }
}

class FakeDocument {
  readonly queries = new Map<string, FakeNode | null>();
  readonly lists = new Map<string, FakeNode[]>();
  readonly commands: Array<{ command: string; value?: string }> = [];
  execResult = true;

  querySelector(selector: string): FakeNode | null { return this.queries.get(selector) ?? null; }
  querySelectorAll(selector: string): FakeNode[] { return this.lists.get(selector) ?? []; }
  execCommand(command: string, _ui: boolean, value?: string): boolean {
    this.commands.push({ command, ...(value === undefined ? {} : { value }) });
    return this.execResult;
  }
}

test('wraps document queries and keeps nested assistant-turn queries scoped to the wrapped element', () => {
  const doc = new FakeDocument();
  const assistant = new FakeNode();
  const copy = new FakeNode();
  assistant.children.set('button', [copy]);
  doc.queries.set('#prompt-textarea', assistant);
  doc.lists.set('[data-message-author-role="assistant"]', [assistant]);

  const surface = new BrowserDomSurface(doc as unknown as Document, {
    EventCtor: FakeEvent as unknown as typeof Event,
    InputEventCtor: FakeEvent as unknown as typeof InputEvent
  });

  const prompt = surface.query('#prompt-textarea');
  assert.ok(prompt instanceof BrowserDomElement);
  assert.equal(prompt?.queryAll('button').length, 1);
  assert.equal(surface.queryAll('[data-message-author-role="assistant"]').length, 1);
});

test('uses the native prototype value setter rather than assigning through an overridden own setter', () => {
  const doc = new FakeDocument();
  let nativeValue = '';
  const proto = {
    set value(value: string) { nativeValue = value; },
    get value() { return nativeValue; }
  };
  const raw = Object.create(proto) as FakeNode;
  raw.textContent = '';
  raw.isContentEditable = false;
  raw.getAttribute = () => null;
  raw.querySelectorAll = () => [];
  raw.focus = () => {};
  raw.click = () => {};
  raw.dispatchEvent = () => true;
  Object.defineProperty(raw, 'value', {
    configurable: true,
    get: () => 'shadowed',
    set: () => { throw new Error('own setter must not be used'); }
  });

  const surface = new BrowserDomSurface(doc as unknown as Document, {
    EventCtor: FakeEvent as unknown as typeof Event,
    InputEventCtor: FakeEvent as unknown as typeof InputEvent
  });
  const wrapped = new BrowserDomElement(raw as unknown as Element);

  surface.setNativeInputValue(wrapped, 'hello');
  assert.equal(nativeValue, 'hello');
});

test('signs mapped assistant content instead of nested action-control chrome', () => {
  const answerText = { nodeType: 3, textContent: 'answer' };
  const buttonText = { nodeType: 3, textContent: 'Copy response' };
  const paragraph = {
    nodeType: 1,
    tagName: 'P',
    attributes: [],
    childNodes: [answerText]
  };
  const button = {
    nodeType: 1,
    tagName: 'BUTTON',
    attributes: [],
    childNodes: [buttonText]
  };
  const toolbar = {
    nodeType: 1,
    tagName: 'DIV',
    attributes: [],
    childNodes: [button]
  };
  const root = {
    nodeType: 1,
    tagName: 'DIV',
    attributes: [],
    childNodes: [paragraph, toolbar],
    textContent: 'answerCopy response',
    innerHTML: '',
    childElementCount: 2
  };

  const wrapped = new BrowserDomElement(root as unknown as Element);
  const first = wrapped.contentSignature();

  buttonText.textContent = 'Copied';
  root.textContent = 'answerCopied';
  const chromeOnlyChange = wrapped.contentSignature();

  answerText.textContent = 'answer changed';
  root.textContent = 'answer changedCopied';
  const contentChange = wrapped.contentSignature();

  assert.equal(chromeOnlyChange, first);
  assert.notEqual(contentChange, first);
});

test('creates bubbling input events and delegates browser insertion commands', () => {
  const doc = new FakeDocument();
  const surface = new BrowserDomSurface(doc as unknown as Document, {
    EventCtor: FakeEvent as unknown as typeof Event,
    InputEventCtor: FakeEvent as unknown as typeof InputEvent
  });

  const input = surface.inputEvent() as unknown as FakeEvent;
  assert.equal(input.type, 'input');
  assert.equal(input.bubbles, true);
  assert.equal(surface.exec('insertText', 'hello'), true);
  assert.deepEqual(doc.commands, [{ command: 'insertText', value: 'hello' }]);
});
