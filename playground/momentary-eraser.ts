export type EraserContact = {
  source: "finger" | "pointer";
  id: number;
};

export type MomentaryEraserEvent =
  | { type: "press"; contact: EraserContact }
  | { type: "canvas-used" }
  | { type: "contact-released"; contact: EraserContact; overButton: boolean }
  | { type: "contact-canceled"; contact: EraserContact }
  | { type: "stroke-ended" };

export function isFingerTouch(touch: object): boolean {
  return !("touchType" in touch) || touch.touchType !== "stylus";
}

export class MomentaryEraser {
  #contact: EraserContact | undefined;
  #used = false;

  get active(): boolean {
    return this.#contact !== undefined;
  }

  matches(contact: EraserContact): boolean {
    return contact.source === this.#contact?.source && contact.id === this.#contact.id;
  }

  handle(event: MomentaryEraserEvent): "pen" | "eraser" | undefined {
    if (event.type === "press") {
      this.#contact = event.contact;
      this.#used = false;
      return "eraser";
    }
    if (event.type === "canvas-used") {
      if (this.active) this.#used = true;
      return;
    }
    if (event.type === "contact-released") {
      if (!this.matches(event.contact) || !event.overButton) return;
      const nextTool = this.#used ? "pen" : undefined;
      this.reset();
      return nextTool;
    }

    // 취소와 펜 획 종료는 손가락을 뗐다는 뜻이 아니다.
    return;
  }

  reset(): void {
    this.#contact = undefined;
    this.#used = false;
  }
}
