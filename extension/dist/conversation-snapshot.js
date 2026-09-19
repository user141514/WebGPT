import { semanticDocumentToMarkdown } from './content/markdown.js';
export function conversationSnapshotFromSurface(surface, url, title) {
    const turns = [];
    for (const element of surface.queryAll('[data-message-author-role="user"],[data-message-author-role="assistant"]')) {
        const role = element.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant')
            continue;
        const text = element.textContent?.trim() ?? '';
        if (!text)
            continue;
        if (role === 'user') {
            turns.push({ role: 'user', text });
            continue;
        }
        const document = element.semanticDocument?.() ?? null;
        turns.push({
            role: 'assistant',
            text,
            ...(document?.blocks.length
                ? {
                    document,
                    markdown: semanticDocumentToMarkdown(document)
                }
                : {})
        });
    }
    return { url, title, turns };
}
