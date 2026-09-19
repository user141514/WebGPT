import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatGptDriver, type DomElement, type DomSurface, type DriverEvent } from '../src/index.ts';

class Element implements DomElement {
  textContent = '';
  value = '';
  isContentEditable = false;
  readonly attributes: Record<string, string>;
  readonly children: Record<string, DomElement[]> = {};

  constructor(attributes: Record<string, string> = {}) {
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  queryAll(selector: string): DomElement[] {
    return this.children[selector] ?? [];
  }

  focus(): void {}
  click(): void {}
  dispatchEvent(_event: Event): boolean { return true; }
}

class Surface implements DomSurface {
  readonly lists: Record<string, DomElement[]> = {};
  readonly queries: Record<string, DomElement> = {};

  query(selector: string): DomElement | null {
    return this.queries[selector] ?? null;
  }

  queryAll(selector: string): DomElement[] {
    return this.lists[selector] ?? [];
  }

  exec(_command: 'selectAll' | 'insertText', _value?: string): boolean { return true; }
  event(type: string): Event { return new Event(type, { bubbles: true }); }
  inputEvent(): Event { return new Event('input', { bubbles: true }); }
  setNativeInputValue(element: DomElement, value: string): void { element.value = value; }
}

test('uses the 45-second fallback when the latest assistant turn has no completion action', () => {
  let time = 0;
  const surface = new Surface();
  const events: DriverEvent[] = [];
  const prompt = new Element();
  const send = new Element({ 'aria-label': 'Send prompt' });
  const previousAssistant = new Element();
  const assistant = new Element();
  surface.queries['#prompt-textarea'] = prompt;
  surface.lists.button = [send];
  surface.lists['[data-message-author-role="user"]'] = [new Element()];
  surface.lists['[data-message-author-role="assistant"]'] = [previousAssistant];
  const driver = new ChatGptDriver(surface, (event) => events.push(event), { now: () => time });

  assert.equal(driver.submit('question'), true);
  surface.lists['[data-message-author-role="user"]'].push(new Element());
  surface.lists['[data-message-author-role="assistant"]'].push(assistant);
  assistant.textContent = 'final answer';
  driver.observe();
  time = 44_999;
  driver.observe();
  assert.notDeepEqual(events.at(-1), { type: 'assistant.completed', text: 'final answer' });
  time = 45_000;
  driver.observe();

  assert.deepEqual(events.at(-1), { type: 'assistant.completed', text: 'final answer' });
});

test('uses a 5-second settle when the latest assistant turn has a completion action', () => {
  let time = 0;
  const surface = new Surface();
  const events: DriverEvent[] = [];
  const prompt = new Element();
  const send = new Element({ 'aria-label': 'Send prompt' });
  const previousAssistant = new Element();
  const assistant = new Element();
  assistant.children.button = [new Element({ 'aria-label': 'Copy response' })];
  surface.queries['#prompt-textarea'] = prompt;
  surface.lists.button = [send];
  surface.lists['[data-message-author-role="user"]'] = [new Element()];
  surface.lists['[data-message-author-role="assistant"]'] = [previousAssistant];
  const driver = new ChatGptDriver(surface, (event) => events.push(event), { now: () => time });

  assert.equal(driver.submit('question'), true);
  surface.lists['[data-message-author-role="user"]'].push(new Element());
  surface.lists['[data-message-author-role="assistant"]'].push(assistant);
  assistant.textContent = 'final answer';
  driver.observe();
  time = 4_999;
  driver.observe();
  assert.notDeepEqual(events.at(-1), { type: 'assistant.completed', text: 'final answer' });
  time = 5_000;
  driver.observe();

  assert.deepEqual(events.at(-1), { type: 'assistant.completed', text: 'final answer' });
});

test('does not use an old assistant message copy action to complete the latest turn', () => {
  let time = 0;
  const surface = new Surface();
  const events: DriverEvent[] = [];
  const prompt = new Element();
  const send = new Element({ 'aria-label': 'Send prompt' });
  const oldAssistant = new Element();
  oldAssistant.children.button = [new Element({ 'aria-label': 'Copy response' })];
  const latestAssistant = new Element();
  surface.queries['#prompt-textarea'] = prompt;
  surface.lists.button = [send];
  surface.lists['[data-message-author-role="user"]'] = [new Element()];
  surface.lists['[data-message-author-role="assistant"]'] = [oldAssistant, latestAssistant];
  const driver = new ChatGptDriver(surface, (event) => events.push(event), { now: () => time });

  assert.equal(driver.submit('question'), true);
  surface.lists['[data-message-author-role="user"]'].push(new Element());
  latestAssistant.textContent = 'current answer';
  driver.observe();
  time = 5_000;
  driver.observe();

  assert.notDeepEqual(events.at(-1), { type: 'assistant.completed', text: 'current answer' });
});
