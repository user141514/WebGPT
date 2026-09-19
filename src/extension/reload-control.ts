export const PENDING_RELOAD_KEY = 'chatgpt-web-driver.extension.reload.pending';
export const LAST_RELOAD_KEY = 'chatgpt-web-driver.extension.reload.last';
export const CONTROL_PORT_MIN = 4318;
export const CONTROL_PORT_MAX = 4327;

export interface ExtensionBuildInfo {
  buildId: string;
  builtAt: string;
  version: string;
}

export interface PendingExtensionReload {
  requestId: string;
  expectedBuildId: string;
  beforeBuildId: string;
  beforeInstanceId: string;
  requestedAt: number;
  controlTabId?: number;
  controlOrigin?: string;
}

export interface ExtensionReloadReceipt {
  state: 'verified' | 'failed';
  requestId: string;
  expectedBuildId: string;
  beforeBuildId: string;
  afterBuildId: string;
  beforeInstanceId: string;
  afterInstanceId: string;
  requestedAt: number;
  completedAt: number;
  error?: string;
}

export function isExtensionControlPageUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const localHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    const port = Number(url.port);
    return url.protocol === 'http:'
      && localHost
      && Number.isInteger(port)
      && port >= CONTROL_PORT_MIN
      && port <= CONTROL_PORT_MAX
      && url.pathname === '/__extension-control.html';
  } catch {
    return false;
  }
}

export function verifyReloadReceipt(
  pending: PendingExtensionReload,
  afterBuildId: string,
  afterInstanceId: string,
  completedAt: number
): ExtensionReloadReceipt {
  const base = {
    requestId: pending.requestId,
    expectedBuildId: pending.expectedBuildId,
    beforeBuildId: pending.beforeBuildId,
    afterBuildId,
    beforeInstanceId: pending.beforeInstanceId,
    afterInstanceId,
    requestedAt: pending.requestedAt,
    completedAt
  };

  if (afterBuildId !== pending.expectedBuildId) {
    return {
      state: 'failed',
      ...base,
      error: `Reloaded extension build mismatch: expected ${pending.expectedBuildId}, got ${afterBuildId}`
    };
  }
  if (afterInstanceId === pending.beforeInstanceId) {
    return {
      state: 'failed',
      ...base,
      error: 'Extension instance did not change after reload'
    };
  }
  return { state: 'verified', ...base };
}
