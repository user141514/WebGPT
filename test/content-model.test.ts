import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureContentTree,
  extractAssistantDocument,
  semanticDocumentToMarkdown,
  type ContentNode
} from '../src/content/index.ts';

const text = (value: string): ContentNode => ({ kind: 'text', text: value });
const el = (
  tagName: string,
  children: ContentNode[] = [],
  attributes: Record<string, string> = {}
): ContentNode => ({ kind: 'element', tagName, children, attributes });

test('extracts paragraphs, headings, inline emphasis, code, and links', () => {
  const root = el('DIV', [
    el('H2', [text('Result')]),
    el('P', [
      text('Use '),
      el('STRONG', [text('semantic')]),
      text(' '),
      el('EM', [text('events')]),
      text(' with '),
      el('CODE', [text('requestId')]),
      text(' and '),
      el('A', [text('docs')], { href: 'https://example.com/docs' }),
      text('.')
    ])
  ]);

  const document = extractAssistantDocument(root);

  assert.deepEqual(document.blocks, [
    {
      type: 'heading',
      level: 2,
      content: [{ type: 'text', text: 'Result' }]
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Use ' },
        { type: 'strong', content: [{ type: 'text', text: 'semantic' }] },
        { type: 'text', text: ' ' },
        { type: 'emphasis', content: [{ type: 'text', text: 'events' }] },
        { type: 'text', text: ' with ' },
        { type: 'code', text: 'requestId' },
        { type: 'text', text: ' and ' },
        { type: 'link', href: 'https://example.com/docs', content: [{ type: 'text', text: 'docs' }] },
        { type: 'text', text: '.' }
      ]
    }
  ]);
});

test('extracts code blocks, lists, blockquotes, tables, display math, and dividers', () => {
  const root = el('DIV', [
    el('PRE', [el('CODE', [text('print("hello")')], { class: 'language-python' })]),
    el('UL', [el('LI', [text('one')]), el('LI', [text('two')])]),
    el('BLOCKQUOTE', [el('P', [text('quoted')])]),
    el('TABLE', [
      el('THEAD', [el('TR', [el('TH', [text('A')]), el('TH', [text('B')])])]),
      el('TBODY', [
        el('TR', [el('TD', [text('1')]), el('TD', [text('2')])]),
        el('TR', [el('TD', [text('3')]), el('TD', [text('4')])])
      ])
    ]),
    el('DIV', [
      el('SPAN', [
        el('ANNOTATION', [text('x^2 + y^2')], { encoding: 'application/x-tex' })
      ])
    ], { class: 'katex-display' }),
    el('HR')
  ]);

  const document = extractAssistantDocument(root);

  assert.deepEqual(document.blocks, [
    { type: 'code', language: 'python', code: 'print("hello")' },
    {
      type: 'list',
      ordered: false,
      items: [
        [{ type: 'text', text: 'one' }],
        [{ type: 'text', text: 'two' }]
      ]
    },
    {
      type: 'blockquote',
      blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }]
    },
    {
      type: 'table',
      headers: [
        [{ type: 'text', text: 'A' }],
        [{ type: 'text', text: 'B' }]
      ],
      rows: [
        [[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]],
        [[{ type: 'text', text: '3' }], [{ type: 'text', text: '4' }]]
      ]
    },
    { type: 'math', display: true, latex: 'x^2 + y^2' },
    { type: 'divider' }
  ]);
});

test('serializes semantic content to canonical markdown without losing block structure', () => {
  const root = el('DIV', [
    el('H3', [text('Example')]),
    el('P', [text('See '), el('A', [text('link')], { href: 'https://example.com' })]),
    el('OL', [el('LI', [text('first')]), el('LI', [text('second')])]),
    el('PRE', [el('CODE', [text('const x = `tick`;')], { class: 'language-ts' })]),
    el('DIV', [el('ANNOTATION', [text('E = mc^2')], { encoding: 'application/x-tex' })], { class: 'katex-display' })
  ]);

  const markdown = semanticDocumentToMarkdown(extractAssistantDocument(root));

  assert.equal(markdown, [
    '### Example',
    '',
    'See [link](https://example.com)',
    '',
    '1. first',
    '2. second',
    '',
    '```ts',
    'const x = `tick`;',
    '```',
    '',
    '$$',
    'E = mc^2',
    '$$'
  ].join('\n'));
});

test('flattens unknown wrapper elements instead of emitting duplicate text', () => {
  const root = el('DIV', [
    el('DIV', [
      el('DIV', [el('P', [text('only once')])])
    ])
  ]);

  assert.equal(semanticDocumentToMarkdown(extractAssistantDocument(root)), 'only once');
});

test('does not leak nested assistant action controls into mapped content', () => {
  const root = el('DIV', [
    el('DIV', [el('P', [text('actual answer')])]),
    el('DIV', [
      el('BUTTON', [text('Copy response')]),
      el('BUTTON', [text('Regenerate')])
    ])
  ]);

  assert.equal(
    semanticDocumentToMarkdown(extractAssistantDocument(root)),
    'actual answer'
  );
});

test('ignores non-element DOM markers while capturing assistant content', () => {
  const textNode = {
    nodeType: 3,
    textContent: 'mapped answer'
  };
  const commentNode = {
    nodeType: 8,
    textContent: 'react marker'
  };
  const paragraph = {
    nodeType: 1,
    tagName: 'P',
    attributes: [],
    childNodes: [commentNode, textNode]
  };
  const root = {
    nodeType: 1,
    tagName: 'DIV',
    attributes: [],
    childNodes: [commentNode, paragraph]
  };

  const captured = captureContentTree(root as unknown as Node);

  assert.equal(
    semanticDocumentToMarkdown(extractAssistantDocument(captured)),
    'mapped answer'
  );
});
