export class SelectionEpoch {
  private value = 0;

  begin(): number {
    this.value += 1;
    return this.value;
  }

  invalidate(): void {
    this.value += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.value;
  }
}
