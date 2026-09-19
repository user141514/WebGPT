import type { ContentController, SubmitResult } from './content-controller.js';

export interface DriverSubmitMessage {
  type?: unknown;
  requestId?: unknown;
  text?: unknown;
}

export type ReadySubmitController = Pick<ContentController, 'submitWhenReady'>;

export async function submitDriverMessage(
  controller: ReadySubmitController,
  message: DriverSubmitMessage
): Promise<SubmitResult> {
  if (typeof message.requestId !== 'string' || !message.requestId) {
    return { started: false, error: 'requestId is required' };
  }
  if (typeof message.text !== 'string' || !message.text.trim()) {
    return { started: false, error: 'Prompt text is required' };
  }
  return controller.submitWhenReady(message.requestId, message.text);
}
