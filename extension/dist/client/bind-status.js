export function bindStatusView(input) {
    if (input.state === 'binding') {
        return {
            tone: 'binding',
            title: 'Binding…',
            detail: input.url?.trim() || 'Looking for the exact already-open ChatGPT tab…'
        };
    }
    if (input.state === 'bound') {
        const parts = [
            Number.isInteger(input.tabId) ? `Exact tab #${input.tabId}` : 'Exact existing tab',
            Number.isInteger(input.messages) ? `${input.messages} messages visible` : null
        ].filter(Boolean);
        return {
            tone: 'bound',
            title: `Bound · ${input.title?.trim() || 'ChatGPT conversation'}`,
            detail: parts.join(' · ')
        };
    }
    if (input.state === 'error') {
        return {
            tone: 'error',
            title: 'Bind failed',
            detail: input.error?.trim() || 'Could not bind this ChatGPT conversation.'
        };
    }
    return {
        tone: 'idle',
        title: 'No conversation bound',
        detail: 'Paste the URL of an already-open ChatGPT conversation.'
    };
}
