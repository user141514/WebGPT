import assert from 'node:assert/strict';

const cdpPort = Number(process.env.CHATGPT_WEB_DRIVER_CDP_PORT ?? 9444);
const clientPrefix = 'http://127.0.0.1:4317/';

async function clientTarget() {
  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((response) => response.json());
  return targets.find((target) => target.type === 'page' && target.url.startsWith(clientPrefix)) ?? null;
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  return {
    async call(method, params = {}) {
      const id = ++sequence;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 5_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(session, expression) {
  const result = await session.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

let target = await clientTarget();
assert.ok(target, `No ${clientPrefix} page found on CDP port ${cdpPort}`);
let session = await connect(target);
await session.call('Page.reload', { ignoreCache: true });
session.close();
await new Promise((resolve) => setTimeout(resolve, 800));

target = await clientTarget();
assert.ok(target, 'Client target disappeared after reload');
session = await connect(target);

await evaluate(session, `
  window.__clientMessages = [];
  if (!window.__captureInstalled) {
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data?.source === 'chatgpt-web-driver.client') {
        window.__clientMessages.push(event.data);
      }
    });
    window.__captureInstalled = true;
  }
  window.postMessage({ source: 'chatgpt-web-driver.extension', type: 'bridge.ready' }, location.origin);
  true;
`);
await new Promise((resolve) => setTimeout(resolve, 50));

await evaluate(session, `
  document.getElementById('composer-input').value = 'semantic smoke';
  document.getElementById('composer-form').requestSubmit();
  true;
`);
await new Promise((resolve) => setTimeout(resolve, 50));

const submit = await evaluate(session, `
  window.__clientMessages.find((message) => message.type === 'provider.submit') ?? null
`);
assert.ok(submit?.clientRequestId, 'Client did not emit provider.submit');

const requestId = 'req-semantic-smoke';
const documentSnapshot = {
  blocks: [
    { type: 'heading', level: 2, content: [{ type: 'text', text: 'Semantic Result' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'strong', content: [{ type: 'text', text: 'Bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'link' }] }
      ]
    },
    { type: 'code', language: 'python', code: 'print(42)' },
    {
      type: 'table',
      headers: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
      rows: [[[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]]]
    },
    { type: 'math', display: true, latex: 'x^2+y^2' }
  ]
};

const messages = [
  {
    source: 'chatgpt-web-driver.extension',
    type: 'submit.result',
    clientRequestId: submit.clientRequestId,
    result: { started: true, requestId }
  },
  {
    source: 'chatgpt-web-driver.extension',
    type: 'provider.event',
    requestId,
    event: { type: 'request.accepted' }
  },
  {
    source: 'chatgpt-web-driver.extension',
    type: 'provider.event',
    requestId,
    event: { type: 'assistant.status', status: 'generating' }
  },
  {
    source: 'chatgpt-web-driver.extension',
    type: 'provider.event',
    requestId,
    event: {
      type: 'assistant.snapshot',
      text: 'semantic result',
      document: documentSnapshot,
      markdown: '## Semantic Result'
    }
  },
  {
    source: 'chatgpt-web-driver.extension',
    type: 'provider.event',
    requestId,
    event: {
      type: 'assistant.completed',
      text: 'semantic result',
      document: documentSnapshot,
      markdown: '## Semantic Result'
    }
  }
];

for (const message of messages) {
  await evaluate(session, `window.postMessage(${JSON.stringify(message)}, location.origin); true;`);
}
await new Promise((resolve) => setTimeout(resolve, 100));

const rendered = await evaluate(session, `
  (() => {
    const body = document.querySelector('.assistant-body');
    return {
      phase: document.getElementById('phase-badge')?.textContent,
      heading: body?.querySelector('h2')?.textContent,
      strong: body?.querySelector('strong')?.textContent,
      href: body?.querySelector('a')?.getAttribute('href'),
      code: body?.querySelector('pre.code-block code')?.textContent,
      table: body?.querySelector('table')?.innerText,
      math: body?.querySelector('pre.math-block')?.textContent
    };
  })()
`);

assert.equal(rendered.phase, 'completed');
assert.equal(rendered.heading, 'Semantic Result');
assert.equal(rendered.strong, 'Bold');
assert.equal(rendered.href, 'https://example.com');
assert.equal(rendered.code, 'print(42)');
assert.match(rendered.table ?? '', /A/);
assert.match(rendered.table ?? '', /2/);
assert.equal(rendered.math, '$$\nx^2+y^2\n$$');

session.close();
console.log('CLIENT_SEMANTIC_SMOKE_OK');
