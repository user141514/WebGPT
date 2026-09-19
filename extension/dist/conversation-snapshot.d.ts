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
export declare function conversationSnapshotFromSurface(surface: DomSurface, url: string, title: string): ConversationSnapshot;
