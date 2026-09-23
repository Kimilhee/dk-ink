import type { Stroke } from "./types.ts";

/**
 * 획 묶음 전체를 스냅샷으로 쌓는 되돌리기 스택.
 *
 * 25심볼 이하 답안 한 블록이 대상이므로 스냅샷 복사 비용이 문제되지 않는다.
 * 지우개 한 번이 여러 획을 쪼개므로, 연산을 역재생하는 방식보다 스냅샷이 단순하다.
 */
export class InkHistory {
  #past: Stroke[][] = [];
  #future: Stroke[][] = [];

  constructor(private readonly limit: number) {}

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** 변경 직전 상태를 쌓는다. 새 변경이 생기면 redo 가지는 버린다. */
  commit(before: readonly Stroke[]): void {
    if (this.limit <= 0) return;
    this.#past.push(cloneStrokes(before));
    if (this.#past.length > this.limit) this.#past.shift();
    this.#future = [];
  }

  undo(current: readonly Stroke[]): Stroke[] | undefined {
    const previous = this.#past.pop();
    if (!previous) return undefined;
    this.#future.push(cloneStrokes(current));
    return previous;
  }

  redo(current: readonly Stroke[]): Stroke[] | undefined {
    const next = this.#future.pop();
    if (!next) return undefined;
    this.#past.push(cloneStrokes(current));
    return next;
  }

  reset(): void {
    this.#past = [];
    this.#future = [];
  }
}

export function cloneStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({ ...point })),
    style: { ...stroke.style },
  }));
}
