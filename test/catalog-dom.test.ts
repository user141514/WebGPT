import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateProjectCandidate,
  catalogProbeFromDocument,
  catalogSnapshotFromDocument,
  projectCandidatesFromDocument,
  scanCatalogDocument
} from '../src/extension/catalog-dom.ts';

class FakeElement {
  textContent: string | null = '';
  parentElement: FakeElement | null = null;
  clicks = 0;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  readonly attrs = new Map<string, string>();
  onClick: (() => void) | null = null;
  constructor(readonly href = '') {}
  getAttribute(name: string): string | null {
    if (name === 'href') return this.href || null;
    return this.attrs.get(name) ?? null;
  }
  scrollTo(options: { top: number }): void {
    this.scrollTop = options.top;
  }
  querySelectorAll(_selector: string): FakeElement[] { return []; }
  click(): void {
    this.clicks += 1;
    this.onClick?.();
  }
}

class FakeDocument {
  title = 'Current chat - ChatGPT';
  readonly container = new FakeElement();
  stage = 0;

  querySelectorAll(selector: string): FakeElement[] {
    if (selector !== 'a[href]') return [];
    const project = new FakeElement('/g/g-p-a');
    project.textContent = 'Robotics';
    project.parentElement = this.container;
    const first = new FakeElement('/g/g-p-a/c/c-1');
    first.textContent = 'First chat';
    first.parentElement = this.container;
    if (this.stage === 0) return [project, first];
    const second = new FakeElement('/g/g-p-a/c/c-2');
    second.textContent = 'Second chat';
    second.parentElement = this.container;
    return [project, second];
  }
}

test('probes navigation anchors without exposing conversation message content', () => {
  const doc = new FakeDocument();
  const probe = catalogProbeFromDocument(
    doc as unknown as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current'
  );

  assert.equal(probe.totalAnchors, 2);
  assert.equal(probe.catalogAnchors, 2);
  assert.equal(probe.projects, 1);
  assert.equal(probe.conversations, 1);
  assert.deepEqual(probe.samples.map((item) => item.href), ['/g/g-p-a', '/g/g-p-a/c/c-1']);
});

test('discovers project buttons structurally from a text button paired with a named action in the same row', () => {
  const project = new FakeElement();
  project.textContent = '创新工程想法';
  project.attrs.set('role', 'button');
  const home = new FakeElement();
  home.attrs.set('aria-label', '打开项目首页');
  const action = new FakeElement();
  action.attrs.set('aria-label', '打开 创新工程想法 的项目选项');
  const row = new FakeElement();
  project.parentElement = row;
  home.parentElement = row;
  action.parentElement = row;
  (row as any).querySelectorAll = (selector: string) => selector === 'button,[role="button"]' ? [project, home, action] : [];
  const doc = new FakeDocument() as any;
  doc.querySelectorAll = (selector: string) => {
    if (selector === '[role="button"]') return [project];
    return [];
  };

  const candidates = projectCandidatesFromDocument(doc as Document);
  assert.deepEqual(candidates, [
    { index: 0, title: '创新工程想法', actionLabel: '打开项目首页' }
  ]);
  assert.equal(activateProjectCandidate(doc as Document, candidates[0]!), true);
  assert.equal(project.clicks, 0);
  assert.equal(home.clicks, 1);
});

test('extracts a dedicated conversation title descendant instead of concatenated preview text', () => {
  const doc = new FakeDocument() as any;
  const project = new FakeElement('/g/g-p-a');
  project.textContent = 'Robotics';
  const conversation = new FakeElement('/g/g-p-a/c/c-preview');
  conversation.textContent = '架构设计与MVP我只关心是否存在一个可以长期稳定运行的版本';
  conversation.attrs.set('aria-label', '架构设计与MVP — 项目 创新工程想法 中的聊天');
  const title = new FakeElement();
  title.textContent = '架构设计与MVP';
  const preview = new FakeElement();
  preview.textContent = '我只关心是否存在一个可以长期稳定运行的版本';
  (conversation as any).querySelectorAll = (selector: string) => selector === 'span,div' ? [title, preview] : [];
  doc.querySelectorAll = (selector: string) => selector === 'a[href]' ? [project, conversation] : [];

  const snapshot = catalogSnapshotFromDocument(
    doc as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current'
  );

  assert.equal(
    snapshot.conversations.find((item) => item.conversationId === 'c-preview')?.title,
    '架构设计与MVP'
  );
});

test('extracts catalog labels from semantic link attributes without depending on CSS classes', () => {
  const doc = new FakeDocument();
  const snapshot = catalogSnapshotFromDocument(
    doc as unknown as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current'
  );

  assert.equal(snapshot.projects[0]?.title, 'Robotics');
  assert.equal(snapshot.conversations.some((item) => item.title === 'First chat'), true);
  assert.equal(snapshot.conversations.some((item) => item.title === 'Current chat'), true);
});

test('activates project Show more controls to discover conversations hidden behind explicit expansion', async () => {
  const doc = new FakeDocument();
  const more = new FakeElement();
  more.textContent = '显示更多';
  more.parentElement = doc.container;
  more.onClick = () => { doc.stage = 1; };
  (doc.container as any).querySelectorAll = (selector: string) => doc.querySelectorAll(selector);
  const originalQuerySelectorAll = doc.querySelectorAll.bind(doc);
  (doc as any).querySelectorAll = (selector: string) => {
    if (selector === 'button,[role="button"]') return doc.stage === 0 ? [more] : [];
    return originalQuerySelectorAll(selector);
  };

  doc.container.clientHeight = 800;
  doc.container.scrollHeight = 800;

  const catalog = await scanCatalogDocument(
    doc as unknown as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current',
    { sleep: async () => {}, getOverflowY: () => 'auto', maxSteps: 4, settleMs: 0 }
  );

  assert.equal(more.clicks, 1);
  assert.equal(catalog.conversations.some((item) => item.conversationId === 'c-1'), true);
  assert.equal(catalog.conversations.some((item) => item.conversationId === 'c-2'), true);
});

test('ignores Show more controls inside hidden stale project panels', async () => {
  const doc = new FakeDocument() as any;
  const hiddenPanel = new FakeElement();
  hiddenPanel.attrs.set('aria-hidden', 'true');
  const visiblePanel = new FakeElement();

  const hiddenMore = new FakeElement();
  hiddenMore.textContent = '显示更多';
  hiddenMore.parentElement = hiddenPanel;
  const visibleMore = new FakeElement();
  visibleMore.textContent = '显示更多';
  visibleMore.parentElement = visiblePanel;
  visibleMore.onClick = () => { doc.stage = 1; };

  const projectAnchor = new FakeElement('/g/g-p-a/c/c-1');
  projectAnchor.textContent = 'First chat';
  projectAnchor.parentElement = visiblePanel;
  (hiddenPanel as any).querySelectorAll = (selector: string) => selector === 'a[href]' ? [projectAnchor] : [];
  (visiblePanel as any).querySelectorAll = (selector: string) => selector === 'a[href]' ? [projectAnchor] : [];
  const originalQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector: string) => {
    if (selector === 'button,[role="button"]') return [hiddenMore, visibleMore];
    return originalQuerySelectorAll(selector);
  };

  const catalog = await scanCatalogDocument(
    doc as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current',
    { sleep: async () => {}, getOverflowY: () => 'auto', maxExpandSteps: 4, settleMs: 0 }
  );

  assert.equal(hiddenMore.clicks, 0);
  assert.equal(visibleMore.clicks > 0, true);
  assert.equal(catalog.conversations.some((item) => item.conversationId === 'c-2'), true);
});

test('waits for delayed project expansion before declaring the Show more control stagnant', async () => {
  const doc = new FakeDocument() as any;
  const more = new FakeElement();
  more.textContent = '显示更多';
  more.parentElement = doc.container;
  (doc.container as any).querySelectorAll = (selector: string) => doc.querySelectorAll(selector);
  const originalQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector: string) => {
    if (selector === 'button,[role="button"]') return [more];
    return originalQuerySelectorAll(selector);
  };

  let settles = 0;
  const catalog = await scanCatalogDocument(
    doc as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current',
    {
      sleep: async () => {
        settles += 1;
        if (settles >= 3) doc.stage = 1;
      },
      getOverflowY: () => 'auto',
      maxExpandSteps: 3,
      settleMs: 0
    }
  );

  assert.equal(catalog.conversations.some((item) => item.conversationId === 'c-2'), true);
});

test('scrolls the catalog container to collect virtualized conversations and restores scroll position', async () => {
  const doc = new FakeDocument();
  doc.container.clientHeight = 200;
  doc.container.scrollHeight = 800;
  doc.container.scrollTop = 40;

  const catalog = await scanCatalogDocument(
    doc as unknown as Document,
    'https://chatgpt.com/g/g-p-a/c/c-current',
    {
      sleep: async () => {
        if (doc.container.scrollTop > 40) doc.stage = 1;
      },
      getOverflowY: () => 'auto',
      maxSteps: 8,
      settleMs: 0
    }
  );

  assert.equal(catalog.conversations.some((item) => item.conversationId === 'c-1'), true);
  assert.equal(catalog.conversations.some((item) => item.conversationId === 'c-2'), true);
  assert.equal(doc.container.scrollTop, 40);
});
