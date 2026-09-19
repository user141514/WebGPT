export async function submitDriverMessage(controller, message) {
    if (typeof message.requestId !== 'string' || !message.requestId) {
        return { started: false, error: 'requestId is required' };
    }
    if (typeof message.text !== 'string' || !message.text.trim()) {
        return { started: false, error: 'Prompt text is required' };
    }
    return controller.submitWhenReady(message.requestId, message.text);
}
