# ChatGPT Web Extension Design

## Goal

Turn the already-tested ChatGptDriver core into a real Chrome MV3 extension that can control an existing signed-in ChatGPT tab without depending on visual clickability of the official UI.

## Invariants

1. Preserve Watchdog/Sidecar semantics before redesigning them.
2. A click is not proof of submission; `request.accepted` requires observed conversation-state change.
3. Assistant completion is scoped to the latest assistant turn.
4. Prompt injection uses the native textarea/input setter plus bubbling `InputEvent`; contenteditable keeps the browser insertion path and fallback.
5. Completion uses the proven settle model: 5 s when the latest turn exposes a completion action; 45 s fallback otherwise.
6. Do not add popup suppression as a dependency. Overlays may remain visible; the control path must still work if the underlying composer/send DOM remains operable programmatically.
7. No cookie/auth-token access and no network rewriting.

## Components

### BrowserDomSurface
Real browser implementation of `DomSurface` backed by `document`. It owns selector queries, native value setters, browser `InputEvent`, and contenteditable insertion.

### Extension Content Script
Owns one `ChatGptDriver`, receives extension messages, submits prompts, polls/observes the DOM, and emits normalized driver events. It does not implement Watchdog supervisor/recovery semantics.

### Extension Service Worker
Minimal message relay and tab targeting for the MVP. It discovers an existing `https://chatgpt.com/*` tab, forwards submit requests to the content script, and forwards driver events to extension clients.

### Extension Debug Page
A minimal extension-local UI used only for live smoke: prompt input, send button, event log, and latest assistant snapshot. This proves the real page path before the standalone frontend exists.

## Event Contract

Existing events remain the source of truth for phase 1:
- `request.accepted`
- `assistant.status`
- `assistant.snapshot`
- `assistant.completed`

Every forwarded event adds a local `requestId` so a client can associate one request with its stream.

## Failure Model

Fail open. If the extension cannot find the composer, send button, or assistant turn, it reports an error and leaves ChatGPT untouched. It must not attempt network interception or hide arbitrary dialogs.

## MVP Acceptance Gate

On a real signed-in ChatGPT tab, from the extension debug page:
1. Submit `Reply exactly DRIVER_SMOKE_OK`.
2. Observe `request.accepted`.
3. Observe at least one assistant status or snapshot event.
4. Observe `assistant.completed` with `DRIVER_SMOKE_OK`.
5. The test remains valid even if an unrelated overlay is visually present, provided ChatGPT's underlying DOM is still present.

## Out of Scope

- Multi-provider support
- Tool-call rendering
- Markdown semantic AST
- Conversation history synchronization
- Network protocol interception
- Watchdog supervisor/recovery protocol
