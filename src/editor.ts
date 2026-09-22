import { eraseStrokes } from "./erase.ts";
import { cloneStrokes, InkHistory } from "./history.ts";
import { drawEraserCursor, renderStrokes } from "./render.ts";
import type {
  InkAction,
  InkEditorOptions,
  InkPoint,
  InkStyle,
  InkTool,
  Point,
  Stroke,
} from "./types.ts";

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
  /** 진행 중인 지우개 제스처가 지나간 경로. 동작 이력에 그대로 실려 나간다. */
  let eraserPath: InkPoint[] = [];
  let changedWhileErasing = false;
  let redrawFrame: number | undefined;

  function notify(action: InkAction): void {
    onChange?.(strokes, action);
  }

  function pointFromEvent(event: PointerEvent): Point {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function timedPoint(event: PointerEvent): InkPoint {
    return { ...pointFromEvent(event), t: performance.now(), pressure: event.pressure };
  }

  function appendPoint(event: PointerEvent): void {
    if (!current) return;
    current.push(timedPoint(event));
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

  /**
   * 캔버스를 벗어나도 이벤트를 계속 받게 해주는 최적화다.
   *
   * 이벤트가 전달되는 사이에 포인터가 놓이면 `NotFoundError`가 난다. 캡처가 없어도
   * 캔버스 위 입력은 정상 동작하므로 여기서 던지면 안 된다 — 던지면 획을 만들기 전에
   * `pointerDown`이 중단되고, 도구는 잡힌 채로 남아 이후 입력이 전부 무시된다.
   */
  function capturePointer(pointerId: number): void {
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      // 캡처 실패는 치명적이지 않다.
    }
  }

  function pointerDown(event: PointerEvent): void {
    if (activeTool) return;
    activeTool = tool;
    activePointerId = event.pointerId;
    event.preventDefault();
    capturePointer(event.pointerId);

    if (activeTool === "eraser") {
      const point = timedPoint(event);
      eraserCursor = point;
      previousEraserPoint = point;
      eraserPath = [point];
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
        const point = timedPoint(coalesced);
        changedWhileErasing =
          eraseBetween(previousEraserPoint ?? point, point) || changedWhileErasing;
        previousEraserPoint = point;
        eraserCursor = point;
        eraserPath.push(point);
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
      const point = timedPoint(event);
      changedWhileErasing =
        eraseBetween(previousEraserPoint ?? point, point) || changedWhileErasing;
      eraserPath.push(point);
    } else {
      appendPoint(event);
    }

    const changed = erasing ? changedWhileErasing : true;
    // 아무것도 지우지 않은 지우개 탭은 되돌릴 것도, 재생할 것도 없다.
    if (!changed) history.undo(strokes);

    const action: InkAction = erasing
      ? { type: "erase", path: eraserPath, width: style.eraserWidth }
      : { type: "stroke", stroke: (current ?? []).map((point) => ({ ...point })) };

    activeTool = undefined;
    activePointerId = undefined;
    current = undefined;
    previousEraserPoint = undefined;
    eraserPath = [];
    changedWhileErasing = false;
    // 펜을 뗀 뒤에는 커서를 남기지 않는다. 지우고 있는 동안만 보여야 한다.
    eraserCursor = undefined;

    cancelScheduledRedraw();
    redraw();
    if (changed) notify(action);
  }

  function replaceStrokes(next: Stroke[], action: InkAction): void {
    strokes = next;
    current = undefined;
    activeTool = undefined;
    activePointerId = undefined;
    previousEraserPoint = undefined;
    eraserPath = [];
    changedWhileErasing = false;
    cancelScheduledRedraw();
    redraw();
    notify(action);
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
      const copy = cloneStrokes(next);
      replaceStrokes(copy, { type: "set", strokes: cloneStrokes(copy) });
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
      replaceStrokes(previous, { type: "undo" });
      return true;
    },
    redo() {
      const next = history.redo(strokes);
      if (!next) return false;
      replaceStrokes(next, { type: "redo" });
      return true;
    },
    clear() {
      if (strokes.length === 0) return;
      history.commit(strokes);
      replaceStrokes([], { type: "clear" });
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
