export class MomentaryEraser {
  #pointerId: number | undefined;
  #used = false;
  #canceled = false;

  get active(): boolean {
    return this.#pointerId !== undefined;
  }

  start(pointerId: number): void {
    this.#pointerId = pointerId;
    this.#used = false;
    this.#canceled = false;
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

  cancel(pointerId: number): boolean {
    if (pointerId !== this.#pointerId) return false;
    this.#canceled = true;
    if (!this.#used) return false;
    this.#reset();
    return true;
  }

  finishErase(): boolean {
    if (!this.#canceled || !this.#used) return false;
    this.#reset();
    return true;
  }

  reset(): void {
    this.#reset();
  }

  #reset(): void {
    this.#pointerId = undefined;
    this.#used = false;
    this.#canceled = false;
  }
}
