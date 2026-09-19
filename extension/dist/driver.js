import { semanticDocumentToMarkdown } from './content/markdown.js';
import { assistantCount, findPrompt, findSendButton, hasCompletionAction, injectPrompt, isGenerating, latestAssistantDocument, latestAssistantSignature, latestAssistantText, userCount } from './signals.js';
export class ChatGptDriver {
    accepted = false;
    completed = false;
    baselineUsers = 0;
    baselineAssistants = 0;
    lastStatus = null;
    lastText = '';
    lastSignature = '';
    lastDocument = null;
    lastMarkdown = null;
    stableSince = 0;
    prepared = false;
    completionActionSettleMs;
    fallbackSettleMs;
    now;
    surface;
    emit;
    constructor(surface, emit, options = {}) {
        this.surface = surface;
        this.emit = emit;
        this.completionActionSettleMs = options.completionActionSettleMs ?? 5_000;
        this.fallbackSettleMs = options.fallbackSettleMs ?? 45_000;
        this.now = options.now ?? Date.now;
    }
    prepare(text) {
        const prompt = findPrompt(this.surface);
        if (!prompt)
            return false;
        this.baselineUsers = userCount(this.surface);
        this.baselineAssistants = assistantCount(this.surface);
        this.accepted = false;
        this.completed = false;
        this.lastStatus = null;
        this.lastText = '';
        this.lastSignature = '';
        this.lastDocument = null;
        this.lastMarkdown = null;
        this.stableSince = this.now();
        injectPrompt(this.surface, prompt, text);
        this.prepared = true;
        return true;
    }
    submitPrepared() {
        if (!this.prepared)
            return false;
        const send = findSendButton(this.surface);
        if (!send)
            return false;
        send.click();
        this.prepared = false;
        return true;
    }
    submit(text) {
        return this.prepare(text) && this.submitPrepared();
    }
    observe() {
        if (this.completed)
            return;
        const generating = isGenerating(this.surface);
        const currentAssistantCount = assistantCount(this.surface);
        const hasNewAssistant = currentAssistantCount > this.baselineAssistants;
        if (!this.accepted && (userCount(this.surface) > this.baselineUsers
            || hasNewAssistant
            || generating)) {
            this.accepted = true;
            this.emit({ type: 'request.accepted' });
        }
        if (!this.accepted)
            return;
        if (!generating && !hasNewAssistant)
            return;
        const status = generating ? 'generating' : 'complete';
        if (status !== this.lastStatus) {
            this.lastStatus = status;
            this.emit({ type: 'assistant.status', status });
        }
        const text = hasNewAssistant ? latestAssistantText(this.surface) : '';
        const signature = hasNewAssistant ? latestAssistantSignature(this.surface) : '';
        if (signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.lastText = text;
            this.stableSince = this.now();
            this.lastDocument = text ? latestAssistantDocument(this.surface) : null;
            this.lastMarkdown = this.lastDocument ? semanticDocumentToMarkdown(this.lastDocument) : null;
            if (text) {
                this.emit({
                    type: 'assistant.snapshot',
                    text,
                    ...(this.lastDocument ? { document: this.lastDocument } : {}),
                    ...(this.lastMarkdown !== null ? { markdown: this.lastMarkdown } : {})
                });
            }
        }
        const settleMs = hasCompletionAction(this.surface)
            ? this.completionActionSettleMs
            : this.fallbackSettleMs;
        const stable = text.length > 0 && this.now() - this.stableSince >= settleMs;
        if (!generating && text && stable) {
            this.completed = true;
            this.emit({
                type: 'assistant.completed',
                text,
                ...(this.lastDocument ? { document: this.lastDocument } : {}),
                ...(this.lastMarkdown !== null ? { markdown: this.lastMarkdown } : {})
            });
        }
    }
}
