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

/**
 * `Touch.touchType`는 Safari 전용 확장이다. Chrome·Android WebView의 `Touch`에는 이
 * 속성 자체가 없어서, 그런 브라우저에서 Touch 이벤트로 손가락·스타일러스를 구분하려 하면
 * 스타일러스 접촉까지 손가락으로 오판한다. 이 오판이 Pointer Events 기반 판정과 같은
 * 접촉을 두고 서로 다른 결론을 내며 경쟁하면, 어느 쪽이 나중에 도착하느냐에 따라 결과가
 * 들쭉날쭉해진다("가끔은 바뀌고 가끔은 안 바뀐다"). 그래서 호출부(`main.ts`)는 이 값으로
 * 이 브라우저가 애초에 `touchType`을 구분할 수 있는지 먼저 확인하고, 못 하는 브라우저에서는
 * Touch 기반 판정 자체를 붙이지 않는다 — 그 경우 손가락·스타일러스 구분은 Pointer
 * Events(`pointerType`)만으로 한다.
 */
export const supportsTouchTypeDetection =
  typeof Touch !== "undefined" && "touchType" in Touch.prototype;

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
