import type { Stroke } from "./types.ts";

export type InkHistory = {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 변경 직전 상태를 쌓는다. 새 변경이 생기면 redo 가지는 버린다. */
  commit(before: readonly Stroke[]): void;
  undo(current: readonly Stroke[]): Stroke[] | undefined;
  redo(current: readonly Stroke[]): Stroke[] | undefined;
  reset(): void;
};

/**
 * 획 묶음 전체를 스냅샷으로 쌓는 되돌리기 스택.
 *
 * 25심볼 이하 답안 한 블록이 대상이므로 스냅샷 복사 비용이 문제되지 않는다.
 * 지우개 한 번이 여러 획을 쪼개므로, 연산을 역재생하는 방식보다 스냅샷이 단순하다.
 */
export function createInkHistory(limit: number): InkHistory {
  let past: Stroke[][] = [];
  let future: Stroke[][] = [];

  return {
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    commit(before) {
      if (limit <= 0) return;
      past.push(cloneStrokes(before));
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(current) {
      const previous = past.pop();
      if (!previous) return undefined;
      future.push(cloneStrokes(current));
      return previous;
    },
    redo(current) {
      const next = future.pop();
      if (!next) return undefined;
      past.push(cloneStrokes(current));
      return next;
    },
    reset() {
      past = [];
      future = [];
    },
  };
}

export function cloneStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({ ...point })),
    style: { ...stroke.style },
  }));
}
