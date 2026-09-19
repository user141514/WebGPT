export interface VerifiedClientTabOps {
  create(url: string): Promise<number>;
  prepare(tabId: number): Promise<void>;
  verify(tabId: number): Promise<void>;
  remove(tabId: number): Promise<void>;
}

export async function openVerifiedClientTab(
  url: string,
  ops: VerifiedClientTabOps
): Promise<{ tabId: number; url: string }> {
  const tabId = await ops.create(url);
  try {
    await ops.prepare(tabId);
    await ops.verify(tabId);
    return { tabId, url };
  } catch (error) {
    await ops.remove(tabId).catch(() => {});
    throw error;
  }
}
