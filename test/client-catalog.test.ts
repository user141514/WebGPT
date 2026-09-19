import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogGroups,
  conversationFromUrl,
  hasBoundConversation,
  initialConversationUrl,
  loadingCatalogGroupId,
  catalogGroupsWithLoading,
  conversationTarget,
  requestedConversationUrl
} from '../src/client/catalog-view.ts';
import {
  defaultExpandedCatalogGroups,
  ensureActiveCatalogGroupExpanded,
  toggleCatalogGroup
} from '../src/client/catalog-tree.ts';

test('keeps every indexed project in the tree even when a project has no conversations', () => {
  const groups = catalogGroups({
    projects: [
      { projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' },
      { projectId: 'g-p-empty', title: 'Empty Project', url: 'https://chatgpt.com/g/g-p-empty' }
    ],
    conversations: [
      { projectId: 'g-p-a', conversationId: 'c1', title: 'G1 control', url: 'https://chatgpt.com/g/g-p-a/c/c1' }
    ]
  });

  assert.deepEqual(groups.map((group) => [group.id, group.title, group.conversations.length]), [
    ['g-p-a', 'Robotics', 1],
    ['g-p-empty', 'Empty Project', 0]
  ]);
});

test('persists fold state separately from canonical conversation identity and expands the active project', () => {
  const groups = catalogGroups({
    projects: [
      { projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' },
      { projectId: 'g-p-b', title: 'Research', url: 'https://chatgpt.com/g/g-p-b' }
    ],
    conversations: [
      { projectId: 'g-p-a', conversationId: 'c1', title: 'G1', url: 'https://chatgpt.com/g/g-p-a/c/c1' },
      { projectId: 'g-p-b', conversationId: 'c2', title: 'Paper', url: 'https://chatgpt.com/g/g-p-b/c/c2' }
    ]
  });

  let expanded = defaultExpandedCatalogGroups(groups, null);
  assert.deepEqual([...expanded], []);

  expanded = toggleCatalogGroup(expanded, 'g-p-a');
  assert.equal(expanded.has('g-p-a'), true);
  assert.equal(expanded.has('g-p-b'), false);

  expanded = ensureActiveCatalogGroupExpanded(
    expanded,
    groups,
    'https://chatgpt.com/g/g-p-b/c/c2'
  );
  assert.equal(expanded.has('g-p-a'), true);
  assert.equal(expanded.has('g-p-b'), true);
});

test('groups standalone chats and project chats using catalog project titles', () => {
  const groups = catalogGroups({
    projects: [
      { projectId: 'g-p-a', title: 'Robotics', url: 'https://chatgpt.com/g/g-p-a' }
    ],
    conversations: [
      { conversationId: 'standalone', title: 'General', url: 'https://chatgpt.com/c/standalone' },
      { projectId: 'g-p-a', conversationId: 'c1', title: 'G1 control', url: 'https://chatgpt.com/g/g-p-a/c/c1' },
      { projectId: 'g-p-missing', conversationId: 'c2', title: 'Orphan', url: 'https://chatgpt.com/g/g-p-missing/c/c2' }
    ]
  });

  assert.deepEqual(groups, [
    {
      id: 'standalone',
      title: 'Chats',
      conversations: [
        { conversationId: 'standalone', title: 'General', url: 'https://chatgpt.com/c/standalone' }
      ]
    },
    {
      id: 'g-p-a',
      title: 'Robotics',
      projectId: 'g-p-a',
      conversations: [
        { projectId: 'g-p-a', conversationId: 'c1', title: 'G1 control', url: 'https://chatgpt.com/g/g-p-a/c/c1' }
      ]
    },
    {
      id: 'g-p-missing',
      title: 'g-p-missing',
      projectId: 'g-p-missing',
      conversations: [
        { projectId: 'g-p-missing', conversationId: 'c2', title: 'Orphan', url: 'https://chatgpt.com/g/g-p-missing/c/c2' }
      ]
    }
  ]);
});

test('constructs a direct conversation target from a pasted ChatGPT URL without catalog discovery', () => {
  assert.deepEqual(
    conversationFromUrl('https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-project/c/c1', 'Bound chat'),
    {
      projectId: 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      conversationId: 'c1',
      title: 'Bound chat',
      url: 'https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/c/c1'
    }
  );
  assert.deepEqual(
    conversationFromUrl('https://chatgpt.com/c/abc'),
    {
      conversationId: 'abc',
      title: 'abc',
      url: 'https://chatgpt.com/c/abc'
    }
  );
  assert.equal(conversationFromUrl('https://chatgpt.com/g/g-p-a'), null);
  assert.equal(conversationFromUrl('https://example.com/c/abc'), null);
});

test('renders a transient sidebar group when an in-flight direct bind is absent from the cached catalog', () => {
  const groups = catalogGroupsWithLoading(
    { projects: [], conversations: [] },
    'https://chatgpt.com/g/g-p-missing/c/c1'
  );
  assert.deepEqual(groups, [{
    id: 'g-p-missing',
    title: 'Binding project…',
    projectId: 'g-p-missing',
    conversations: []
  }]);

  assert.deepEqual(
    catalogGroupsWithLoading(
      { projects: [], conversations: [] },
      'https://chatgpt.com/c/standalone'
    ),
    [{ id: 'standalone', title: 'Chats', conversations: [] }]
  );
});

test('maps an in-flight conversation URL to the sidebar group that owns its loading indicator', () => {
  assert.equal(
    loadingCatalogGroupId('https://chatgpt.com/g/g-p-a/c/c1'),
    'g-p-a'
  );
  assert.equal(
    loadingCatalogGroupId('https://chatgpt.com/c/standalone'),
    'standalone'
  );
  assert.equal(loadingCatalogGroupId('https://chatgpt.com/g/g-p-a'), null);
  assert.equal(loadingCatalogGroupId(null), null);
});

test('treats only canonical ChatGPT conversation URLs as bound conversation targets', () => {
  assert.equal(hasBoundConversation('https://chatgpt.com/c/abc'), true);
  assert.equal(hasBoundConversation('https://chatgpt.com/g/g-p-a/c/c1'), true);
  assert.equal(hasBoundConversation('https://chatgpt.com/g/g-p-a'), false);
  assert.equal(hasBoundConversation(null), false);
  assert.equal(hasBoundConversation(''), false);
});

test('uses canonical conversation URL as both logical conversation identity and provider target', () => {
  assert.deepEqual(conversationTarget({
    projectId: 'g-p-a',
    conversationId: 'c1',
    title: 'G1 control',
    url: 'https://chatgpt.com/g/g-p-a/c/c1'
  }), {
    conversationId: 'https://chatgpt.com/g/g-p-a/c/c1',
    externalUrl: 'https://chatgpt.com/g/g-p-a/c/c1',
    title: 'G1 control'
  });
});

test('fresh client mode does not silently restore the previous bound URL', () => {
  assert.equal(
    initialConversationUrl('http://127.0.0.1:4317/?fresh=1', 'https://chatgpt.com/c/old'),
    null
  );
  assert.equal(
    initialConversationUrl('http://127.0.0.1:4317/', 'https://chatgpt.com/c/old'),
    'https://chatgpt.com/c/old'
  );
  assert.equal(
    initialConversationUrl(
      'http://127.0.0.1:4317/?fresh=1&conversation=https%3A%2F%2Fchatgpt.com%2Fc%2Fexplicit',
      'https://chatgpt.com/c/old'
    ),
    'https://chatgpt.com/c/explicit'
  );
});

test('reads an optional fixed conversation URL from the local client query string', () => {
  assert.equal(
    requestedConversationUrl('http://127.0.0.1:4317/?conversation=https%3A%2F%2Fchatgpt.com%2Fc%2Fabc'),
    'https://chatgpt.com/c/abc'
  );
  assert.equal(requestedConversationUrl('http://127.0.0.1:4317/'), null);
});
