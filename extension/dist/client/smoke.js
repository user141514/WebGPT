export const CLIENT_SMOKE_TOKEN = 'CLIENT_SMOKE_OK';
export const CLIENT_SMOKE_PROMPT = `Reply exactly ${CLIENT_SMOKE_TOKEN}`;
export function smokePromptFromUrl(url) {
    const parsed = new URL(url);
    return parsed.searchParams.get('smoke') === CLIENT_SMOKE_TOKEN
        ? CLIENT_SMOKE_PROMPT
        : null;
}
export function liveStatusPayload(state, diagnostics = {
    conversationUrl: null,
    historyMessages: 0,
    historyHydrated: false
}) {
    return {
        phase: state.phase,
        requestId: state.requestId,
        assistantText: state.assistantText,
        error: state.error,
        ...diagnostics
    };
}
