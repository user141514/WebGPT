import { readFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CLIENT_PORT = 4317;

export interface ClientAsset {
  file: string;
  contentType: string;
}

export interface ClientServerOptions {
  root?: string;
}

export function resolveClientAsset(requestUrl: string, root = process.cwd()): ClientAsset | null {
  const pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    return {
      file: join(root, 'client', 'index.html'),
      contentType: 'text/html; charset=utf-8'
    };
  }
  if (pathname === '/styles.css') {
    return {
      file: join(root, 'client', 'styles.css'),
      contentType: 'text/css; charset=utf-8'
    };
  }
  if (pathname === '/app.js') {
    return {
      file: join(root, 'extension', 'dist', 'client', 'main.js'),
      contentType: 'text/javascript; charset=utf-8'
    };
  }
  if (pathname === '/catalog.js') {
    return {
      file: join(root, 'extension', 'dist', 'catalog.js'),
      contentType: 'text/javascript; charset=utf-8'
    };
  }
  if (pathname === '/__extension-control.html') {
    return {
      file: join(root, 'client', 'extension-control.html'),
      contentType: 'text/html; charset=utf-8'
    };
  }
  const clientModules = new Set([
    '/bind-status.js',
    '/catalog-view.js',
    '/catalog-tree.js',
    '/conversation-view.js',
    '/conversation-id.js',
    '/heartbeat.js',
    '/protocol.js',
    '/state.js',
    '/theme.js',
    '/render-content.js',
    '/selection-epoch.js',
    '/smoke.js'
  ]);
  if (clientModules.has(pathname)) {
    return {
      file: join(root, 'extension', 'dist', 'client', pathname.slice(1)),
      contentType: 'text/javascript; charset=utf-8'
    };
  }
  return null;
}

export function createClientServer(options: ClientServerOptions = {}): Server {
  const root = options.root ?? process.cwd();
  let liveState = {
    phase: 'unknown',
    requestId: null as string | null,
    assistantText: '',
    error: null as string | null,
    conversationUrl: null as string | null,
    historyMessages: 0,
    historyHydrated: false
  };
  const extensionControl = new Map<string, Record<string, unknown>>();
  const driverCommands = new Map<string, { payload: Record<string, unknown>; leasedAt: number | null }>();
  const driverResults = new Map<string, unknown>();
  const driverRelayClients = new Set<ServerResponse>();

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/__driver-control/status' && request.method === 'GET') {
      const body = Buffer.from(JSON.stringify({
        relayConnected: driverRelayClients.size > 0,
        relayConnections: driverRelayClients.size,
        pending: driverCommands.size
      }));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store'
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/__driver-control/events' && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      response.write('event: ready\ndata: {}\n\n');
      driverRelayClients.add(response);
      response.on('close', () => driverRelayClients.delete(response));
      return;
    }

    if (url.pathname === '/__driver-control/heartbeat' && request.method === 'POST') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === '/__driver-control/command' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
        if (!requestId) throw new Error('requestId is required');
        driverCommands.set(requestId, { payload, leasedAt: null });
        driverResults.delete(requestId);
        response.writeHead(202);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
      return;
    }

    if (url.pathname === '/__driver-control/next' && request.method === 'GET') {
      const now = Date.now();
      const next = [...driverCommands.entries()].find(([, command]) => (
        command.leasedAt === null || now - command.leasedAt > 5_000
      ));
      if (!next) {
        response.writeHead(204);
        response.end();
        return;
      }
      const [requestId, command] = next;
      command.leasedAt = now;
      const body = Buffer.from(JSON.stringify(command.payload));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store'
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/__driver-control/result' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
        if (!requestId) throw new Error('requestId is required');
        driverResults.set(requestId, payload.result);
        driverCommands.delete(requestId);
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
      return;
    }

    if (url.pathname === '/__driver-control/result' && request.method === 'GET') {
      const requestId = url.searchParams.get('requestId')?.trim() ?? '';
      const hasResult = driverResults.has(requestId);
      const body = Buffer.from(JSON.stringify(hasResult
        ? { state: 'ready', requestId, result: driverResults.get(requestId) }
        : { state: 'waiting', requestId }));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store'
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/__extension-control' && request.method === 'GET') {
      const requestId = url.searchParams.get('requestId')?.trim() ?? '';
      if (!requestId) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'requestId is required' }));
        return;
      }
      const payload = extensionControl.get(requestId) ?? { state: 'waiting', requestId };
      const body = Buffer.from(JSON.stringify(payload));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store'
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/__extension-control' && request.method === 'POST') {
      const requestId = url.searchParams.get('requestId')?.trim() ?? '';
      if (!requestId) {
        response.writeHead(400);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > 64 * 1024) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(buffer);
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        extensionControl.set(requestId, { ...payload, requestId });
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
      return;
    }

    if (url.pathname === '/__live' && request.method === 'GET') {
      const body = Buffer.from(JSON.stringify(liveState));
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store'
      });
      response.end(body);
      return;
    }

    if (url.pathname === '/__live' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > 64 * 1024) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(buffer);
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        liveState = {
          phase: typeof payload.phase === 'string' ? payload.phase : 'unknown',
          requestId: typeof payload.requestId === 'string' ? payload.requestId : null,
          assistantText: typeof payload.assistantText === 'string' ? payload.assistantText : '',
          error: typeof payload.error === 'string' ? payload.error : null,
          conversationUrl: typeof payload.conversationUrl === 'string' ? payload.conversationUrl : null,
          historyMessages: Number.isInteger(payload.historyMessages) && (payload.historyMessages as number) >= 0
            ? payload.historyMessages as number
            : 0,
          historyHydrated: payload.historyHydrated === true
        };
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }

    const asset = resolveClientAsset(url.pathname, root);
    if (!asset) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    try {
      const body = await readFile(asset.file);
      response.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      response.writeHead(code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
      response.end(code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
    }
  });
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const server = createClientServer();
  server.listen(CLIENT_PORT, '127.0.0.1', () => {
    console.log(`ChatGPT Web Driver client: http://127.0.0.1:${CLIENT_PORT}`);
  });
}
