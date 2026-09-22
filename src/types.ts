/** 캔버스 좌표. CSS 픽셀 기준이며 devicePixelRatio는 렌더러가 처리한다. */
export interface Point {
  x: number;
  y: number;
}

/** 필기 점. `t`는 `performance.now()` 기준 밀리초. */
export interface InkPoint extends Point {
  t: number;
  /** PointerEvent.pressure (0~1). 필압을 보고하지 않는 입력에서는 undefined. */
  pressure?: number;
}

/** 펜을 대고 뗄 때까지의 점 배열. 전부 JSON 직렬화 가능하다. */
export type Stroke = InkPoint[];

export type InkTool = "pen" | "eraser";

/** `pressure`는 필압에 따라 굵기가 변하고, `constant`는 일정하다. */
export type WidthMode = "pressure" | "constant";

/**
 * 편집 한 번. 이걸 순서대로 모으면 필기 세션 전체가 된다.
 *
 * 최종 획 집합만 저장하면 지우개는 흔적도 남지 않는다 — 지워진 자리를 "처음부터
 * 비워둔 채 쓴 것"과 구분할 수 없다. 재생·검수·데이터 수집은 결과가 아니라 과정을
 * 봐야 하므로 동작 자체를 기록한다.
 *
 * `erase`는 지워진 결과가 아니라 **지우개가 지나간 경로**를 담는다. 같은 경로를 같은
 * 상태에 다시 적용하면 같은 결과가 나오므로 (`eraseStrokes`), 결과를 중복 저장할 필요가
 * 없고 재생 도중 임의 시점에서 멈춰도 상태가 맞는다.
 */
export type InkAction =
  | { type: "stroke"; stroke: Stroke }
  | { type: "erase"; path: InkPoint[]; width: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" }
  | { type: "set"; strokes: Stroke[] };

export type InkActionType = InkAction["type"];

export interface InkStyle {
  /** 잉크 색. Canvas에 그대로 넘긴다. */
  color: string;
  /** 획 굵기(px). `pressure` 모드에서는 최대 굵기다. */
  strokeWidth: number;
  widthMode: WidthMode;
  /** 지우개 지름(px). */
  eraserWidth: number;
  /** 지우는 동안 커서 원을 그린다. 펜을 떼면 사라진다. */
  showEraserCursor: boolean;
  eraserCursorFill: string;
  eraserCursorStroke: string;
}

export interface InkEditorOptions extends Partial<InkStyle> {
  tool?: InkTool;
  /** 되돌리기 스택 깊이. 0이면 되돌리기를 쓰지 않는다. */
  historyLimit?: number;
  /** 시작 시 채워 넣을 획. 되돌리기 스택에는 쌓이지 않는다. */
  strokes?: readonly Stroke[];
  /**
   * 획이 바뀔 때마다 호출된다. 그리는 중간에는 호출되지 않는다.
   *
   * `action`을 순서대로 모아두면 세션을 그대로 재생할 수 있다.
   */
  onChange?: (strokes: readonly Stroke[], action: InkAction) => void;
}
