import { mergeCatalogs, parseChatGptRoute } from '../catalog.js';
export class CatalogCoordinator {
    browser;
    store;
    constructor(browser, store) {
        this.browser = browser;
        this.store = store;
    }
    get() {
        return this.store.load();
    }
    async refresh(seed, seedUrl) {
        if (!seed) {
            const tabId = await this.browser.create('https://chatgpt.com/');
            try {
                await this.browser.waitReady(tabId);
                const rootSnapshot = await this.browser.scan(tabId);
                let catalog = await this.store.merge(rootSnapshot);
                const projectUrls = [...rootSnapshot.projects]
                    .sort((a, b) => a.title.localeCompare(b.title))
                    .map((project) => project.url);
                for (const projectUrl of projectUrls) {
                    await this.browser.update(tabId, projectUrl);
                    await this.browser.waitReady(tabId);
                    catalog = await this.store.merge(await this.browser.scan(tabId));
                }
                return catalog;
            }
            finally {
                await this.browser.remove(tabId).catch(() => { });
            }
        }
        let catalog = await this.store.merge(seed);
        if (seedUrl) {
            const tabId = await this.browser.create(seedUrl);
            try {
                await this.browser.waitReady(tabId);
                const candidates = await this.browser.listProjects(tabId);
                if (candidates.length) {
                    for (const candidate of candidates) {
                        await this.browser.update(tabId, seedUrl);
                        await this.browser.waitReady(tabId);
                        const navigatedUrl = await this.browser.openProject(tabId, candidate);
                        await this.browser.waitReady(tabId);
                        const route = parseChatGptRoute(navigatedUrl);
                        if (route?.kind !== 'project') {
                            throw new Error(`Project ${candidate.title} did not navigate to a ChatGPT project URL`);
                        }
                        catalog = await this.store.merge(mergeCatalogs(await this.browser.scan(tabId), {
                            projects: [{ projectId: route.projectId, title: candidate.title, url: route.url }],
                            conversations: []
                        }));
                    }
                    return catalog;
                }
            }
            finally {
                await this.browser.remove(tabId).catch(() => { });
            }
        }
        const projectSource = seed.projects.length ? seed.projects : catalog.projects;
        const projectUrls = [...projectSource]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((project) => project.url);
        if (!projectUrls.length)
            return catalog;
        const tabId = await this.browser.create(projectUrls[0]);
        try {
            await this.browser.waitReady(tabId);
            catalog = await this.store.merge(await this.browser.scan(tabId));
            for (const projectUrl of projectUrls.slice(1)) {
                await this.browser.update(tabId, projectUrl);
                await this.browser.waitReady(tabId);
                catalog = await this.store.merge(await this.browser.scan(tabId));
            }
            return catalog;
        }
        finally {
            await this.browser.remove(tabId).catch(() => { });
        }
    }
    async resolve(url) {
        const route = parseChatGptRoute(url);
        if (route?.kind !== 'conversation') {
            throw new Error('A valid ChatGPT conversation URL is required');
        }
        const cached = (await this.store.load()).conversations
            .find((conversation) => conversation.url === route.url);
        if (cached)
            return cached;
        const tabId = await this.browser.create(route.url);
        try {
            await this.browser.waitReady(tabId);
            const merged = await this.store.merge(await this.browser.scan(tabId));
            return merged.conversations.find((conversation) => conversation.url === route.url) ?? null;
        }
        finally {
            await this.browser.remove(tabId).catch(() => { });
        }
    }
}
