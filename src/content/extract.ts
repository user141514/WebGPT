import type {
  ContentNode,
  SemanticBlock,
  SemanticDocument,
  SemanticInline
} from './model.js';

function tag(node: ContentNode): string {
  return node.kind === 'element' ? node.tagName.toUpperCase() : '';
}

function attr(node: ContentNode, name: string): string | null {
  if (node.kind !== 'element') return null;
  return node.attributes?.[name] ?? null;
}

function children(node: ContentNode): ContentNode[] {
  return node.kind === 'element' ? node.children : [];
}

function textContent(node: ContentNode): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(textContent).join('');
}

function findDescendant(
  node: ContentNode,
  predicate: (candidate: ContentNode) => boolean
): ContentNode | null {
  for (const child of children(node)) {
    if (predicate(child)) return child;
    const nested = findDescendant(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function descendantsByTag(node: ContentNode, wanted: string): ContentNode[] {
  const upper = wanted.toUpperCase();
  const result: ContentNode[] = [];
  for (const child of children(node)) {
    if (tag(child) === upper) result.push(child);
    result.push(...descendantsByTag(child, upper));
  }
  return result;
}

function texAnnotation(node: ContentNode): string | null {
  const own = tag(node) === 'ANNOTATION' && attr(node, 'encoding') === 'application/x-tex'
    ? textContent(node).trim()
    : null;
  if (own) return own;
  const annotation = findDescendant(
    node,
    (candidate) => tag(candidate) === 'ANNOTATION'
      && attr(candidate, 'encoding') === 'application/x-tex'
  );
  const latex = annotation ? textContent(annotation).trim() : '';
  return latex || null;
}

function classIncludes(node: ContentNode, token: string): boolean {
  return (attr(node, 'class') ?? '').split(/\s+/).some((value) => value === token || value.includes(token));
}

function trimInlineEdges(content: SemanticInline[]): SemanticInline[] {
  const copy = [...content];
  const trimStart = (inline: SemanticInline): SemanticInline => {
    if (inline.type === 'text') return { ...inline, text: inline.text.replace(/^\s+/, '') };
    return inline;
  };
  const trimEnd = (inline: SemanticInline): SemanticInline => {
    if (inline.type === 'text') return { ...inline, text: inline.text.replace(/\s+$/, '') };
    return inline;
  };
  while (true) {
    const first = copy[0];
    if (first?.type !== 'text' || first.text.trim()) break;
    copy.shift();
  }
  while (true) {
    const last = copy.at(-1);
    if (last?.type !== 'text' || last.text.trim()) break;
    copy.pop();
  }
  if (copy.length) copy[0] = trimStart(copy[0]);
  if (copy.length) copy[copy.length - 1] = trimEnd(copy[copy.length - 1]);
  return copy;
}

function inlineFromNode(node: ContentNode): SemanticInline[] {
  if (node.kind === 'text') {
    return node.text ? [{ type: 'text', text: node.text }] : [];
  }

  const nodeTag = tag(node);
  if (nodeTag === 'SCRIPT' || nodeTag === 'STYLE' || nodeTag === 'BUTTON') return [];
  if (nodeTag === 'BR') return [{ type: 'text', text: '\n' }];

  if (nodeTag === 'CODE') {
    return [{ type: 'code', text: textContent(node) }];
  }

  const latex = texAnnotation(node);
  if (latex && (nodeTag === 'ANNOTATION' || classIncludes(node, 'katex'))) {
    return [{ type: 'math', latex }];
  }

  const nested = node.children.flatMap(inlineFromNode);
  if (!nested.length) return [];

  if (nodeTag === 'STRONG' || nodeTag === 'B') {
    return [{ type: 'strong', content: nested }];
  }
  if (nodeTag === 'EM' || nodeTag === 'I') {
    return [{ type: 'emphasis', content: nested }];
  }
  if (nodeTag === 'S' || nodeTag === 'DEL' || nodeTag === 'STRIKE') {
    return [{ type: 'strike', content: nested }];
  }
  if (nodeTag === 'A') {
    const href = attr(node, 'href');
    return href ? [{ type: 'link', href, content: nested }] : nested;
  }

  return nested;
}

function inlineFromChildren(node: ContentNode): SemanticInline[] {
  return trimInlineEdges(children(node).flatMap(inlineFromNode));
}

function codeLanguage(node: ContentNode): string | null {
  const code = tag(node) === 'CODE'
    ? node
    : findDescendant(node, (candidate) => tag(candidate) === 'CODE');
  if (!code) return null;
  const className = attr(code, 'class') ?? '';
  const match = className.match(/(?:^|\s)language-([^\s]+)/i);
  return match?.[1] ?? null;
}

function directRows(section: ContentNode): ContentNode[] {
  return children(section).filter((child) => tag(child) === 'TR');
}

function cells(row: ContentNode, cellTag: 'TH' | 'TD'): SemanticInline[][] {
  return children(row)
    .filter((child) => tag(child) === cellTag)
    .map((cell) => inlineFromChildren(cell));
}

function tableBlock(node: ContentNode): SemanticBlock {
  const thead = children(node).find((child) => tag(child) === 'THEAD') ?? null;
  const tbody = children(node).find((child) => tag(child) === 'TBODY') ?? null;
  const direct = directRows(node);
  const headerRow = thead ? directRows(thead)[0] : direct.find((row) => children(row).some((child) => tag(child) === 'TH'));
  const headers = headerRow ? cells(headerRow, 'TH') : [];
  const bodyRows = tbody
    ? directRows(tbody)
    : direct.filter((row) => row !== headerRow);
  const rows = bodyRows.map((row) => {
    const td = cells(row, 'TD');
    return td.length ? td : cells(row, 'TH');
  });
  return { type: 'table', headers, rows };
}

function listBlock(node: ContentNode): SemanticBlock {
  const ordered = tag(node) === 'OL';
  const items = children(node)
    .filter((child) => tag(child) === 'LI')
    .map((item) => trimInlineEdges(children(item).flatMap(inlineFromNode)));
  return { type: 'list', ordered, items };
}

function blockFromNode(node: ContentNode): SemanticBlock[] {
  if (node.kind === 'text') {
    const value = node.text.trim();
    return value ? [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] : [];
  }

  const nodeTag = tag(node);
  if (nodeTag === 'SCRIPT' || nodeTag === 'STYLE' || nodeTag === 'BUTTON') return [];

  if (/^H[1-6]$/.test(nodeTag)) {
    return [{
      type: 'heading',
      level: Number(nodeTag.slice(1)),
      content: inlineFromChildren(node)
    }];
  }
  if (nodeTag === 'P') {
    const content = inlineFromChildren(node);
    return content.length ? [{ type: 'paragraph', content }] : [];
  }
  if (nodeTag === 'PRE') {
    const codeNode = findDescendant(node, (candidate) => tag(candidate) === 'CODE');
    return [{
      type: 'code',
      language: codeLanguage(node),
      code: textContent(codeNode ?? node).replace(/\n$/, '')
    }];
  }
  if (nodeTag === 'UL' || nodeTag === 'OL') return [listBlock(node)];
  if (nodeTag === 'BLOCKQUOTE') {
    return [{ type: 'blockquote', blocks: children(node).flatMap(blockFromNode) }];
  }
  if (nodeTag === 'TABLE') return [tableBlock(node)];
  if (nodeTag === 'HR') return [{ type: 'divider' }];

  const latex = texAnnotation(node);
  if (latex && classIncludes(node, 'katex-display')) {
    return [{ type: 'math', display: true, latex }];
  }

  const nestedBlocks = children(node).flatMap(blockFromNode);
  if (nestedBlocks.length) return nestedBlocks;

  const content = inlineFromChildren(node);
  return content.length ? [{ type: 'paragraph', content }] : [];
}

export function extractAssistantDocument(root: ContentNode): SemanticDocument {
  const blocks = root.kind === 'element'
    ? root.children.flatMap(blockFromNode)
    : blockFromNode(root);
  return { blocks };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isContentDomNode(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE || node.nodeType === TEXT_NODE;
}

export function captureContentTree(node: Node): ContentNode {
  if (node.nodeType === TEXT_NODE) {
    return { kind: 'text', text: node.textContent ?? '' };
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return { kind: 'text', text: '' };
  }

  const element = node as Element;
  const attributes: Record<string, string> = {};
  for (const attribute of [...element.attributes]) {
    attributes[attribute.name] = attribute.value;
  }
  return {
    kind: 'element',
    tagName: element.tagName,
    attributes,
    children: [...element.childNodes]
      .filter(isContentDomNode)
      .map(captureContentTree)
  };
}
