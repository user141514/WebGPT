export function isNearConversationBottom(metrics, threshold = 48) {
    const distance = Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
    return distance <= Math.max(0, threshold);
}
export function shouldFollowConversationOutput(decision) {
    return decision.contentChanged && (decision.force === true || decision.wasNearBottom);
}
function historicalTurn(index) {
    return {
        clientRequestId: `history-${index}`,
        requestId: null,
        userText: '',
        assistantText: '',
        assistantDocument: null,
        assistantMarkdown: null,
        phase: 'completed',
        error: null
    };
}
export function snapshotToTranscriptTurns(snapshot) {
    const result = [];
    for (const message of snapshot.turns) {
        if (message.role === 'user') {
            const turn = historicalTurn(result.length);
            turn.userText = message.text;
            result.push(turn);
            continue;
        }
        const last = result.at(-1);
        const target = last && !last.assistantText && !last.assistantDocument && !last.error
            ? last
            : (() => {
                const turn = historicalTurn(result.length);
                result.push(turn);
                return turn;
            })();
        target.assistantText = message.text;
        target.assistantDocument = message.document ?? null;
        target.assistantMarkdown = message.markdown ?? null;
    }
    return result;
}
