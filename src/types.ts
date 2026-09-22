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

/** 획 묶음이 왜 바뀌었는지. */
export type InkChangeType = "stroke" | "erase" | "undo" | "redo" | "clear" | "set";

export interface InkStyle {
  /** 잉크 색. Canvas에 그대로 넘긴다. */
  color: string;
  /** 획 굵기(px). `pressure` 모드에서는 최대 굵기다. */
  strokeWidth: number;
  widthMode: WidthMode;
  /** 지우개 지름(px). */
  eraserWidth: number;
  /** 지우개를 쓸 때 커서 원을 그린다. */
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
  /** 획이 바뀔 때마다 호출된다. 그리는 중간에는 호출되지 않는다. */
  onChange?: (strokes: readonly Stroke[], change: InkChangeType) => void;
}
