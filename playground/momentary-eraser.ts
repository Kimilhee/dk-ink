export class MomentaryEraser {
  #pointerId: number | undefined;
  #used = false;

  get active(): boolean {
    return this.#pointerId !== undefined;
  }

  start(pointerId: number): void {
    this.#pointerId = pointerId;
    this.#used = false;
  }

  matches(pointerId: number): boolean {
    return pointerId === this.#pointerId;
  }

  use(): void {
    if (this.active) this.#used = true;
  }

  release(pointerId: number): boolean {
    if (pointerId !== this.#pointerId) return false;
    const restorePen = this.#used;
    this.#reset();
    return restorePen;
  }

  cancel(pointerId: number): void {
    if (!this.matches(pointerId)) return;
    // 취소는 손가락을 뗐다는 뜻이 아니다. 실제 release까지 지우개를 유지한다.
  }

  finishErase(): boolean {
    return false;
  }

  reset(): void {
    this.#reset();
  }

  #reset(): void {
    this.#pointerId = undefined;
    this.#used = false;
  }
}
