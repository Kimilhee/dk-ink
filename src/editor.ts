import { createDynamicEraser } from "./dynamic-eraser.ts";
import { eraseStrokes } from "./erase.ts";
import { cloneStrokes, createInkHistory } from "./history.ts";
import { drawEraserCursor, drawStrokes, renderStrokes } from "./render.ts";
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
  holdToStraightLine: true,
  straightLineDelay: 700,
  eraserWidth: 50,
  dynamicEraser: false,
  showEraserCursor: true,
  eraserCursorFill: "rgb(15 118 110 / 12%)",
  eraserCursorStroke: "#0f766e",
};

export type InkEditor = {
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
};

/**
 * 캔버스 하나를 필기 에디터로 만든다.
 *
 * 동작에 필요한 CSS(`touch-action: none` 등)는 직접 캔버스에 넣으므로 별도 스타일시트를
 * 불러올 필요가 없다. 크기·테두리는 앱이 정하고, 배경은 캔버스를 감싼 요소에 칠한다(다 쓴 획 층이
 * 캔버스 아래에 겹치므로 캔버스에 칠하면 가려진다). 현재 도구는 `data-tool` 속성으로
 * 노출되므로 `canvas[data-tool="eraser"]` 같은 선택자를 쓸 수 있다.
 */
export function createInkEditor(
  canvas: HTMLCanvasElement,
  options: InkEditorOptions = {},
): InkEditor {
  const context = requireContext(canvas);
  /**
   * 다 쓴 획만 그려 두는 캔버스. 앱 캔버스 바로 아래에 겹쳐 두고, 앱 캔버스에는 진행 중인 획만
   * 그린다. 그러면 펜 이벤트마다 다 쓴 획 그림을 화면 크기 그대로 복사할 필요가 없고, 두 층을
   * 합치는 일은 브라우저 합성기가 맡는다. 입력은 계속 앱 캔버스가 받는다.
   */
  const committedCanvas = canvas.ownerDocument.createElement("canvas");
  const committedContext = requireContext(committedCanvas, false);
  committedCanvas.style.setProperty("position", "absolute");
  committedCanvas.style.setProperty("pointer-events", "none");
  canvas.before(committedCanvas);
  // 위치가 지정된 형제는 static 요소 위에 그려지므로, 앱 캔버스도 위치를 줘서 위에 오게 한다.
  const previousPosition = canvas.style.getPropertyValue("position");
  if (canvas.ownerDocument.defaultView?.getComputedStyle(canvas).position === "static") {
    canvas.style.setProperty("position", "relative");
  }
  /** 획을 마친 뒤 앱 캔버스의 그 획을 지우기로 예약한 프레임. */
  let liveClearFrame: number | undefined;

  const style: InkStyle = {
    ...DEFAULT_STYLE,
    ...pickStyle(options),
  };
  const history = createInkHistory(options.historyLimit ?? 50);
  const onChange = options.onChange;

  let strokes: Stroke[] = options.strokes ? cloneStrokes(options.strokes) : [];
  let tool: InkTool = options.tool ?? "pen";
  let activeTool: InkTool | undefined;
  let activePointerId: number | undefined;
  let current: Stroke | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let straightLineAnchor: InkPoint | undefined;
  let eraserCursor: Point | undefined;
  let previousEraserPoint: Point | undefined;
  let previousEraserDiameter = 0;
  let eraserDiameter = 0;
  const dynamicEraser = createDynamicEraser();
  let changedWhileErasing = false;
  let redrawFrame: number | undefined;
  /** 다 쓴 획이 바뀌어(지우기·되돌리기·갈아끼우기·크기 변경) 다 쓴 획 층을 다시 그려야 한다. */
  let committedDirty = true;
  /**
   * 레이아웃 측정값 캐시. 필기 중 `getBoundingClientRect()`를 부르면, 그 사이 앱이 DOM을 건드린
   * 경우 브라우저가 레이아웃을 동기로 다시 계산해 프레임을 놓친다. 크기는 `resize`에서만,
   * 위치는 획을 시작할 때 한 번만 잰다 — 획 도중에는 캔버스가 스크롤되지 않는다(`touch-action: none`).
   */
  let size = { width: 0, height: 0 };
  let gestureOrigin = { left: 0, top: 0 };

  function cancelHold(): void {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  }

  /** 진행 중인 제스처를 끝낸다. 펜을 뗐을 때와 획이 통째로 갈아끼워졌을 때 모두 쓴다. */
  function endGesture(): void {
    cancelHold();
    straightLineAnchor = undefined;
    activeTool = undefined;
    activePointerId = undefined;
    current = undefined;
    previousEraserPoint = undefined;
    dynamicEraser.reset();
    previousEraserDiameter = 0;
    changedWhileErasing = false;
    // 펜을 뗀 뒤에는 커서를 남기지 않는다. 지우고 있는 동안만 보여야 한다.
    eraserCursor = undefined;
  }

  /**
   * 이벤트 하나를 캔버스 안의 점으로 바꾼다.
   *
   * `bounds`는 획을 시작할 때 잰 `gestureOrigin`이다. `resize` 때만 캐시해 두면 스크롤로
   * 캔버스 위치가 옮겨졌을 때 좌표가 어긋나므로 획마다 다시 잰다.
   */
  function timedPoint(event: PointerEvent, bounds: { left: number; top: number }): InkPoint {
    // `performance.now()`가 아니라 이벤트가 들고 온 시각을 쓴다. 뭉친 이벤트는 한 프레임에
    // 몰려 들어오므로 핸들러 실행 시각을 찍으면 그 안의 점들이 전부 같은 시각이 되고,
    // 뭉친 것을 푼 의미가 사라진다. `timeStamp`는 점마다 실제로 샘플된 시각이다.
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      t: event.timeStamp,
      pressure: event.pressure,
    };
  }

  function appendPoint(event: PointerEvent, bounds: { left: number; top: number }): void {
    if (!current) return;
    const point = timedPoint(event, bounds);
    if (straightLineAnchor) {
      current.points = [straightLineAnchor, point];
      return;
    }
    const start = current.points[0];
    if (start && Math.hypot(point.x - start.x, point.y - start.y) > 8) cancelHold();
    current.points.push(point);
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

  function eraseTo(point: InkPoint): void {
    eraserDiameter = style.dynamicEraser ? dynamicEraser.next(point) : style.eraserWidth;
    // 크기가 변하는 캡슐은 만들지 않고, 두 점의 지름 중 큰 쪽으로 선분을 훑어 빠르게 지나가도 건너뛰지 않게 한다.
    const sweepDiameter = Math.max(eraserDiameter, previousEraserDiameter);
    const result = eraseStrokes(strokes, previousEraserPoint ?? point, point, sweepDiameter);
    if (result.changed) {
      // 실제로 지워지기 직전에 한 번만 쌓는다. 아무것도 못 지운 탭이 이력(특히 redo)을 건드리면 안 된다.
      if (!changedWhileErasing) history.commit(strokes);
      strokes = result.strokes;
      changedWhileErasing = true;
      committedDirty = true;
    }
    previousEraserPoint = point;
    previousEraserDiameter = eraserDiameter;
    eraserCursor = point;
  }

  function redraw(): void {
    if (committedDirty) {
      // 진행 중인 획은 `strokes` 끝에 들어 있지만 아직 다 쓴 획이 아니다.
      renderStrokes(committedContext, current ? strokes.slice(0, -1) : strokes, size);
      committedDirty = false;
    }
    context.clearRect(0, 0, size.width, size.height);
    if (current) drawStrokes(context, [current]);
    if (straightLineAnchor && current) {
      context.save();
      context.beginPath();
      context.arc(
        straightLineAnchor.x,
        straightLineAnchor.y,
        Math.max(6, current.style.strokeWidth),
        0,
        Math.PI * 2,
      );
      context.fillStyle = current.style.color;
      context.globalAlpha = 1;
      context.fill();
      context.restore();
    }
    if (eraserCursor && style.showEraserCursor) {
      drawEraserCursor(context, eraserCursor, { ...style, eraserWidth: eraserDiameter });
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
   * 펜은 다음 프레임을 기다리지 않고 바로 그린다. `desynchronized` 캔버스는 그린 즉시 화면에
   * 나갈 수 있어 rAF를 기다리면 최대 한 프레임을 버린다. 지우개는 지울 때마다 다 쓴 획을 전부
   * 다시 그려야 해 이벤트마다 그리면 오히려 무거우므로 `scheduleRedraw`로 프레임에 모은다.
   */
  function redrawNow(): void {
    cancelScheduledRedraw();
    redraw();
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

    gestureOrigin = canvas.getBoundingClientRect();
    const bounds = gestureOrigin;
    if (activeTool === "eraser") {
      eraseTo(timedPoint(event, bounds));
      scheduleRedraw();
      return;
    }
    history.commit(strokes);
    current = { points: [], style: snapshotStrokeStyle() };
    strokes = [...strokes, current];
    appendPoint(event, bounds);
    if (style.holdToStraightLine) {
      holdTimer = setTimeout(() => {
        holdTimer = undefined;
        if (!current) return;
        straightLineAnchor = current.points[0];
        // 누르는 동안 생긴 흔적은 비우고, 시작점 표시는 별도로 그린다.
        current.points = [];
        current.style.widthMode = "constant";
        redrawNow();
      }, style.straightLineDelay);
    }
    redrawNow();
  }

  function pointerMove(event: PointerEvent): void {
    if (!activeTool || event.pointerId !== activePointerId) return;
    event.preventDefault();
    // 저사양 기기는 이벤트를 뭉쳐 보낸다. 뭉친 것까지 풀어야 궤적이 각지지 않는다.
    // 빈 배열이 올 수 있다 (Safari는 미구현, 신뢰되지 않은 합성 이벤트는 []). 그때는
    // 이벤트 자신이 유일한 점이다 — 빈 배열을 그대로 쓰면 획이 시작·끝점만 남는다.
    const coalesced = event.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [event];
    const bounds = gestureOrigin;

    if (activeTool === "eraser") {
      for (const sample of events) eraseTo(timedPoint(sample, bounds));
      scheduleRedraw();
    } else {
      // 예측 점(`getPredictedEvents()`)은 쓰지 않는다. 방향을 꺾을 때 선이 펜이 가지 않은
      // 곳까지 순간적으로 삐져나갔다 되돌아오는 게 P580에서 1개만 써도 사라지지 않았다.
      for (const sample of events) appendPoint(sample, bounds);
      redrawNow();
    }
  }

  function pointerUp(event: PointerEvent): void {
    if (!activeTool || event.pointerId !== activePointerId) return;
    event.preventDefault();
    const erasing = activeTool === "eraser";
    const bounds = gestureOrigin;

    if (erasing) {
      eraseTo(timedPoint(event, bounds));
    } else {
      appendPoint(event, bounds);
      // 끝난 획은 다 쓴 획 층에 덧그리기만 한다. 어차피 통째로 다시 그릴 참이면 건너뛴다.
      if (current && !committedDirty) drawStrokes(committedContext, [current]);
    }

    const changed = erasing ? changedWhileErasing : true;
    endGesture();
    cancelScheduledRedraw();
    if (erasing) redraw();
    else clearLiveAfterCommit();
    if (changed) onChange?.(strokes);
  }

  /**
   * 다 쓴 획 층(일반 캔버스)은 다음 합성 프레임에야 화면에 나오지만, 앱 캔버스(desynchronized)를
   * 지우면 곧바로 나간다. 펜을 떼자마자 지우면 획이 한 프레임 사라져 깜빡이므로 두 프레임 뒤에 지운다.
   */
  function clearLiveAfterCommit(): void {
    liveClearFrame = requestAnimationFrame(() => {
      liveClearFrame = requestAnimationFrame(() => {
        liveClearFrame = undefined;
        if (!activeTool) redraw();
      });
    });
  }

  function replaceStrokes(next: Stroke[]): void {
    strokes = next;
    committedDirty = true;
    endGesture();
    cancelScheduledRedraw();
    redraw();
    onChange?.(strokes);
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect();
    size = { width: bounds.width, height: bounds.height };
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    committedCanvas.width = canvas.width;
    committedCanvas.height = canvas.height;
    committedCanvas.style.setProperty("left", `${canvas.offsetLeft}px`);
    committedCanvas.style.setProperty("top", `${canvas.offsetTop}px`);
    committedCanvas.style.setProperty("width", `${size.width}px`);
    committedCanvas.style.setProperty("height", `${size.height}px`);
    // 캔버스 내부 이미지는 물리 픽셀, 좌표는 CSS 픽셀로 유지한다.
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    committedContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    committedDirty = true;
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
      endGesture();
      cancelScheduledRedraw();
      if (liveClearFrame !== undefined) cancelAnimationFrame(liveClearFrame);
      observer.disconnect();
      committedCanvas.remove();
      if (previousPosition) canvas.style.setProperty("position", previousPosition);
      else canvas.style.removeProperty("position");
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

/**
 * 2D 컨텍스트를 얻는다.
 *
 * `desynchronized: true`로 브라우저 합성 경로를 가능한 한 건너뛰어 펜 입력 지연을 줄인다.
 * 지원하지 않는 환경에서는 브라우저가 이 힌트를 무시하고 일반 컨텍스트로 동작한다.
 * 화면에 붙이지 않는 캔버스는 합성될 일이 없으니 `false`로 받는다.
 */
function requireContext(
  canvas: HTMLCanvasElement,
  desynchronized = true,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { desynchronized });
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
