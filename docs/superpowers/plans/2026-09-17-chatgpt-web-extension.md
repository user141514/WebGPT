# ChatGPT Web Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `ChatGptDriver` into a loadable Chrome MV3 extension that can submit to and observe a real ChatGPT tab.

**Architecture:** Keep all ChatGPT DOM knowledge inside a real `BrowserDomSurface` and content-script runtime. The service worker only locates a ChatGPT tab, forwards submit commands, and relays normalized events. A tiny extension debug page proves the end-to-end loop before the standalone client is built.

**Tech Stack:** TypeScript 5.9, Chrome MV3 APIs, Node built-in test runner through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-17-chatgpt-web-extension-design.md`

## Global Constraints

- Preserve Watchdog/Sidecar behavior before redesigning it.
- No network interception, cookie access, or popup suppression dependency.
- Submission acceptance must be observed, not assumed from click success.
- Latest-turn completion scope and 5 s / 45 s settle semantics remain intact.
- Production behavior changes are test-first.

---

### Task 1: Real browser DOM adapter

**Files:**
- Create: `src/browser-dom.ts`
- Modify: `src/index.ts`
- Test: `test/browser-dom.test.ts`

**Interfaces:**
- Consumes: `DomSurface`, `DomElement` from `src/dom.ts`.
- Produces: `BrowserDomSurface`, `BrowserDomElement`.

- [ ] Write a failing test proving native setter dispatch, contenteditable insertion fallback, nested latest-turn queries, and bubbling input events.
- [ ] Run `npm test -- test/browser-dom.test.ts` and verify RED.
- [ ] Implement the minimal browser wrappers.
- [ ] Run focused test and full `npm test`.

### Task 2: Content-script controller

**Files:**
- Create: `src/extension/content-controller.ts`
- Create: `src/extension/content-script.ts`
- Test: `test/content-controller.test.ts`

**Interfaces:**
- Produces: `createContentController(surface, emit, scheduling)` with one active request and `submit(requestId, text)`.

- [ ] Write failing tests for request-id association, poll lifecycle, busy rejection, completion shutdown, and adapter failure.
- [ ] Run focused test and verify RED.
- [ ] Implement controller over `ChatGptDriver`.
- [ ] Wire the real browser surface and Chrome runtime listener.
- [ ] Run focused and full tests.

### Task 3: Service-worker relay and extension shell

**Files:**
- Create: `src/extension/service-worker.ts`
- Create: `src/extension/debug.ts`
- Create: `extension/manifest.json`
- Create: `extension/content-script-loader.js`
- Create: `extension/debug.html`
- Create: `extension/debug.css`
- Modify: `package.json`
- Test: `test/service-router.test.ts`

**Interfaces:**
- Client submit message: `{type:'provider.submit', text:string}`.
- Content submit message: `{type:'driver.submit', requestId:string, text:string}`.
- Event envelope: `{type:'provider.event', requestId:string, event:DriverEvent}`.

- [ ] Write failing pure routing tests for ChatGPT tab selection and provider event envelopes.
- [ ] Verify RED.
- [ ] Implement pure router helpers and Chrome service-worker adapter.
- [ ] Add MV3 manifest and dynamic ESM content-script loader.
- [ ] Add debug page.
- [ ] Add `build:extension` / `check` scripts using `tsc` only.
- [ ] Run tests, typecheck, build.

### Task 4: Live gate preparation

**Files:**
- Create: `docs/LIVE_SMOKE.md`

- [ ] Document load-unpacked path and exact `DRIVER_SMOKE_OK` gate.
- [ ] Verify extension output tree exists after build.
- [ ] If a signed-in Chrome instance is programmatically available, execute the live gate; otherwise stop at the explicit manual-load boundary without inventing success.
