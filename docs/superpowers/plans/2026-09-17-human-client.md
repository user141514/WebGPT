# Human Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone local frontend that submits prompts through the provider extension and renders normalized ChatGPT events without using the official ChatGPT UI.

**Architecture:** Phase 1 uses a localhost page plus a small extension relay injected into that page. The UI communicates through a narrow postMessage/runtime-message bridge; ChatGPT DOM remains entirely behind the provider content script. This intentionally avoids adding a WebSocket dependency before the end-to-end UI loop is proven; transport can later be replaced by a dedicated local Bridge Core without changing the UI event model.

**Tech Stack:** TypeScript, browser DOM, Node built-in HTTP static server, Chrome MV3 runtime messaging.

**Spec:** `docs/superpowers/specs/2026-09-17-human-client-design.md`

## Global Constraints

- The frontend must not contain ChatGPT selectors or DOM interpretation.
- One request is associated by `requestId` from submit through completion.
- `assistant.snapshot` replaces the current assistant rendering; it is not treated as an append-only token delta.
- No persistence, uploads, tool rendering, or history sync in the first gate.

---

### Task 1: Client state reducer

**Files:**
- Create: `src/client/state.ts`
- Test: `test/client-state.test.ts`

- [ ] Write failing reducer tests for disconnected, submitting, accepted, generating, snapshot replacement, completed, and error states.
- [ ] Verify RED.
- [ ] Implement the minimal pure reducer.
- [ ] Run focused and full tests.

### Task 2: Local page and extension relay

**Files:**
- Create: `src/extension/client-relay.ts`
- Create: `extension/client-relay-loader.js`
- Modify: `extension/manifest.json`
- Create: `src/client/main.ts`
- Create: `client/index.html`
- Create: `client/styles.css`
- Test: `test/client-relay.test.ts`

- [ ] Write failing tests for page->extension submit envelopes and extension->page event envelopes.
- [ ] Verify RED.
- [ ] Implement the relay and UI event adapter.
- [ ] Run focused and full tests.

### Task 3: Local static server

**Files:**
- Create: `src/client/server.ts`
- Modify: `package.json`
- Test: `test/client-server.test.ts`

- [ ] Write failing tests for serving `/`, static assets, and 404 behavior without path traversal.
- [ ] Verify RED.
- [ ] Implement using Node `http`, `fs`, and `path` only.
- [ ] Add `client:serve` and build scripts.
- [ ] Run tests, typecheck, build.

### Task 4: Client smoke gate

**Files:**
- Modify: `docs/LIVE_SMOKE.md`

- [ ] Start the local client server.
- [ ] Open the client page with the extension loaded.
- [ ] Submit `Reply exactly CLIENT_SMOKE_OK` without touching ChatGPT UI.
- [ ] Verify accepted/generating or snapshot state and final `CLIENT_SMOKE_OK`.
- [ ] Record any missing mapping as a concrete next feature; do not expand scope during the gate.
