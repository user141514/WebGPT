declare const chrome: any;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing debug element: ${selector}`);
  return element;
}

const form = required<HTMLFormElement>('#driver-form');
const prompt = required<HTMLTextAreaElement>('#driver-prompt');
const status = required<HTMLElement>('#driver-status');
const response = required<HTMLElement>('#driver-response');
const log = required<HTMLElement>('#driver-log');

let activeRequestId: string | null = null;

function appendLog(value: unknown): void {
  const line = document.createElement('div');
  line.textContent = JSON.stringify(value);
  log.append(line);
  log.scrollTop = log.scrollHeight;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text) return;

  status.textContent = 'submitting';
  response.textContent = '';
  void chrome.runtime.sendMessage({ type: 'provider.submit', text })
    .then((result: any) => {
      appendLog({ type: 'submit.result', ...result });
      if (result?.started === true && typeof result.requestId === 'string') {
        activeRequestId = result.requestId;
        status.textContent = 'submitted';
        return;
      }
      status.textContent = result?.error || 'submit failed';
    })
    .catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error);
    });
});

chrome.runtime.onMessage.addListener((message: any) => {
  if (message?.type !== 'provider.event') return;
  appendLog(message);
  if (!activeRequestId || message.requestId !== activeRequestId) return;

  const event = message.event;
  if (event?.type === 'request.accepted') {
    status.textContent = 'accepted';
  } else if (event?.type === 'assistant.status') {
    status.textContent = event.status;
  } else if (event?.type === 'assistant.snapshot') {
    response.textContent = event.text;
  } else if (event?.type === 'assistant.completed') {
    status.textContent = 'completed';
    response.textContent = event.text;
  } else if (event?.type === 'provider.error') {
    status.textContent = `error: ${event.message}`;
  }
});
