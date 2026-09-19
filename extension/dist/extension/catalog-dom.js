import { catalogFromCandidates, mergeCatalogs, parseChatGptRoute } from '../catalog.js';
function normalizedElementText(value) {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}
function semanticAnchorText(anchor) {
    const raw = normalizedElementText(anchor.textContent);
    if (!raw)
        return '';
    const prefixes = [...anchor.querySelectorAll('span,div')]
        .map((element) => normalizedElementText(element.textContent))
        .filter((text) => Boolean(text && text.length < raw.length && raw.startsWith(text)))
        .sort((a, b) => b.length - a.length);
    return prefixes[0] ?? raw;
}
function labelFor(anchor) {
    const href = anchor.getAttribute('href') ?? '';
    return {
        href,
        text: semanticAnchorText(anchor) || undefined,
        ariaLabel: anchor.getAttribute('aria-label') ?? undefined,
        title: anchor.getAttribute('title') ?? undefined
    };
}
function normalizedControlText(value) {
    return normalizedElementText(value);
}
function projectCandidateTitle(element) {
    if (element.getAttribute('role') !== 'button')
        return '';
    if (element.getAttribute('href'))
        return '';
    if (element.getAttribute('aria-label'))
        return '';
    return normalizedControlText(element.textContent);
}
function controlLabel(element) {
    return normalizedControlText(element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.textContent);
}
const PROJECT_SHOW_MORE_LABELS = new Set(['显示更多', 'show more']);
function projectIdFromPageUrl(baseUrl) {
    const route = parseChatGptRoute(baseUrl);
    if (route?.kind === 'project')
        return route.projectId;
    if (route?.kind === 'conversation')
        return route.projectId ?? null;
    return null;
}
function nearestConversationGroupProjectIds(control, baseUrl) {
    let current = control.parentElement;
    for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
        const projectIds = new Set();
        let conversations = 0;
        for (const anchor of [...current.querySelectorAll('a[href]')]) {
            const route = parseChatGptRoute(anchor.getAttribute('href') ?? '', baseUrl);
            if (route?.kind !== 'conversation')
                continue;
            conversations += 1;
            projectIds.add(route.projectId ?? '');
        }
        if (conversations > 0)
            return projectIds;
    }
    return null;
}
function catalogControlIsEligible(control) {
    let current = control;
    while (current) {
        if (current.getAttribute('aria-hidden') === 'true')
            return false;
        if (current.getAttribute('hidden') !== null)
            return false;
        current = current.parentElement;
    }
    if (control.getAttribute('aria-disabled') === 'true')
        return false;
    if (control.getAttribute('disabled') !== null)
        return false;
    return true;
}
function projectShowMoreControls(document, baseUrl) {
    const projectId = projectIdFromPageUrl(baseUrl);
    if (!projectId)
        return [];
    return [...document.querySelectorAll('button,[role="button"]')].filter((control) => {
        if (!catalogControlIsEligible(control))
            return false;
        const label = controlLabel(control).toLocaleLowerCase();
        if (!PROJECT_SHOW_MORE_LABELS.has(label))
            return false;
        const groupProjectIds = nearestConversationGroupProjectIds(control, baseUrl);
        return groupProjectIds?.size === 1 && groupProjectIds.has(projectId);
    });
}
function bestNamedAction(controls, element, title) {
    const matches = controls
        .filter((control) => control !== element)
        .map((control) => ({ control, label: controlLabel(control) }))
        .filter(({ label }) => Boolean(label && label.includes(title)))
        .sort((a, b) => {
        const aExtra = Math.max(0, a.label.length - title.length);
        const bExtra = Math.max(0, b.label.length - title.length);
        return aExtra - bExtra || a.label.length - b.label.length;
    });
    return matches[0]?.control ?? null;
}
function namedProjectAction(element, title) {
    let row = element.parentElement;
    for (let depth = 0; row && depth < 12; depth += 1, row = row.parentElement) {
        const controls = [...row.querySelectorAll('button,[role="button"]')];
        if (controls.length > 32)
            continue;
        const match = bestNamedAction(controls, element, title);
        if (match)
            return match;
    }
    const document = element.ownerDocument;
    if (!document)
        return null;
    return bestNamedAction([...document.querySelectorAll('button[aria-label],button[title]')], element, title);
}
function lowestCommonAncestor(first, second) {
    const ancestors = new Set();
    let current = first;
    while (current) {
        ancestors.add(current);
        current = current.parentElement;
    }
    current = second;
    while (current) {
        if (ancestors.has(current))
            return current;
        current = current.parentElement;
    }
    return null;
}
function projectOpenAction(element, title) {
    const named = namedProjectAction(element, title);
    if (!named)
        return null;
    const row = lowestCommonAncestor(element, named);
    if (!row)
        return null;
    const controls = [...row.querySelectorAll('button,[role="button"]')];
    return controls.find((control) => {
        if (control === element || control === named)
            return false;
        const label = controlLabel(control);
        return Boolean(label && !label.includes(title));
    }) ?? null;
}
function hasNamedSiblingAction(element, title) {
    return namedProjectAction(element, title) !== null;
}
export function projectCandidatesFromDocument(document) {
    const candidates = [];
    for (const element of [...document.querySelectorAll('[role="button"]')]) {
        const title = projectCandidateTitle(element);
        if (!title || title.length > 160)
            continue;
        if (!hasNamedSiblingAction(element, title))
            continue;
        const action = projectOpenAction(element, title);
        candidates.push({
            index: candidates.length,
            title,
            ...(action ? { actionLabel: controlLabel(action) } : {})
        });
    }
    return candidates;
}
export function activateProjectCandidate(document, candidate) {
    const elements = [...document.querySelectorAll('[role="button"]')]
        .filter((element) => {
        const title = projectCandidateTitle(element);
        return Boolean(title && title.length <= 160 && hasNamedSiblingAction(element, title));
    });
    const indexed = elements[candidate.index];
    const target = indexed && projectCandidateTitle(indexed) === candidate.title
        ? indexed
        : elements.find((element) => projectCandidateTitle(element) === candidate.title);
    if (!target)
        return false;
    const action = projectOpenAction(target, candidate.title);
    if (!action)
        return false;
    action.click();
    return true;
}
function catalogAnchors(document, baseUrl) {
    return [...document.querySelectorAll('a[href]')]
        .filter((anchor) => parseChatGptRoute(anchor.getAttribute('href') ?? '', baseUrl) !== null);
}
export function catalogProbeFromDocument(document, baseUrl, sampleLimit = 40) {
    const anchors = [...document.querySelectorAll('a[href]')];
    const catalog = anchors.filter((anchor) => parseChatGptRoute(anchor.getAttribute('href') ?? '', baseUrl) !== null);
    const interactives = [...document.querySelectorAll('button,[role="button"],[role="link"]')];
    let projects = 0;
    let conversations = 0;
    for (const anchor of catalog) {
        const route = parseChatGptRoute(anchor.getAttribute('href') ?? '', baseUrl);
        if (route?.kind === 'project')
            projects += 1;
        if (route?.kind === 'conversation')
            conversations += 1;
    }
    return {
        pageUrl: baseUrl,
        documentTitle: document.title,
        totalAnchors: anchors.length,
        catalogAnchors: catalog.length,
        projects,
        conversations,
        projectCandidates: projectCandidatesFromDocument(document),
        samples: anchors.slice(0, sampleLimit).map(labelFor),
        interactiveSamples: interactives.slice(0, Math.max(sampleLimit, 80)).map((element) => ({
            tag: element.tagName.toLowerCase(),
            ...(element.textContent?.trim() ? { text: element.textContent.trim().slice(0, 160) } : {}),
            ...(element.getAttribute('aria-label') ? { ariaLabel: element.getAttribute('aria-label') } : {}),
            ...(element.getAttribute('title') ? { title: element.getAttribute('title') } : {}),
            ...(element.getAttribute('role') ? { role: element.getAttribute('role') } : {}),
            ...(element.getAttribute('data-testid') ? { dataTestId: element.getAttribute('data-testid') } : {}),
            ...(element.getAttribute('href') ? { href: element.getAttribute('href') } : {})
        }))
    };
}
export function catalogSnapshotFromDocument(document, baseUrl) {
    const candidates = catalogAnchors(document, baseUrl).map(labelFor);
    return catalogFromCandidates({
        baseUrl,
        documentTitle: document.title,
        candidates
    });
}
function defaultOverflowY(element) {
    const view = element.ownerDocument?.defaultView;
    return view?.getComputedStyle?.(element).overflowY ?? '';
}
function isScrollable(element, getOverflowY) {
    const target = element;
    const overflowY = getOverflowY(element).toLowerCase();
    return target.scrollHeight > target.clientHeight + 4 && /(auto|scroll|overlay)/.test(overflowY);
}
function nearestScrollableAncestor(anchor, getOverflowY) {
    let current = anchor.parentElement;
    while (current) {
        if (isScrollable(current, getOverflowY))
            return current;
        current = current.parentElement;
    }
    return null;
}
function catalogScrollContainers(document, baseUrl, getOverflowY) {
    const counts = new Map();
    for (const anchor of catalogAnchors(document, baseUrl)) {
        const container = nearestScrollableAncestor(anchor, getOverflowY);
        if (!container)
            continue;
        counts.set(container, (counts.get(container) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([element]) => element);
}
function setScrollTop(element, top) {
    const target = element;
    if (typeof target.scrollTo === 'function') {
        target.scrollTo({ top });
    }
    else {
        target.scrollTop = top;
    }
}
export async function scanCatalogDocument(document, baseUrl, options = {}) {
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const getOverflowY = options.getOverflowY ?? defaultOverflowY;
    const maxSteps = options.maxSteps ?? 160;
    const maxExpandSteps = options.maxExpandSteps ?? 80;
    const settleMs = options.settleMs ?? 80;
    let catalog = catalogSnapshotFromDocument(document, baseUrl);
    const pageProjectId = projectIdFromPageUrl(baseUrl);
    let stagnantExpansionRounds = 0;
    for (let step = 0; pageProjectId && step < maxExpandSteps; step += 1) {
        const control = projectShowMoreControls(document, baseUrl)[0];
        if (!control)
            break;
        const beforeCount = catalog.conversations
            .filter((conversation) => conversation.projectId === pageProjectId).length;
        control.click();
        let afterCount = beforeCount;
        for (let settleRound = 0; settleRound < 4 && afterCount <= beforeCount; settleRound += 1) {
            await sleep(settleMs);
            catalog = mergeCatalogs(catalog, catalogSnapshotFromDocument(document, baseUrl));
            afterCount = catalog.conversations
                .filter((conversation) => conversation.projectId === pageProjectId).length;
        }
        if (afterCount > beforeCount)
            stagnantExpansionRounds = 0;
        else
            stagnantExpansionRounds += 1;
        if (stagnantExpansionRounds >= 2)
            break;
    }
    const containers = catalogScrollContainers(document, baseUrl, getOverflowY);
    for (const container of containers) {
        const target = container;
        const originalTop = target.scrollTop;
        try {
            let lastBottom = -1;
            let stagnantAtBottom = 0;
            for (let step = 0; step < maxSteps; step += 1) {
                catalog = mergeCatalogs(catalog, catalogSnapshotFromDocument(document, baseUrl));
                const bottom = Math.max(0, target.scrollHeight - target.clientHeight);
                if (bottom <= 0)
                    break;
                const current = target.scrollTop;
                const increment = Math.max(320, Math.floor(target.clientHeight * 0.8));
                const next = Math.min(bottom, current + increment);
                if (next <= current + 1) {
                    if (bottom === lastBottom)
                        stagnantAtBottom += 1;
                    else
                        stagnantAtBottom = 0;
                    lastBottom = bottom;
                    if (stagnantAtBottom >= 2)
                        break;
                    await sleep(Math.max(settleMs, 120));
                    continue;
                }
                setScrollTop(container, next);
                await sleep(settleMs);
            }
            catalog = mergeCatalogs(catalog, catalogSnapshotFromDocument(document, baseUrl));
        }
        finally {
            setScrollTop(container, originalTop);
        }
    }
    return catalog;
}
