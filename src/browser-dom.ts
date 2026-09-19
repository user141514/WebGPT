import { captureContentTree, extractAssistantDocument } from './content/index.js';
import type { SemanticDocument } from './content/model.js';
import type { DomElement, DomSurface } from './dom.js';

type EventConstructor = new (type: string, init?: EventInit) => Event;
type InputEventConstructor = new (type: string, init?: InputEventInit) => InputEvent;

export interface BrowserDomConstructors {
  EventCtor?: EventConstructor;
  InputEventCtor?: InputEventConstructor;
}

export class BrowserDomElement implements DomElement {
  readonly raw: Element;

  constructor(raw: Element) {
    this.raw = raw;
  }

  get textContent(): string | null {
    return this.raw.textContent;
  }

  set textContent(value: string | null) {
    this.raw.textContent = value;
  }

  get value(): string | undefined {
    const value = (this.raw as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }

  set value(value: string | undefined) {
    if (value !== undefined) {
      (this.raw as { value?: string }).value = value;
    }
  }

  get isContentEditable(): boolean {
    return Boolean((this.raw as HTMLElement).isContentEditable);
  }

  getAttribute(name: string): string | null {
    return this.raw.getAttribute(name);
  }

  queryAll(selector: string): DomElement[] {
    return [...this.raw.querySelectorAll(selector)].map((element) => new BrowserDomElement(element));
  }

  contentSignature(): string {
    try {
      return JSON.stringify(extractAssistantDocument(captureContentTree(this.raw)));
    } catch {
      const text = this.raw.textContent ?? '';
      return `${text.length}:${this.raw.innerHTML.length}:${this.raw.childElementCount}:${text.slice(-160)}`;
    }
  }

  semanticDocument(): SemanticDocument | null {
    try {
      return extractAssistantDocument(captureContentTree(this.raw));
    } catch {
      return null;
    }
  }

  focus(): void {
    (this.raw as HTMLElement).focus?.();
  }

  click(): void {
    (this.raw as HTMLElement).click?.();
  }

  dispatchEvent(event: Event): boolean {
    return this.raw.dispatchEvent(event);
  }
}

function nativeValueSetter(raw: object): ((value: string) => void) | null {
  let prototype = Object.getPrototypeOf(raw) as object | null;
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (typeof descriptor?.set === 'function') {
      return (value: string) => descriptor.set?.call(raw, value);
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return null;
}

export class BrowserDomSurface implements DomSurface {
  private readonly document: Document;
  private readonly EventCtor: EventConstructor;
  private readonly InputEventCtor: InputEventConstructor;

  constructor(document: Document = globalThis.document, constructors: BrowserDomConstructors = {}) {
    this.document = document;
    this.EventCtor = constructors.EventCtor ?? globalThis.Event;
    this.InputEventCtor = constructors.InputEventCtor ?? globalThis.InputEvent;
  }

  query(selector: string): DomElement | null {
    const element = this.document.querySelector(selector);
    return element ? new BrowserDomElement(element) : null;
  }

  queryAll(selector: string): DomElement[] {
    return [...this.document.querySelectorAll(selector)].map((element) => new BrowserDomElement(element));
  }

  exec(command: 'selectAll' | 'insertText', value?: string): boolean {
    return this.document.execCommand(command, false, value);
  }

  event(type: string): Event {
    return new this.EventCtor(type, { bubbles: true });
  }

  inputEvent(data?: string): Event {
    return new this.InputEventCtor('input', {
      bubbles: true,
      inputType: 'insertText',
      data: data ?? null
    });
  }

  setNativeInputValue(element: DomElement, value: string): void {
    const raw = element instanceof BrowserDomElement ? element.raw : element as unknown as object;
    const setter = nativeValueSetter(raw);
    if (setter) {
      setter(value);
      return;
    }
    (raw as { value?: string }).value = value;
  }
}
