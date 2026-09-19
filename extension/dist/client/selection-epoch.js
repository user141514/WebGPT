export class SelectionEpoch {
    value = 0;
    begin() {
        this.value += 1;
        return this.value;
    }
    invalidate() {
        this.value += 1;
    }
    isCurrent(token) {
        return token === this.value;
    }
}
