export declare const PENDING_RELOAD_KEY = "chatgpt-web-driver.extension.reload.pending";
export declare const LAST_RELOAD_KEY = "chatgpt-web-driver.extension.reload.last";
export declare const CONTROL_PORT_MIN = 4318;
export declare const CONTROL_PORT_MAX = 4327;
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
export declare function isExtensionControlPageUrl(value: string | undefined | null): boolean;
export declare function verifyReloadReceipt(pending: PendingExtensionReload, afterBuildId: string, afterInstanceId: string, completedAt: number): ExtensionReloadReceipt;
