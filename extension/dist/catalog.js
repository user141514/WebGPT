function cleanSegment(value) {
    return decodeURIComponent(value).trim();
}
function parseProjectSegment(value) {
    if (!value.startsWith('g-p-'))
        return null;
    const realistic = value.match(/^(g-p-[0-9a-f]{32})(?:-(.+))?$/i);
    if (realistic) {
        return {
            projectId: realistic[1],
            ...(realistic[2] ? { projectSlug: realistic[2] } : {})
        };
    }
    return { projectId: value };
}
function projectTitleFromSlug(value) {
    if (!value)
        return '';
    return decodeURIComponent(value).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseChatGptRoute(value, baseUrl = 'https://chatgpt.com/') {
    try {
        const url = new URL(value, baseUrl);
        if (url.origin !== 'https://chatgpt.com')
            return null;
        const parts = url.pathname.split('/').filter(Boolean).map(cleanSegment);
        if (parts[0] === 'c' && parts[1]) {
            const conversationId = parts[1];
            return {
                kind: 'conversation',
                conversationId,
                url: `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`
            };
        }
        if (parts[0] === 'g' && parts[1]) {
            const project = parseProjectSegment(parts[1]);
            if (!project)
                return null;
            const projectUrl = `https://chatgpt.com/g/${encodeURIComponent(project.projectId)}`;
            if (parts[2] === 'c' && parts[3]) {
                const conversationId = parts[3];
                return {
                    kind: 'conversation',
                    projectId: project.projectId,
                    conversationId,
                    projectUrl,
                    url: `${projectUrl}/c/${encodeURIComponent(conversationId)}`
                };
            }
            return {
                kind: 'project',
                projectId: project.projectId,
                ...(project.projectSlug ? { projectSlug: project.projectSlug } : {}),
                url: projectUrl
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
export function catalogKeyForUrl(value) {
    const route = parseChatGptRoute(value);
    return route?.kind === 'conversation' ? route.url : null;
}
function normalizeTitle(value) {
    if (!value)
        return '';
    return value.replace(/\s+/g, ' ').trim();
}
function normalizeDocumentTitle(value) {
    const title = normalizeTitle(value)
        .replace(/\s*[-|–—]\s*ChatGPT\s*$/i, '')
        .replace(/^ChatGPT\s*[-|–—]\s*/i, '')
        .trim();
    return /^ChatGPT$/i.test(title) ? '' : title;
}
function candidateTitle(candidate) {
    return normalizeTitle(candidate.text)
        || normalizeTitle(candidate.ariaLabel)
        || normalizeTitle(candidate.title);
}
function betterTitle(current, incoming, placeholder) {
    const next = normalizeTitle(incoming);
    if (!next)
        return current;
    if (!current || current === placeholder)
        return next;
    if (next === placeholder)
        return current;
    return next.length > current.length ? next : current;
}
function laterProjectTitle(current, incoming, placeholder) {
    const next = normalizeTitle(incoming);
    if (!next || next === placeholder)
        return current;
    if (!current || current === placeholder)
        return next;
    return next;
}
export function catalogFromCandidates(input) {
    const projects = new Map();
    const conversations = new Map();
    for (const candidate of input.candidates) {
        const route = parseChatGptRoute(candidate.href, input.baseUrl);
        if (!route)
            continue;
        const label = candidateTitle(candidate);
        if (route.kind === 'project') {
            const current = projects.get(route.url) ?? {
                projectId: route.projectId,
                title: route.projectId,
                url: route.url
            };
            current.title = betterTitle(current.title, label || projectTitleFromSlug(route.projectSlug), route.projectId);
            projects.set(route.url, current);
            continue;
        }
        if (route.projectId && route.projectUrl && !projects.has(route.projectUrl)) {
            projects.set(route.projectUrl, {
                projectId: route.projectId,
                title: route.projectId,
                url: route.projectUrl
            });
        }
        const current = conversations.get(route.url) ?? {
            ...(route.projectId ? { projectId: route.projectId } : {}),
            conversationId: route.conversationId,
            title: route.conversationId,
            url: route.url
        };
        current.title = betterTitle(current.title, label, route.conversationId);
        conversations.set(route.url, current);
    }
    const currentRoute = parseChatGptRoute(input.baseUrl, input.baseUrl);
    if (currentRoute?.kind === 'project') {
        const fallbackTitle = normalizeDocumentTitle(input.documentTitle)
            || projectTitleFromSlug(currentRoute.projectSlug);
        const current = projects.get(currentRoute.url) ?? {
            projectId: currentRoute.projectId,
            title: currentRoute.projectId,
            url: currentRoute.url
        };
        if (current.title === currentRoute.projectId) {
            current.title = betterTitle(current.title, fallbackTitle, currentRoute.projectId);
        }
        projects.set(currentRoute.url, current);
    }
    if (currentRoute?.kind === 'conversation') {
        const fallbackTitle = normalizeDocumentTitle(input.documentTitle);
        const current = conversations.get(currentRoute.url) ?? {
            ...(currentRoute.projectId ? { projectId: currentRoute.projectId } : {}),
            conversationId: currentRoute.conversationId,
            title: currentRoute.conversationId,
            url: currentRoute.url
        };
        current.title = betterTitle(current.title, fallbackTitle, currentRoute.conversationId);
        conversations.set(currentRoute.url, current);
    }
    return {
        projects: [...projects.values()].sort((a, b) => a.title.localeCompare(b.title)),
        conversations: [...conversations.values()].sort((a, b) => {
            const ap = a.projectId ?? '';
            const bp = b.projectId ?? '';
            return ap.localeCompare(bp) || a.title.localeCompare(b.title);
        })
    };
}
export function mergeCatalogs(...catalogs) {
    const projects = new Map();
    const conversations = new Map();
    for (const catalog of catalogs) {
        for (const project of catalog.projects) {
            const current = projects.get(project.url);
            projects.set(project.url, current
                ? { ...current, title: laterProjectTitle(current.title, project.title, project.projectId) }
                : { ...project });
        }
        for (const conversation of catalog.conversations) {
            const current = conversations.get(conversation.url);
            conversations.set(conversation.url, current
                ? {
                    ...current,
                    ...(!current.projectId && conversation.projectId ? { projectId: conversation.projectId } : {}),
                    title: betterTitle(current.title, conversation.title, conversation.conversationId)
                }
                : { ...conversation });
        }
    }
    return {
        projects: [...projects.values()].sort((a, b) => a.title.localeCompare(b.title)),
        conversations: [...conversations.values()].sort((a, b) => {
            const ap = a.projectId ?? '';
            const bp = b.projectId ?? '';
            return ap.localeCompare(bp) || a.title.localeCompare(b.title);
        })
    };
}
