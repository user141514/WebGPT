import type { SemanticDocument } from './content/model.js';
export interface DomElement {
    textContent: string | null;
    value?: string;
    isContentEditable?: boolean;
    getAttribute(name: string): string | null;
    queryAll(selector: string): DomElement[];
    contentSignature?(): string;
    semanticDocument?(): SemanticDocument | null;
    focus(): void;
    click(): void;
    dispatchEvent(event: Event): boolean;
}
export interface DomSurface {
    query(selector: string): DomElement | null;
    queryAll(selector: string): DomElement[];
    exec(command: 'selectAll' | 'insertText', value?: string): boolean;
    event(type: string): Event;
    inputEvent(data?: string): Event;
    setNativeInputValue(element: DomElement, value: string): void;
}
