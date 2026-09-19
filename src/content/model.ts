export type ContentNode =
  | { kind: 'text'; text: string }
  | {
      kind: 'element';
      tagName: string;
      children: ContentNode[];
      attributes?: Record<string, string>;
    };

export type SemanticInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; content: SemanticInline[] }
  | { type: 'emphasis'; content: SemanticInline[] }
  | { type: 'strike'; content: SemanticInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; content: SemanticInline[] }
  | { type: 'math'; latex: string };

export type SemanticBlock =
  | { type: 'paragraph'; content: SemanticInline[] }
  | { type: 'heading'; level: number; content: SemanticInline[] }
  | { type: 'code'; language: string | null; code: string }
  | { type: 'list'; ordered: boolean; items: SemanticInline[][] }
  | { type: 'blockquote'; blocks: SemanticBlock[] }
  | { type: 'table'; headers: SemanticInline[][]; rows: SemanticInline[][][] }
  | { type: 'math'; display: true; latex: string }
  | { type: 'divider' };

export interface SemanticDocument {
  blocks: SemanticBlock[];
}
