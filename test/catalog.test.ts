import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogFromCandidates,
  catalogKeyForUrl,
  mergeCatalogs,
  parseChatGptRoute,
  type CatalogCandidate
} from '../src/catalog.ts';

test('parses canonical standalone, project, and project-conversation routes without misclassifying GPT routes', () => {
  assert.deepEqual(parseChatGptRoute('https://chatgpt.com/c/conv-1?foo=bar'), {
    kind: 'conversation',
    conversationId: 'conv-1',
    url: 'https://chatgpt.com/c/conv-1'
  });
  assert.deepEqual(parseChatGptRoute('https://chatgpt.com/g/g-p-project-1/'), {
    kind: 'project',
    projectId: 'g-p-project-1',
    url: 'https://chatgpt.com/g/g-p-project-1'
  });
  assert.deepEqual(parseChatGptRoute('https://chatgpt.com/g/g-p-project-1/c/conv-2/extra'), {
    kind: 'conversation',
    projectId: 'g-p-project-1',
    conversationId: 'conv-2',
    projectUrl: 'https://chatgpt.com/g/g-p-project-1',
    url: 'https://chatgpt.com/g/g-p-project-1/c/conv-2'
  });
  assert.equal(parseChatGptRoute('https://chatgpt.com/g/g-custom-gpt'), null);
  assert.equal(parseChatGptRoute('https://example.com/c/conv-1'), null);
});

test('normalizes project root slugs without changing the project identity', () => {
  const projectId = 'g-p-6a7ff4f54a448191b07d17cd0a16f998';
  assert.deepEqual(parseChatGptRoute(`https://chatgpt.com/g/${projectId}-agent`), {
    kind: 'project',
    projectId,
    projectSlug: 'agent',
    url: `https://chatgpt.com/g/${projectId}`
  });

  const catalog = catalogFromCandidates({
    baseUrl: `https://chatgpt.com/g/${projectId}-agent`,
    documentTitle: 'ChatGPT',
    candidates: []
  });
  assert.deepEqual(catalog.projects, [{
    projectId,
    title: 'agent',
    url: `https://chatgpt.com/g/${projectId}`
  }]);
});

test('uses canonical ChatGPT URL as a deterministic conversation catalog key', () => {
  assert.equal(
    catalogKeyForUrl('https://chatgpt.com/g/g-p-project/c/conv?foo=1'),
    'https://chatgpt.com/g/g-p-project/c/conv'
  );
  assert.equal(catalogKeyForUrl('https://chatgpt.com/'), null);
});

test('builds project and conversation catalog entries from real navigation labels', () => {
  const candidates: CatalogCandidate[] = [
    { href: '/g/g-p-alpha', text: 'Robotics' },
    { href: '/g/g-p-alpha/c/conv-a', text: '400m Frenet control' },
    { href: '/c/conv-b', ariaLabel: 'Standalone research' },
    { href: '/c/conv-b?duplicate=1', text: 'Standalone research' }
  ];

  const catalog = catalogFromCandidates({
    baseUrl: 'https://chatgpt.com/',
    candidates
  });

  assert.deepEqual(catalog.projects, [
    {
      projectId: 'g-p-alpha',
      title: 'Robotics',
      url: 'https://chatgpt.com/g/g-p-alpha'
    }
  ]);
  assert.deepEqual(catalog.conversations, [
    {
      conversationId: 'conv-b',
      title: 'Standalone research',
      url: 'https://chatgpt.com/c/conv-b'
    },
    {
      projectId: 'g-p-alpha',
      conversationId: 'conv-a',
      title: '400m Frenet control',
      url: 'https://chatgpt.com/g/g-p-alpha/c/conv-a'
    }
  ]);
});

test('treats candidate text as already-semantic and does not truncate it from shorter accessibility metadata', () => {
  const catalog = catalogFromCandidates({
    baseUrl: 'https://chatgpt.com/g/g-p-alpha/c/current',
    candidates: [
      {
        href: '/g/g-p-alpha/c/conv-a',
        text: 'Plan migration strategy',
        ariaLabel: 'Plan migration — conversation in project Core'
      }
    ]
  });

  assert.equal(
    catalog.conversations.find((item) => item.conversationId === 'conv-a')?.title,
    'Plan migration strategy'
  );
});

test('derives a project placeholder from project conversation URLs when no project root link is present', () => {
  const catalog = catalogFromCandidates({
    baseUrl: 'https://chatgpt.com/c/current',
    candidates: [
      { href: '/g/g-p-alpha/c/conv-a', text: '400m Frenet control' },
      { href: '/g/g-p-alpha/c/conv-b', text: 'G1 recovery' }
    ]
  });

  assert.deepEqual(catalog.projects, [{
    projectId: 'g-p-alpha',
    title: 'g-p-alpha',
    url: 'https://chatgpt.com/g/g-p-alpha'
  }]);
});

test('uses current page title as fallback only for the current conversation and normalizes ChatGPT suffixes', () => {
  const catalog = catalogFromCandidates({
    baseUrl: 'https://chatgpt.com/g/g-p-alpha/c/conv-current',
    documentTitle: 'Current conversation - ChatGPT',
    candidates: [
      { href: '/g/g-p-alpha', text: 'Robotics' }
    ]
  });

  assert.deepEqual(catalog.conversations, [
    {
      projectId: 'g-p-alpha',
      conversationId: 'conv-current',
      title: 'Current conversation',
      url: 'https://chatgpt.com/g/g-p-alpha/c/conv-current'
    }
  ]);
});

test('uses a project page document title to upgrade a project placeholder', () => {
  const catalog = catalogFromCandidates({
    baseUrl: 'https://chatgpt.com/g/g-p-alpha',
    documentTitle: 'Robotics - ChatGPT',
    candidates: []
  });

  assert.deepEqual(catalog.projects, [{
    projectId: 'g-p-alpha',
    title: 'Robotics',
    url: 'https://chatgpt.com/g/g-p-alpha'
  }]);
});

test('merges catalog snapshots by canonical URL without discarding better titles', () => {
  const merged = mergeCatalogs(
    {
      projects: [{ projectId: 'g-p-alpha', title: 'g-p-alpha', url: 'https://chatgpt.com/g/g-p-alpha' }],
      conversations: [{ conversationId: 'conv-1', title: 'conv-1', url: 'https://chatgpt.com/c/conv-1' }]
    },
    {
      projects: [{ projectId: 'g-p-alpha', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-alpha' }],
      conversations: [{ conversationId: 'conv-1', title: 'A useful title', url: 'https://chatgpt.com/c/conv-1' }]
    }
  );

  assert.equal(merged.projects[0]?.title, 'Robotics');
  assert.equal(merged.conversations[0]?.title, 'A useful title');
});
