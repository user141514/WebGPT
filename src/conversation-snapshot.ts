import { semanticDocumentToMarkdown } from './content/markdown.js';
import type { SemanticDocument } from './content/model.js';
import type { DomSurface } from './dom.js';

export interface UserConversationTurn {
  role: 'user';
  text: string;
}

export interface AssistantConversationTurn {
  role: 'assistant';
  text: string;
  document?: SemanticDocument;
  markdown?: string;
}

export type ConversationTurn = UserConversationTurn | AssistantConversationTurn;

export interface ConversationSnapshot {
  url: string;
  title: string;
  turns: ConversationTurn[];
}

export function conversationSnapshotFromSurface(
  surface: DomSurface,
  url: string,
  title: string
): ConversationSnapshot {
  const turns: ConversationTurn[] = [];

  for (const element of surface.queryAll('[data-message-author-role="user"],[data-message-author-role="assistant"]')) {
    const role = element.getAttribute('data-message-author-role');
    if (role !== 'user' && role !== 'assistant') continue;

    const text = element.textContent?.trim() ?? '';
    if (!text) continue;

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
