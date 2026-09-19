import type { SemanticDocument } from './content/model.js';
import type { DomElement, DomSurface } from './dom.js';
type EventConstructor = new (type: string, init?: EventInit) => Event;
type InputEventConstructor = new (type: string, init?: InputEventInit) => InputEvent;
export interface BrowserDomConstructors {
    EventCtor?: EventConstructor;
    InputEventCtor?: InputEventConstructor;
}
export declare class BrowserDomElement implements DomElement {
    readonly raw: Element;
    constructor(raw: Element);
    get textContent(): string | null;
    set textContent(value: string | null);
    get value(): string | undefined;
    set value(value: string | undefined);
    get isContentEditable(): boolean;
    getAttribute(name: string): string | null;
    queryAll(selector: string): DomElement[];
    contentSignature(): string;
    semanticDocument(): SemanticDocument | null;
    focus(): void;
    click(): void;
    dispatchEvent(event: Event): boolean;
}
export declare class BrowserDomSurface implements DomSurface {
    private readonly document;
    private readonly EventCtor;
    private readonly InputEventCtor;
    constructor(document?: Document, constructors?: BrowserDomConstructors);
    query(selector: string): DomElement | null;
    queryAll(selector: string): DomElement[];
    exec(command: 'selectAll' | 'insertText', value?: string): boolean;
    event(type: string): Event;
    inputEvent(data?: string): Event;
    setNativeInputValue(element: DomElement, value: string): void;
}
export {};
