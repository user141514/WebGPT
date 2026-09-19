export interface VerifiedClientTabOps {
    create(url: string): Promise<number>;
    prepare(tabId: number): Promise<void>;
    verify(tabId: number): Promise<void>;
    remove(tabId: number): Promise<void>;
}
export declare function openVerifiedClientTab(url: string, ops: VerifiedClientTabOps): Promise<{
    tabId: number;
    url: string;
}>;
