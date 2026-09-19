import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogCoordinator, type CatalogBrowser } from '../src/extension/catalog-coordinator.ts';
import { CatalogStore } from '../src/extension/catalog-store.ts';
import type { ConversationCatalog } from '../src/catalog.ts';
import type { CatalogProjectCandidate } from '../src/extension/catalog-dom.ts';

class MemoryStorage {
  readonly data = new Map<string, unknown>();
  async get(key: string): Promise<Record<string, unknown>> {
    return this.data.has(key) ? { [key]: this.data.get(key) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }
}

class FakeBrowser implements CatalogBrowser {
  nextTab = 10;
  readonly created: string[] = [];
  readonly updated: string[] = [];
  readonly removed: number[] = [];
  readonly snapshots = new Map<string, ConversationCatalog>();
  readonly projectCandidates: CatalogProjectCandidate[] = [];
  readonly projectUrls = new Map<string, string>();
  readonly openedProjects: string[] = [];
  currentUrl = '';

  async create(url: string): Promise<number> {
    this.created.push(url);
    this.currentUrl = url;
    return this.nextTab++;
  }
  async update(_tabId: number, url: string): Promise<void> {
    this.updated.push(url);
    this.currentUrl = url;
  }
  async waitReady(_tabId: number): Promise<void> {}
  async listProjects(_tabId: number): Promise<CatalogProjectCandidate[]> {
    return [...this.projectCandidates];
  }
  async openProject(_tabId: number, candidate: CatalogProjectCandidate): Promise<string> {
    const url = this.projectUrls.get(candidate.title);
    if (!url) throw new Error(`No fake project URL for ${candidate.title}`);
    this.openedProjects.push(candidate.title);
    this.currentUrl = url;
    return url;
  }
  async scan(_tabId: number): Promise<ConversationCatalog> {
    return this.snapshots.get(this.currentUrl) ?? { projects: [], conversations: [] };
  }
  async remove(tabId: number): Promise<void> { this.removed.push(tabId); }
}

test('refresh scans root navigation then each discovered project in one scratch tab and closes it', async () => {
  const browser = new FakeBrowser();
  browser.snapshots.set('https://chatgpt.com/', {
    projects: [
      { projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' },
      { projectId: 'g-p-b', title: 'Research', url: 'https://chatgpt.com/g/g-p-b' }
    ],
    conversations: [
      { conversationId: 'standalone', title: 'Loose chat', url: 'https://chatgpt.com/c/standalone' }
    ]
  });
  browser.snapshots.set('https://chatgpt.com/g/g-p-a', {
    projects: [{ projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' }],
    conversations: [{
      projectId: 'g-p-a',
      conversationId: 'c-a',
      title: 'Frenet',
      url: 'https://chatgpt.com/g/g-p-a/c/c-a'
    }]
  });
  browser.snapshots.set('https://chatgpt.com/g/g-p-b', {
    projects: [{ projectId: 'g-p-b', title: 'Research', url: 'https://chatgpt.com/g/g-p-b' }],
    conversations: [{
      projectId: 'g-p-b',
      conversationId: 'c-b',
      title: 'Agent paper',
      url: 'https://chatgpt.com/g/g-p-b/c/c-b'
    }]
  });

  const coordinator = new CatalogCoordinator(browser, new CatalogStore(new MemoryStorage()));
  const catalog = await coordinator.refresh();

  assert.deepEqual(browser.created, ['https://chatgpt.com/']);
  assert.deepEqual(browser.updated, [
    'https://chatgpt.com/g/g-p-b',
    'https://chatgpt.com/g/g-p-a'
  ]);
  assert.deepEqual(browser.removed, [10]);
  assert.equal(catalog.projects.length, 2);
  assert.equal(catalog.conversations.length, 3);
});

test('refresh maps live project button titles to canonical project URLs in one scratch tab', async () => {
  const browser = new FakeBrowser();
  const seedUrl = 'https://chatgpt.com/c/seed';
  const projectA = 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const projectB = 'g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const seed: ConversationCatalog = {
    projects: [
      { projectId: projectA, title: projectA, url: `https://chatgpt.com/g/${projectA}` }
    ],
    conversations: [
      { conversationId: 'loose', title: 'Loose chat', url: 'https://chatgpt.com/c/loose' },
      { projectId: projectA, conversationId: 'c-a', title: 'Frenet', url: `https://chatgpt.com/g/${projectA}/c/c-a` }
    ]
  };
  browser.projectCandidates.push(
    { index: 0, title: 'Robotics' },
    { index: 1, title: 'Research' }
  );
  browser.projectUrls.set('Robotics', `https://chatgpt.com/g/${projectA}-robotics`);
  browser.projectUrls.set('Research', `https://chatgpt.com/g/${projectB}-research`);
  browser.snapshots.set(`https://chatgpt.com/g/${projectA}-robotics`, {
    projects: [
      { projectId: projectA, title: 'robotics project slug fallback title', url: `https://chatgpt.com/g/${projectA}` }
    ],
    conversations: [
      { projectId: projectA, conversationId: 'c-b', title: 'Recovery', url: `https://chatgpt.com/g/${projectA}/c/c-b` }
    ]
  });
  browser.snapshots.set(`https://chatgpt.com/g/${projectB}-research`, {
    projects: [
      { projectId: projectB, title: 'research project slug fallback title', url: `https://chatgpt.com/g/${projectB}` }
    ],
    conversations: [
      { projectId: projectB, conversationId: 'c-c', title: 'Paper', url: `https://chatgpt.com/g/${projectB}/c/c-c` }
    ]
  });

  const coordinator = new CatalogCoordinator(browser, new CatalogStore(new MemoryStorage()));
  const catalog = await coordinator.refresh(seed, seedUrl);

  assert.deepEqual(browser.created, [seedUrl]);
  assert.deepEqual(browser.updated, [seedUrl, seedUrl]);
  assert.deepEqual(browser.openedProjects, ['Robotics', 'Research']);
  assert.deepEqual(browser.removed, [10]);
  assert.equal(catalog.projects.find((item) => item.projectId === projectA)?.title, 'Robotics');
  assert.equal(catalog.projects.find((item) => item.projectId === projectB)?.title, 'Research');
  assert.equal(catalog.conversations.length, 4);
});

test('checkpoints each successful project scan so a later project failure cannot erase progress', async () => {
  const storage = new MemoryStorage();
  const store = new CatalogStore(storage);
  const browser = new FakeBrowser();
  browser.snapshots.set('https://chatgpt.com/', {
    projects: [
      { projectId: 'g-p-a', title: 'A', url: 'https://chatgpt.com/g/g-p-a' },
      { projectId: 'g-p-b', title: 'B', url: 'https://chatgpt.com/g/g-p-b' }
    ],
    conversations: []
  });
  browser.snapshots.set('https://chatgpt.com/g/g-p-a', {
    projects: [{ projectId: 'g-p-a', title: 'A', url: 'https://chatgpt.com/g/g-p-a' }],
    conversations: [{
      projectId: 'g-p-a', conversationId: 'c-a', title: 'A chat',
      url: 'https://chatgpt.com/g/g-p-a/c/c-a'
    }]
  });
  const originalScan = browser.scan.bind(browser);
  browser.scan = async (tabId: number) => {
    if (browser.currentUrl === 'https://chatgpt.com/g/g-p-b') throw new Error('project B failed');
    return originalScan(tabId);
  };

  const coordinator = new CatalogCoordinator(browser, store);
  await assert.rejects(() => coordinator.refresh(), /project B failed/);

  const persisted = await store.load();
  assert.equal(persisted.conversations.some((item) => item.conversationId === 'c-a'), true);
});

test('merges a partial live seed with stored catalog instead of replacing previously confirmed entries', async () => {
  const storage = new MemoryStorage();
  const store = new CatalogStore(storage);
  await store.save({
    projects: [],
    conversations: [{ conversationId: 'old', title: 'Old chat', url: 'https://chatgpt.com/c/old' }]
  });
  const browser = new FakeBrowser();
  const seed: ConversationCatalog = {
    projects: [],
    conversations: [{ conversationId: 'new', title: 'New chat', url: 'https://chatgpt.com/c/new' }]
  };

  const coordinator = new CatalogCoordinator(browser, store);
  const catalog = await coordinator.refresh(seed);

  assert.equal(catalog.conversations.some((item) => item.conversationId === 'old'), true);
  assert.equal(catalog.conversations.some((item) => item.conversationId === 'new'), true);
});

test('resolve returns a cached URL title without opening a scratch tab', async () => {
  const storage = new MemoryStorage();
  const store = new CatalogStore(storage);
  await store.save({
    projects: [],
    conversations: [{ conversationId: 'c-1', title: 'Known', url: 'https://chatgpt.com/c/c-1' }]
  });
  const browser = new FakeBrowser();
  const coordinator = new CatalogCoordinator(browser, store);

  const entry = await coordinator.resolve('https://chatgpt.com/c/c-1');
  assert.equal(entry?.title, 'Known');
  assert.deepEqual(browser.created, []);
});

test('resolve opens an unknown canonical URL, scans its real title, merges it, and closes the scratch tab', async () => {
  const browser = new FakeBrowser();
  browser.snapshots.set('https://chatgpt.com/c/c-2', {
    projects: [],
    conversations: [{ conversationId: 'c-2', title: 'Resolved title', url: 'https://chatgpt.com/c/c-2' }]
  });
  const coordinator = new CatalogCoordinator(browser, new CatalogStore(new MemoryStorage()));

  const entry = await coordinator.resolve('https://chatgpt.com/c/c-2');
  assert.equal(entry?.title, 'Resolved title');
  assert.deepEqual(browser.created, ['https://chatgpt.com/c/c-2']);
  assert.deepEqual(browser.removed, [10]);
});

test('resolve rejects non-conversation URLs for fixed conversation selection', async () => {
  const coordinator = new CatalogCoordinator(new FakeBrowser(), new CatalogStore(new MemoryStorage()));
  await assert.rejects(() => coordinator.resolve('https://example.com/c/x'), /valid ChatGPT conversation URL/);
  await assert.rejects(() => coordinator.resolve('https://chatgpt.com/g/g-p-a'), /valid ChatGPT conversation URL/);
});
