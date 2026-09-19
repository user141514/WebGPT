export async function openVerifiedClientTab(url, ops) {
    const tabId = await ops.create(url);
    try {
        await ops.prepare(tabId);
        await ops.verify(tabId);
        return { tabId, url };
    }
    catch (error) {
        await ops.remove(tabId).catch(() => { });
        throw error;
    }
}
