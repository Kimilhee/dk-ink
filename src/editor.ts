import { eraseStrokes } from "./erase.ts";
import { cloneStrokes, InkHistory } from "./history.ts";
import { drawEraserCursor, renderStrokes } from "./render.ts";
import type { InkChangeType, InkEditorOptions, InkStyle, InkTool, Point, Stroke } from "./types.ts";

const DEFAULT_STYLE: InkStyle = {
  color: "#182231",
  strokeWidth: 3,
  widthMode: "pressure",
  eraserWidth: 24,
  showEraserCursor: true,
  eraserCursorFill: "rgb(15 118 110 / 12%)",
  eraserCursorStroke: "#0f766e",
};

export interface InkEditor {
  readonly canvas: HTMLCanvasElement;
  /** 현재 도구. 그리는 중에 바꿔도 진행 중인 동작에는 영향을 주지 않는다. */
  tool: InkTool;
  /** 획이 진행 중인지. */
  readonly drawing: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 현재 획. 내부 상태와 분리된 복사본이다. */
  getStrokes(): Stroke[];
  /**
   * 획을 통째로 갈아끼운다. 기본적으로 되돌리기 스택에 쌓인다.
   *
   * 재생·미리보기처럼 사용자의 편집이 아닌 갱신은 `recordHistory: false`로 넘겨
   * 되돌리기 이력을 더럽히지 않는다.
   */
  setStrokes(strokes: readonly Stroke[], options?: { recordHistory?: boolean }): void;
  getStyle(): InkStyle;
  setStyle(style: Partial<InkStyle>): void;
  undo(): boolean;
  redo(): boolean;
  clear(): void;
  /** 캔버스 크기가 바뀌었을 때. ResizeObserver가 자동으로 부르므로 보통 필요 없다. */
  resize(): void;
  /** 이벤트 리스너와 ResizeObserver를 해제한다. */
  destroy(): void;
}

/**
 * 캔버스 하나를 필기 에디터로 만든다.
 *
 * 동작에 필요한 CSS(`touch-action: none` 등)는 직접 캔버스에 넣으므로 별도 스타일시트를
 * 불러올 필요가 없다. 크기·배경·테두리는 앱이 정한다. 현재 도구는 `data-tool` 속성으로
 * 노출되므로 `canvas[data-tool="eraser"]` 같은 선택자를 쓸 수 있다.
 */
export function createInkEditor(
  canvas: HTMLCanvasElement,
  options: InkEditorOptions = {},
): InkEditor {
  const context = requireContext(canvas);

  const style: InkStyle = {
    ...DEFAULT_STYLE,
    ...pickStyle(options),
  };
  const history = new InkHistory(options.historyLimit ?? 50);
  const onChange = options.onChange;

  let strokes: Stroke[] = options.strokes ? cloneStrokes(options.strokes) : [];
  let tool: InkTool = options.tool ?? "pen";
  let activeTool: InkTool | undefined;
  let activePointerId: number | undefined;
  let current: Stroke | undefined;
  let eraserCursor: Point | undefined;
  let previousEraserPoint: Point | undefined;
  let changedWhileErasing = false;
  let redrawFrame: number | undefined;

  function notify(change: InkChangeType): void {
    onChange?.(strokes, change);
  }

  function pointFromEvent(event: PointerEvent): Point {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function appendPoint(event: PointerEvent): void {
    if (!current) return;
    current.push({
      ...pointFromEvent(event),
      t: performance.now(),
      pressure: event.pressure,
    });
  }

  function eraseBetween(from: Point, to: Point): boolean {
    const result = eraseStrokes(strokes, from, to, style.eraserWidth);
    if (result.changed) strokes = result.strokes;
    return result.changed;
  }

  function redraw(): void {
    const bounds = canvas.getBoundingClientRect();
    renderStrokes(context, strokes, style, bounds);
    if (eraserCursor && style.showEraserCursor) {
      drawEraserCursor(context, eraserCursor, style);
    }
  }

  function scheduleRedraw(): void {
    if (redrawFrame !== undefined) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = undefined;
      redraw();
    });
  }

  function cancelScheduledRedraw(): void {
    if (redrawFrame !== undefined) cancelAnimationFrame(redrawFrame);
    redrawFrame = undefined;
  }

  function pointerDown(event: PointerEvent): void {
    if (activeTool) return;
    activeTool = tool;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();

    if (activeTool === "eraser") {
      const point = pointFromEvent(event);
      eraserCursor = point;
      previousEraserPoint = point;
      history.commit(strokes);
      changedWhileErasing = eraseBetween(point, point);
      scheduleRedraw();
      return;
    }
    history.commit(strokes);
    current = [];
    strokes = [...strokes, current];
    appendPoint(event);
    scheduleRedraw();
  }

  function pointerMove(event: PointerEvent): void {
    if (!activeTool || event.pointerId !== activePointerId) return;
    event.preventDefault();
    // 저사양 기기는 이벤트를 뭉쳐 보낸다. 뭉친 것까지 풀어야 궤적이 각지지 않는다.
    // 빈 배열이 올 수 있다 (Safari는 미구현, 신뢰되지 않은 합성 이벤트는 []). 그때는
    // 이벤트 자신이 유일한 점이다 — 빈 배열을 그대로 쓰면 획이 시작·끝점만 남는다.
    const coalesced = event.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [event];

    if (activeTool === "eraser") {
      for (const coalesced of events) {
        const point = pointFromEvent(coalesced);
        changedWhileErasing =
          eraseBetween(previousEraserPoint ?? point, point) || changedWhileErasing;
        previousEraserPoint = point;
        eraserCursor = point;
      }
    } else {
      for (const coalesced of events) appendPoint(coalesced);
    }
    scheduleRedraw();
  }

  function pointerUp(event: PointerEvent): void {
    if (!activeTool || event.pointerId !== activePointerId) return;
    event.preventDefault();
    const erasing = activeTool === "eraser";

    if (erasing) {
      const point = pointFromEvent(event);
      changedWhileErasing =
        eraseBetween(previousEraserPoint ?? point, point) || changedWhileErasing;
    } else {
      appendPoint(event);
    }

    const changed = erasing ? changedWhileErasing : true;
    // 아무것도 지우지 않은 지우개 탭은 되돌릴 게 없다.
    if (!changed) history.undo(strokes);

    activeTool = undefined;
    activePointerId = undefined;
    current = undefined;
    previousEraserPoint = undefined;
    changedWhileErasing = false;
    if (tool !== "eraser") eraserCursor = undefined;

    cancelScheduledRedraw();
    redraw();
    if (changed) notify(erasing ? "erase" : "stroke");
  }

  function replaceStrokes(next: Stroke[], change: InkChangeType): void {
    strokes = next;
    current = undefined;
    activeTool = undefined;
    activePointerId = undefined;
    previousEraserPoint = undefined;
    changedWhileErasing = false;
    cancelScheduledRedraw();
    redraw();
    notify(change);
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    // 백버퍼는 물리 픽셀, 좌표는 CSS 픽셀로 유지한다.
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  function applyTool(): void {
    canvas.dataset.tool = tool;
  }

  // 없으면 펜/터치 입력이 스크롤·텍스트 선택 제스처로 먹힌다. 동작 요건이므로 여기서 박는다.
  canvas.style.touchAction = "none";
  canvas.style.setProperty("-webkit-user-select", "none");
  canvas.style.userSelect = "none";
  applyTool();
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return {
    canvas,
    get tool() {
      return tool;
    },
    set tool(next: InkTool) {
      tool = next;
      applyTool();
      if (next !== "eraser") eraserCursor = undefined;
      scheduleRedraw();
    },
    get drawing() {
      return activeTool !== undefined;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
    getStrokes() {
      return cloneStrokes(strokes);
    },
    setStrokes(next, setOptions) {
      if (setOptions?.recordHistory ?? true) history.commit(strokes);
      replaceStrokes(cloneStrokes(next), "set");
    },
    getStyle() {
      return { ...style };
    },
    setStyle(next) {
      Object.assign(style, pickStyle(next));
      scheduleRedraw();
    },
    undo() {
      const previous = history.undo(strokes);
      if (!previous) return false;
      replaceStrokes(previous, "undo");
      return true;
    },
    redo() {
      const next = history.redo(strokes);
      if (!next) return false;
      replaceStrokes(next, "redo");
      return true;
    },
    clear() {
      if (strokes.length === 0) return;
      history.commit(strokes);
      replaceStrokes([], "clear");
    },
    resize,
    destroy() {
      cancelScheduledRedraw();
      observer.disconnect();
      delete canvas.dataset.tool;
      canvas.style.removeProperty("touch-action");
      canvas.style.removeProperty("-webkit-user-select");
      canvas.style.removeProperty("user-select");
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      history.reset();
    },
  };
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}

/** `undefined` 값이 기본 스타일을 덮어쓰지 않게 걸러낸다. */
function pickStyle(source: Partial<InkStyle>): Partial<InkStyle> {
  const keys = Object.keys(DEFAULT_STYLE) as Array<keyof InkStyle>;
  const picked: Partial<InkStyle> = {};
  for (const key of keys) {
    if (source[key] !== undefined) Object.assign(picked, { [key]: source[key] });
  }
  return picked;
}
