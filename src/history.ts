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
 * 지우개 한 번이 여러 획을 쪼개므로, 연산을 역재생하는 방식보다 스냅샷이 단순하다.
 *
 * 스냅샷은 **배열만 복사하고 획 객체는 공유한다.** 에디터는 다 쓴 획을 고치지 않는다 — 점이
 * 늘어나는 건 진행 중인 획뿐이고(스냅샷은 그 획을 넣기 전에 뜬다), 지우개는 원래 획을 고치지
 * 않고 새 조각을 만든다. 깊은 복사를 하면 펜을 댈 때마다 지금까지 쓴 모든 점을 복사하게 되어
 * 필기가 쌓일수록 획 시작이 무거워지고 메모리도 스냅샷 수만큼 불어난다.
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
      past.push([...before]);
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(current) {
      const previous = past.pop();
      if (!previous) return undefined;
      future.push([...current]);
      return previous;
    },
    redo(current) {
      const next = future.pop();
      if (!next) return undefined;
      past.push([...current]);
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
