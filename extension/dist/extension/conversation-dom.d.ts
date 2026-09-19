export interface ConversationMessageProbe {
    role: string;
    messageId: string | null;
    turnTestId: string | null;
}
export interface ConversationScrollProbe {
    tag: string;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    overflowY: string;
}
export interface ConversationDomProbe {
    messageCount: number;
    messages: ConversationMessageProbe[];
    scroll: ConversationScrollProbe | null;
}
export declare function stableMessageId(element: Element): string | null;
export declare function turnTestId(element: Element): string | null;
export declare function nearestConversationScrollContainer(element: Element): Element | null;
export declare function conversationDomProbe(document: Document): ConversationDomProbe;
