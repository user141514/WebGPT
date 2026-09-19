import type { ContentController, SubmitResult } from './content-controller.js';
export interface DriverSubmitMessage {
    type?: unknown;
    requestId?: unknown;
    text?: unknown;
}
export type ReadySubmitController = Pick<ContentController, 'submitWhenReady'>;
export declare function submitDriverMessage(controller: ReadySubmitController, message: DriverSubmitMessage): Promise<SubmitResult>;
