import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContentController,
  type ContentProviderEvent,
  type DomElement,
  type DomSurface
} from '../src/index.ts';

class Element implements DomElement {
  textContent = '';
  value = '';
  isContentEditable = false;
  readonly attrs: Record<string, string>;
  readonly children: Record<string, DomElement[]> = {};

  constructor(attrs: Record<string, string> = {}) { this.attrs = attrs; }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  queryAll(selector: string): DomElement[] { return this.children[selector] ?? []; }
  focus(): void {}
  click(): void {}
  dispatchEvent(_event: Event): boolean { return true; }
}

class Surface implements DomSurface {
  readonly queries: Record<string, DomElement> = {};
  readonly lists: Record<string, DomElement[]> = {};
  throwOnQuery = false;

  query(selector: string): DomElement | null {
    if (this.throwOnQuery) throw new Error('dom exploded');
    return this.queries[selector] ?? null;
  }
  queryAll(selector: string): DomElement[] {
    if (this.throwOnQuery) throw new Error('dom exploded');
    return this.lists[selector] ?? [];
  }
  exec(_command: 'selectAll' | 'insertText', _value?: string): boolean { return true; }
  event(type: string): Event { return new Event(type, { bubbles: true }); }
  inputEvent(): Event { return new Event('input', { bubbles: true }); }
  setNativeInputValue(element: DomElement, value: string): void { element.value = value; }
}

class Scheduler {
  private nextId = 1;
  readonly callbacks = new Map<number, () => void>();
  readonly cleared: number[] = [];

  setInterval(callback: () => void, _ms: number): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  clearInterval(id: unknown): void {
    const numeric = Number(id);
    this.cleared.push(numeric);
    this.callbacks.delete(numeric);
  }

  tick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}

function readySurface(): { surface: Surface; assistant: Element } {
  const surface = new Surface();
  const prompt = new Element();
  const send = new Element({ 'data-testid': 'send-button' });
  const assistant = new Element();
  surface.queries['#prompt-textarea'] = prompt;
  surface.lists.button = [send];
  surface.lists['[data-message-author-role="user"]'] = [new Element()];
  surface.lists['[data-message-author-role="assistant"]'] = [assistant];
  return { surface, assistant };
}

test('waits for composer, injects prompt, then waits for send before starting observation', async () => {
  const surface = new Surface();
  const prompt = new Element();
  const send = new Element({ 'data-testid': 'send-button' });
  const scheduler = new Scheduler();
  const sleeps: number[] = [];
  let sleepCount = 0;
  const controller = new ContentController(surface, () => {}, {
    scheduler,
    promptWaitAttempts: 2,
    sendWaitAttempts: 2,
    sleep: async (ms) => {
      sleeps.push(ms);
      sleepCount += 1;
      if (sleepCount === 1) surface.queries['#prompt-textarea'] = prompt;
      if (sleepCount === 2) surface.lists.button = [send];
    }
  });

  assert.deepEqual(await controller.submitWhenReady('req-1', 'hello'), { started: true });
  assert.equal(prompt.value, 'hello');
  assert.deepEqual(sleeps, [250, 125]);
  assert.equal(scheduler.callbacks.size, 1);
});

test('does not observe mutation-driven request progress before the prompt is actually submitted', async () => {
  const surface = new Surface();
  const prompt = new Element();
  const send = new Element({ 'data-testid': 'send-button' });
  surface.queries['#prompt-textarea'] = prompt;
  surface.lists['[data-message-author-role="user"]'] = [new Element()];
  surface.lists['[data-message-author-role="assistant"]'] = [];
  surface.lists.button = [];
  const scheduler = new Scheduler();
  const events: ContentProviderEvent[] = [];
  let controller!: ContentController;
  let sleeps = 0;
  controller = new ContentController(surface, (event) => events.push(event), {
    scheduler,
    sendWaitAttempts: 2,
    sleep: async () => {
      sleeps += 1;
      surface.lists['[data-message-author-role="user"]'].push(new Element());
      controller.requestObservation();
      await Promise.resolve();
      assert.equal(events.length, 0);
      surface.lists.button = [send];
    }
  });

  assert.deepEqual(await controller.submitWhenReady('req-1', 'hello'), { started: true });
  assert.equal(sleeps, 1);
});

test('observes an active request immediately when the DOM mutation path requests it', async () => {
  const { surface } = readySurface();
  const scheduler = new Scheduler();
  const events: ContentProviderEvent[] = [];
  const controller = new ContentController(surface, (event) => events.push(event), { scheduler });
  const requestObservation = (controller as any).requestObservation;

  assert.equal(typeof requestObservation, 'function');
  assert.deepEqual(controller.submit('req-1', 'hello'), { started: true });
  surface.lists['[data-message-author-role="user"]'].push(new Element());
  const assistant = new Element();
  assistant.textContent = 'first visible chunk';
  surface.lists['[data-message-author-role="assistant"]'].push(assistant);

  requestObservation.call(controller);
  requestObservation.call(controller);
  await Promise.resolve();

  assert.equal(events.some((item) => item.event.type === 'request.accepted'), true);
  assert.equal(events.some((item) => item.event.type === 'assistant.snapshot'), true);
});

test('associates every driver event with the active request id and releases after completion', () => {
  let now = 0;
  const { surface } = readySurface();
  const assistant = new Element();
  const scheduler = new Scheduler();
  const events: ContentProviderEvent[] = [];
  const controller = new ContentController(surface, (event) => events.push(event), {
    scheduler,
    driverOptions: { now: () => now, completionActionSettleMs: 0 }
  });

  assert.deepEqual(controller.submit('req-1', 'hello'), { started: true });
  surface.lists['[data-message-author-role="user"]'].push(new Element());
  surface.lists['[data-message-author-role="assistant"]'].push(assistant);
  assistant.textContent = 'done';
  assistant.children.button = [new Element({ 'aria-label': 'Copy response' })];
  scheduler.tick();
  now = 1;
  scheduler.tick();

  assert.equal(events.every((item) => item.requestId === 'req-1'), true);
  assert.equal(events.at(-1)?.event.type, 'assistant.completed');
  assert.equal(scheduler.callbacks.size, 0);
  assert.deepEqual(controller.submit('req-2', 'next'), { started: true });
});

test('rejects a concurrent submit instead of overwriting the active request association', () => {
  const { surface } = readySurface();
  const scheduler = new Scheduler();
  const controller = new ContentController(surface, () => {}, { scheduler });

  assert.deepEqual(controller.submit('req-1', 'first'), { started: true });
  assert.deepEqual(controller.submit('req-2', 'second'), {
    started: false,
    error: 'A ChatGPT request is already active'
  });
});

test('times out an unaccepted submission and releases the request', () => {
  let now = 0;
  const { surface } = readySurface();
  const scheduler = new Scheduler();
  const events: ContentProviderEvent[] = [];
  const controller = new ContentController(surface, (event) => events.push(event), {
    scheduler,
    now: () => now,
    acceptanceTimeoutMs: 3_000
  });

  assert.deepEqual(controller.submit('req-1', 'hello'), { started: true });
  now = 2_999;
  scheduler.tick();
  assert.equal(events.length, 0);
  now = 3_000;
  scheduler.tick();

  assert.deepEqual(events.at(-1), {
    requestId: 'req-1',
    event: {
      type: 'provider.error',
      message: 'Timed out waiting for ChatGPT to accept the request'
    }
  });
  assert.equal(scheduler.callbacks.size, 0);
  assert.deepEqual(controller.submit('req-2', 'next'), { started: true });
});

test('turns observation failures into a provider error and releases the request', () => {
  const { surface } = readySurface();
  const scheduler = new Scheduler();
  const events: ContentProviderEvent[] = [];
  const controller = new ContentController(surface, (event) => events.push(event), { scheduler });

  assert.deepEqual(controller.submit('req-1', 'hello'), { started: true });
  surface.throwOnQuery = true;
  scheduler.tick();

  assert.deepEqual(events.at(-1), {
    requestId: 'req-1',
    event: { type: 'provider.error', message: 'dom exploded' }
  });
  assert.equal(scheduler.callbacks.size, 0);
});
