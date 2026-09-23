import { eraseStrokes } from "./erase.ts";
import { cloneStrokes, InkHistory } from "./history.ts";
import { drawEraserCursor, renderStrokes } from "./render.ts";
import type {
  InkEditorOptions,
  InkPoint,
  InkStyle,
  InkTool,
  Point,
  Stroke,
  StrokeStyle,
} from "./types.ts";

const DEFAULT_STYLE: InkStyle = {
  color: "#1d4ed8",
  strokeWidth: 3,
  widthMode: "pressure",
  opacity: 0.7,
  eraserWidth: 50,
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
   * 미리보기처럼 사용자의 편집이 아닌 갱신은 `recordHistory: false`로 넘겨
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
  /**
   * 에디터를 떼어낸다: 리스너와 `ResizeObserver`를 해제하고, 되돌리기 이력을 비우고,
   * 캔버스에 걸었던 인라인 스타일과 `data-tool`을 **부착 이전 값으로 되돌린다.**
   *
   * 그려진 내용은 지우지 않는다. 캔버스를 비우려면 `clear()`를 먼저 부르면 된다.
   */
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

  /** 진행 중인 제스처를 끝낸다. 펜을 뗐을 때와 획이 통째로 갈아끼워졌을 때 모두 쓴다. */
  function endGesture(): void {
    activeTool = undefined;
    activePointerId = undefined;
    current = undefined;
    previousEraserPoint = undefined;
    changedWhileErasing = false;
    // 펜을 뗀 뒤에는 커서를 남기지 않는다. 지우고 있는 동안만 보여야 한다.
    eraserCursor = undefined;
  }

  function pointFromEvent(event: PointerEvent): Point {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function timedPoint(event: PointerEvent): InkPoint {
    // `performance.now()`가 아니라 이벤트가 들고 온 시각을 쓴다. 뭉친 이벤트는 한 프레임에
    // 몰려 들어오므로 핸들러 실행 시각을 찍으면 그 안의 점들이 전부 같은 시각이 되고,
    // 뭉친 것을 푼 의미가 사라진다. `timeStamp`는 점마다 실제로 샘플된 시각이다.
    return { ...pointFromEvent(event), t: event.timeStamp, pressure: event.pressure };
  }

  function appendPoint(event: PointerEvent): void {
    if (!current) return;
    current.points.push(timedPoint(event));
  }

  /** 지금 설정을 획에 박아 넣는다. 나중에 설정이 바뀌어도 이 획은 이 모습 그대로다. */
  function snapshotStrokeStyle(): StrokeStyle {
    return {
      color: style.color,
      strokeWidth: style.strokeWidth,
      widthMode: style.widthMode,
      opacity: style.opacity,
    };
  }

  function eraseBetween(from: Point, to: Point): boolean {
    const result = eraseStrokes(strokes, from, to, style.eraserWidth);
    if (result.changed) strokes = result.strokes;
    return result.changed;
  }

  function redraw(): void {
    const bounds = canvas.getBoundingClientRect();
    renderStrokes(context, strokes, bounds);
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
      history.commit(strokes);
      changedWhileErasing = eraseBetween(point, point);
      scheduleRedraw();
      return;
    }
    history.commit(strokes);
    current = { points: [], style: snapshotStrokeStyle() };
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
    } else {
      appendPoint(event);
    }

    const changed = erasing ? changedWhileErasing : true;
    // 아무것도 지우지 않은 지우개 탭은 되돌릴 것이 없다.
    if (!changed) history.undo(strokes);

    endGesture();
    cancelScheduledRedraw();
    redraw();
    if (changed) onChange?.(strokes);
  }

  function replaceStrokes(next: Stroke[]): void {
    strokes = next;
    endGesture();
    cancelScheduledRedraw();
    redraw();
    onChange?.(strokes);
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

  const restoreStyle = applyRequiredStyle(canvas);
  const previousToolAttribute = canvas.dataset.tool;
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
      replaceStrokes(cloneStrokes(next));
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
      replaceStrokes(previous);
      return true;
    },
    redo() {
      const next = history.redo(strokes);
      if (!next) return false;
      replaceStrokes(next);
      return true;
    },
    clear() {
      if (strokes.length === 0) return;
      history.commit(strokes);
      replaceStrokes([]);
    },
    resize,
    destroy() {
      cancelScheduledRedraw();
      observer.disconnect();
      if (previousToolAttribute === undefined) delete canvas.dataset.tool;
      else canvas.dataset.tool = previousToolAttribute;
      restoreStyle();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      history.reset();
    },
  };
}

/** 동작에 필요한 인라인 스타일이 없으면 펜/터치 입력이 스크롤·텍스트 선택으로 먹힌다. */
const REQUIRED_STYLE = ["touch-action", "-webkit-user-select", "user-select"];

/**
 * 필수 스타일을 걸고, 부착 이전 상태로 되돌리는 함수를 준다.
 *
 * 그냥 `removeProperty`로 치우면 앱이 미리 걸어둔 인라인 값까지 같이 날아간다.
 * 우리가 덮어쓴 것만 정확히 되돌려야 캔버스를 붙였다 떼는 사용법이 안전하다.
 */
function applyRequiredStyle(canvas: HTMLCanvasElement): () => void {
  const saved = REQUIRED_STYLE.map(
    (name) =>
      [name, canvas.style.getPropertyValue(name), canvas.style.getPropertyPriority(name)] as const,
  );
  for (const name of REQUIRED_STYLE) canvas.style.setProperty(name, "none");
  return () => {
    for (const [name, value, priority] of saved) {
      if (value) canvas.style.setProperty(name, value, priority);
      else canvas.style.removeProperty(name);
    }
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
