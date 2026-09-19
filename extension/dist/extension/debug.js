function required(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing debug element: ${selector}`);
    return element;
}
const form = required('#driver-form');
const prompt = required('#driver-prompt');
const status = required('#driver-status');
const response = required('#driver-response');
const log = required('#driver-log');
let activeRequestId = null;
function appendLog(value) {
    const line = document.createElement('div');
    line.textContent = JSON.stringify(value);
    log.append(line);
    log.scrollTop = log.scrollHeight;
}
form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text)
        return;
    status.textContent = 'submitting';
    response.textContent = '';
    void chrome.runtime.sendMessage({ type: 'provider.submit', text })
        .then((result) => {
        appendLog({ type: 'submit.result', ...result });
        if (result?.started === true && typeof result.requestId === 'string') {
            activeRequestId = result.requestId;
            status.textContent = 'submitted';
            return;
        }
        status.textContent = result?.error || 'submit failed';
    })
        .catch((error) => {
        status.textContent = error instanceof Error ? error.message : String(error);
    });
});
chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'provider.event')
        return;
    appendLog(message);
    if (!activeRequestId || message.requestId !== activeRequestId)
        return;
    const event = message.event;
    if (event?.type === 'request.accepted') {
        status.textContent = 'accepted';
    }
    else if (event?.type === 'assistant.status') {
        status.textContent = event.status;
    }
    else if (event?.type === 'assistant.snapshot') {
        response.textContent = event.text;
    }
    else if (event?.type === 'assistant.completed') {
        status.textContent = 'completed';
        response.textContent = event.text;
    }
    else if (event?.type === 'provider.error') {
        status.textContent = `error: ${event.message}`;
    }
});
export {};
