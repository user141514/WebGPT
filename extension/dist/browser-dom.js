import { captureContentTree, extractAssistantDocument } from './content/index.js';
export class BrowserDomElement {
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    get textContent() {
        return this.raw.textContent;
    }
    set textContent(value) {
        this.raw.textContent = value;
    }
    get value() {
        const value = this.raw.value;
        return typeof value === 'string' ? value : undefined;
    }
    set value(value) {
        if (value !== undefined) {
            this.raw.value = value;
        }
    }
    get isContentEditable() {
        return Boolean(this.raw.isContentEditable);
    }
    getAttribute(name) {
        return this.raw.getAttribute(name);
    }
    queryAll(selector) {
        return [...this.raw.querySelectorAll(selector)].map((element) => new BrowserDomElement(element));
    }
    contentSignature() {
        try {
            return JSON.stringify(extractAssistantDocument(captureContentTree(this.raw)));
        }
        catch {
            const text = this.raw.textContent ?? '';
            return `${text.length}:${this.raw.innerHTML.length}:${this.raw.childElementCount}:${text.slice(-160)}`;
        }
    }
    semanticDocument() {
        try {
            return extractAssistantDocument(captureContentTree(this.raw));
        }
        catch {
            return null;
        }
    }
    focus() {
        this.raw.focus?.();
    }
    click() {
        this.raw.click?.();
    }
    dispatchEvent(event) {
        return this.raw.dispatchEvent(event);
    }
}
function nativeValueSetter(raw) {
    let prototype = Object.getPrototypeOf(raw);
    while (prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (typeof descriptor?.set === 'function') {
            return (value) => descriptor.set?.call(raw, value);
        }
        prototype = Object.getPrototypeOf(prototype);
    }
    return null;
}
export class BrowserDomSurface {
    document;
    EventCtor;
    InputEventCtor;
    constructor(document = globalThis.document, constructors = {}) {
        this.document = document;
        this.EventCtor = constructors.EventCtor ?? globalThis.Event;
        this.InputEventCtor = constructors.InputEventCtor ?? globalThis.InputEvent;
    }
    query(selector) {
        const element = this.document.querySelector(selector);
        return element ? new BrowserDomElement(element) : null;
    }
    queryAll(selector) {
        return [...this.document.querySelectorAll(selector)].map((element) => new BrowserDomElement(element));
    }
    exec(command, value) {
        return this.document.execCommand(command, false, value);
    }
    event(type) {
        return new this.EventCtor(type, { bubbles: true });
    }
    inputEvent(data) {
        return new this.InputEventCtor('input', {
            bubbles: true,
            inputType: 'insertText',
            data: data ?? null
        });
    }
    setNativeInputValue(element, value) {
        const raw = element instanceof BrowserDomElement ? element.raw : element;
        const setter = nativeValueSetter(raw);
        if (setter) {
            setter(value);
            return;
        }
        raw.value = value;
    }
}
