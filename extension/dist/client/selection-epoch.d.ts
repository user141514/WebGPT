export declare class SelectionEpoch {
    private value;
    begin(): number;
    invalidate(): void;
    isCurrent(token: number): boolean;
}
