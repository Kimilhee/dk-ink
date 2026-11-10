import { circlePoints, recognizeCircle } from "./circle.ts";
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

/**
 * 앱 캔버스에 남은 점이 이만큼 쌓이면 오래된 것부터 다 쓴 획 층으로 옮긴다. 앱 캔버스는 프레임마다
 * 남은 획을 전부 다시 그리므로, P580에서 프레임이 밀리지 않았던 500점보다 작게 잡는다.
 */
const APP_POINT_LIMIT = 250;

/** 옮긴 뒤 앱 캔버스에 남기는 점 수. 쓰는 중인 획의 끝부분이 이만큼 남는다. */
const APP_POINT_KEEP = 50;

/** 필압 모드에서 길게 눌러 보정한 직선·원의 굵기 비율. */
const SNAPPED_WIDTH_RATIO = 0.7;

const DEFAULT_STYLE: InkStyle = {
  color: "#1d4ed8",
  strokeWidth: 3,
  widthMode: "pressure",
  opacity: 0.8,
  holdToStraightLine: true,
  holdToCircle: true,
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
   * 획 좌표계를 캔버스에서 이만큼 옮겨 보여 준다. 캔버스는 화면에 고정해 두고 아래 내용만
   * 스크롤할 때, 스크롤 위치를 넘기면 획이 내용을 따라 움직인다. 획은 이 오프셋을 더한
   * 좌표(내용 기준)로 저장된다. 기본값은 (0, 0).
   */
  setViewOffset(offset: Point): void;
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
  /*
   * 화면은 두 층이다. 아래부터:
   *   1. 다 쓴 획 층(committed) — 다 쓴 획을 한 장의 그림으로 보관한다.
   *   2. 앱 캔버스(context)      — 쓰는 중인 획과 최근 획을 그린다. 입력을 받는다.
   * 펜 이벤트마다 다 쓴 획을 다시 그리거나 복사하지 않고, 층을 합치는 일은 브라우저 합성기가 맡는다.
   * 펜을 떼도 획을 바로 옮기지 않고, 앱 캔버스의 점이 `APP_POINT_LIMIT`에 이를 때 한꺼번에 옮긴다.
   * 앱이 저지연 캔버스를 켜면 두 층이 화면에 나가는 시점이 달라 옮기는 순간 깜빡이므로, 옮기는
   * 횟수를 줄이기 위해서다. 두 층 모두 일반 캔버스(기본)면 같은 프레임에 함께 바뀌어 깜빡이지 않는다.
   */
  const context = requireContext(canvas);
  const committedCanvas = createLayer(canvas);
  const committedContext = requireContext(committedCanvas);

  // 위치가 지정된 형제는 static 요소 위에 그려지므로, 앱 캔버스도 위치를 줘서 위에 오게 한다.
  const previousPosition = canvas.style.getPropertyValue("position");
  if (canvas.ownerDocument.defaultView?.getComputedStyle(canvas).position === "static") {
    canvas.style.setProperty("position", "relative");
  }

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
  /** 펜이 마지막으로 머문 자리. 여기서 8px 넘게 벗어나면 대기 시간을 처음부터 다시 잰다. */
  let holdOrigin: Point | undefined;
  /** 직선의 시작점. 있으면 진행 중인 획은 이 점과 현재 위치만 잇는다. */
  let straightLineAnchor: InkPoint | undefined;
  let circle: (Point & { radiusOffset: number }) | undefined;
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
   * 앱 캔버스가 그리는 획은 `strokes[appStart]`부터 끝까지다. 그 앞은 다 쓴 획 층에 있다.
   * 첫 획은 `appStartPoint`번째 점부터 그린다. 0이 아니면 그 앞부분을 이미 옮긴 것이다.
   */
  let appStart = 0;
  let appStartPoint = 0;
  /**
   * 캔버스 크기(CSS 픽셀). 크기가 바뀌면 `ResizeObserver`가 `resize`를 부르므로 그때만 잰다.
   * 위치는 캐시하지 않는다 — 휠·프로그램 스크롤이나 레이아웃 이동은 획 도중에도 일어나고
   * (`touch-action: none`이 막는 건 캔버스에서 시작한 터치 스크롤뿐이다), 어긋난 좌표는
   * 저장되는 획 데이터에 그대로 남는다.
   */
  let size = { width: 0, height: 0 };
  /** 아래 층에 마지막으로 준 위치(`alignLayers`). */
  let layerOffset = { left: Number.NaN, top: Number.NaN };
  /** `setViewOffset`으로 받은 값. 캔버스 왼쪽 위가 획 좌표계의 이 점이다. */
  let viewOffset: Point = { x: 0, y: 0 };
  /** 지금 보이는 영역(획 좌표). 층을 비울 때 쓴다. */
  const visibleRect = () => ({ ...viewOffset, ...size });

  function cancelHold(): void {
    clearTimeout(holdTimer);
    holdTimer = undefined;
    holdOrigin = undefined;
  }

  function restartHold(point: Point): void {
    clearTimeout(holdTimer);
    holdOrigin = point;
    holdTimer = setTimeout(() => {
      holdTimer = undefined;
      snapToShape();
    }, style.straightLineDelay);
  }

  /** 곧은 획과 시작점 근처까지 돌아온 원을 보정한다. 원 앞뒤의 짧은 꼬리는 허용한다. */
  function snapToShape(): void {
    if (!current) return;
    const end = current.points[current.points.length - 1];
    const recognized = style.holdToCircle ? recognizeCircle(current.points) : undefined;
    if (recognized) {
      circle = {
        x: recognized.x,
        y: recognized.y,
        radiusOffset: recognized.radius - Math.hypot(end.x - recognized.x, end.y - recognized.y),
      };
      current.points = circlePoints(circle, recognized.radius, end);
    } else if (style.holdToStraightLine && isStraightEnough(current.points)) {
      straightLineAnchor = current.points[0];
      current.points = [straightLineAnchor, end];
    } else {
      return;
    }
    // 필압 글씨는 최대 굵기보다 가늘게 써지므로, 보정한 도형은 최대 굵기의 70%로 맞춘다.
    if (current.style.widthMode === "pressure") current.style.strokeWidth *= SNAPPED_WIDTH_RATIO;
    current.style.widthMode = "constant";
    // 이미 옮긴 앞부분은 보정 전 모양이므로 다 쓴 획 층을 다시 그려 지운다.
    if (appStartPoint > 0 && strokes[appStart] === current) committedDirty = true;
    redrawNow();
  }

  /** 진행 중인 제스처를 끝낸다. 펜을 뗐을 때와 획이 통째로 갈아끼워졌을 때 모두 쓴다. */
  function endGesture(): void {
    cancelHold();
    straightLineAnchor = undefined;
    circle = undefined;
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
   * `bounds`를 안에서 구하지 않고 바깥에서 받는 이유: 뭉친 이벤트(`coalesced`)를 풀면 한 번의
   * `pointermove` 안에서 이 함수가 여러 번 불리는데, 같은 이벤트 처리 중에는 캔버스 위치가
   * 바뀌지 않으므로 이벤트당 한 번만 재서 나눠 쓰는 편이 낫다.
   */
  function timedPoint(event: PointerEvent, bounds: { left: number; top: number }): InkPoint {
    // `performance.now()`가 아니라 이벤트가 들고 온 시각을 쓴다. 뭉친 이벤트는 한 프레임에
    // 몰려 들어오므로 핸들러 실행 시각을 찍으면 그 안의 점들이 전부 같은 시각이 되고,
    // 뭉친 것을 푼 의미가 사라진다. `timeStamp`는 점마다 실제로 샘플된 시각이다.
    return {
      x: event.clientX - bounds.left + viewOffset.x,
      y: event.clientY - bounds.top + viewOffset.y,
      t: event.timeStamp,
      pressure: event.pressure,
    };
  }

  function appendPoint(event: PointerEvent, bounds: { left: number; top: number }): void {
    if (!current) return;
    const point = timedPoint(event, bounds);
    if (circle) {
      // 보정 직후 펜과 원둘레가 조금 달라도 첫 움직임에서 크기가 튀지 않게 한다.
      const radius = Math.hypot(point.x - circle.x, point.y - circle.y) + circle.radiusOffset;
      current.points = circlePoints(circle, Math.max(1, radius), point);
      return;
    }
    if (straightLineAnchor) {
      current.points = [straightLineAnchor, point];
      return;
    }
    current.points.push(point);
    if (
      (style.holdToStraightLine || style.holdToCircle) &&
      (!holdOrigin || Math.hypot(point.x - holdOrigin.x, point.y - holdOrigin.y) > 8)
    ) {
      restartHold(point);
    }
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

  /** 앱 캔버스가 그리는 획. 첫 획은 이미 옮긴 앞부분을 뺀다. 앞부분과 한 점이 겹쳐야 이음매가 끊기지 않는다. */
  function appStrokes(): Stroke[] {
    const list = strokes.slice(appStart);
    if (appStartPoint > 0 && list[0]) {
      list[0] = { ...list[0], points: list[0].points.slice(appStartPoint) };
    }
    return list;
  }

  /**
   * 앱 캔버스의 점이 `APP_POINT_LIMIT`에 이르면 오래된 것부터 다 쓴 획 층으로 옮겨 `APP_POINT_KEEP`점
   * 안팎만 남긴다. 다 쓴 획은 통째로 옮기고, 쓰는 중인 획만 끝부분을 남기고 잘라 옮긴다. 데이터는
   * 한 획 그대로 두고 화면에서만 나눠 그린다.
   */
  function settleAppStrokes(): void {
    if (committedDirty) return;
    let total = appStrokes().reduce((sum, stroke) => sum + stroke.points.length, 0);
    if (total < APP_POINT_LIMIT) return;
    while (total > APP_POINT_KEEP && appStart < strokes.length) {
      const stroke = strokes[appStart];
      if (stroke === current) {
        const cut = stroke.points.length - APP_POINT_KEEP;
        if (cut <= appStartPoint) return;
        drawStrokes(committedContext, [
          { ...stroke, points: stroke.points.slice(appStartPoint, cut + 1) },
        ]);
        appStartPoint = cut;
        return;
      }
      drawStrokes(committedContext, [appStrokes()[0]]);
      total -= stroke.points.length - appStartPoint;
      appStart += 1;
      appStartPoint = 0;
    }
  }

  function redraw(): void {
    if (committedDirty) {
      // 다 쓴 획을 모두 넣는다. 쓰는 중인 획은 `strokes` 끝에 있고, 앱 캔버스가 처음부터 다시 그린다.
      renderStrokes(committedContext, current ? strokes.slice(0, -1) : strokes, visibleRect());
      committedDirty = false;
      appStart = current ? strokes.length - 1 : strokes.length;
      appStartPoint = 0;
    }
    context.clearRect(viewOffset.x, viewOffset.y, size.width, size.height);
    drawStrokes(context, appStrokes());
    const anchor = straightLineAnchor ?? circle;
    if (anchor && current) drawShapeAnchor(anchor, current.style);
    if (eraserCursor && style.showEraserCursor) {
      drawEraserCursor(context, eraserCursor, { ...style, eraserWidth: eraserDiameter });
    }
  }

  /** 도형을 조절하는 동안 고정된 시작점이나 중심을 표시한다. 획 투명도와 무관하게 또렷해야 한다. */
  function drawShapeAnchor(anchor: Point, strokeStyle: StrokeStyle): void {
    context.save();
    context.beginPath();
    context.arc(anchor.x, anchor.y, Math.max(6, strokeStyle.strokeWidth), 0, Math.PI * 2);
    context.fillStyle = strokeStyle.color;
    context.globalAlpha = 1;
    context.fill();
    context.restore();
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

  /** 예약된 그리기를 취소하고 바로 그린다. 획을 시작하거나 끝낼 때처럼 한 번뿐인 변화에 쓴다. */
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

    const bounds = canvas.getBoundingClientRect();
    alignLayers();
    if (activeTool === "eraser") {
      eraseTo(timedPoint(event, bounds));
      scheduleRedraw();
      return;
    }
    history.commit(strokes);
    current = { points: [], style: snapshotStrokeStyle() };
    strokes = [...strokes, current];
    if (activeTool === "line") {
      // 직선 도구는 누른 자리가 곧 시작점이다. 움직이기 전까지는 시작점 표시만 보인다.
      straightLineAnchor = timedPoint(event, bounds);
      current.style.widthMode = "constant";
    } else {
      appendPoint(event, bounds);
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
    const bounds = canvas.getBoundingClientRect();

    if (activeTool === "eraser") {
      for (const sample of events) eraseTo(timedPoint(sample, bounds));
      scheduleRedraw();
    } else {
      // 예측 점(`getPredictedEvents()`)은 쓰지 않는다. 방향을 꺾을 때 선이 펜이 가지 않은
      // 곳까지 순간적으로 삐져나갔다 되돌아오는 게 P580에서 1개만 써도 사라지지 않았다.
      for (const sample of events) appendPoint(sample, bounds);
      if (!circle && !straightLineAnchor) settleAppStrokes();
      // 이벤트마다 그리지 않고 프레임에 한 번만 그린다. P580 Chrome은 펜 이벤트를 프레임에 묶지
      // 않고 점마다 보내서(초당 약 250번), 이벤트마다 그리면 칠하는 작업이 밀려 화면 갱신이 몇 초씩
      // 늦어졌다. 한 프레임 안에서 여러 번 그려도 화면에는 마지막 결과만 나간다.
      scheduleRedraw();
    }
  }

  function pointerUp(event: PointerEvent): void {
    if (!activeTool || event.pointerId !== activePointerId) return;
    event.preventDefault();
    const erasing = activeTool === "eraser";
    const bounds = canvas.getBoundingClientRect();

    if (erasing) {
      eraseTo(timedPoint(event, bounds));
    } else {
      // 끝난 획은 앱 캔버스에 남겨 둔다. 옮기는 일은 다음 획을 쓰다 점이 쌓일 때 한꺼번에 한다.
      appendPoint(event, bounds);
    }

    const changed = erasing ? changedWhileErasing : true;
    endGesture();
    cancelScheduledRedraw();
    redraw();
    if (changed) onChange?.(strokes);
  }

  function replaceStrokes(next: Stroke[]): void {
    strokes = next;
    committedDirty = true;
    endGesture();
    cancelScheduledRedraw();
    redraw();
    onChange?.(strokes);
  }

  /**
   * 아래 층을 앱 캔버스 자리에 겹친다. `ResizeObserver`는 크기가 그대로인 이동(앱이 여백이나
   * 배치를 바꾼 경우)을 알려 주지 않아, `resize`뿐 아니라 획을 시작할 때마다 확인한다. 바로 앞의
   * `getBoundingClientRect`가 레이아웃을 이미 계산해 두므로 위치를 읽는 비용은 거의 없다.
   */
  function alignLayers(): void {
    const left = canvas.offsetLeft;
    const top = canvas.offsetTop;
    if (left === layerOffset.left && top === layerOffset.top) return;
    layerOffset = { left, top };
    committedCanvas.style.setProperty("left", `${left}px`);
    committedCanvas.style.setProperty("top", `${top}px`);
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect();
    size = { width: bounds.width, height: bounds.height };
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    committedCanvas.width = canvas.width;
    committedCanvas.height = canvas.height;
    committedCanvas.style.setProperty("width", `${size.width}px`);
    committedCanvas.style.setProperty("height", `${size.height}px`);
    alignLayers();
    applyTransform();
    committedDirty = true;
    redraw();
  }

  /** 캔버스 내부 이미지는 물리 픽셀, 좌표는 CSS 픽셀(획 좌표)로 유지한다. */
  function applyTransform(): void {
    const ratio = window.devicePixelRatio || 1;
    for (const target of [context, committedContext]) {
      target.setTransform(ratio, 0, 0, ratio, -viewOffset.x * ratio, -viewOffset.y * ratio);
    }
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
    setViewOffset(next) {
      if (next.x === viewOffset.x && next.y === viewOffset.y) return;
      // 획 도중에도 받는다. 이미 찍은 점은 획 좌표라 그대로 두고, 다음 점부터 새 오프셋을 더한다.
      viewOffset = { x: next.x, y: next.y };
      applyTransform();
      committedDirty = true;
      redrawNow();
    },
    destroy() {
      endGesture();
      cancelScheduledRedraw();
      observer.disconnect();
      // 다 쓴 획은 곧 떼어낼 아래 층에 있다. "그려진 내용은 지우지 않는다"는 약속을 지키려면
      // 남는 캔버스에 옮겨 그려야 한다.
      renderStrokes(context, strokes, visibleRect());
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

/** 앱 캔버스 바로 아래에 겹치는 그리기 전용 캔버스를 붙인다. 입력은 앱 캔버스가 받는다. */
function createLayer(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const layer = canvas.ownerDocument.createElement("canvas");
  layer.style.setProperty("position", "absolute");
  layer.style.setProperty("pointer-events", "none");
  canvas.before(layer);
  return layer;
}

/**
 * 2D 컨텍스트를 얻는다.
 *
 * 저지연 캔버스(`desynchronized: true`)는 쓰지 않는다. 앱 캔버스만 저지연이면 두 층이 화면에
 * 나가는 시점이 달라 획을 옮길 때 깜빡이고, P580에서는 지연이 줄지도 않았다. 앱이 에디터보다
 * 먼저 `getContext`로 컨텍스트를 만들어 두면 브라우저가 그 컨텍스트를 그대로 돌려준다.
 */
function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}

/** 이보다 짧은 획은 직선으로 바꾸지 않는다(px). 획 시작에서 머뭇거린 경우를 걸러낸다. */
const MIN_STRAIGHT_LINE_LENGTH = 16;

/**
 * 모든 점이 시작점–끝점 선분 가까이에 있는가. 허용 폭은 길이의 8%(최소 6px)라 길게 그은
 * 손떨림은 받아주고, 꺾인 획(ㄱ, L)이나 갔다 되돌아온 획은 걸러낸다.
 */
function isStraightEnough(points: readonly Point[]): boolean {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return false;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < MIN_STRAIGHT_LINE_LENGTH) return false;
  const tolerance = Math.max(6, length * 0.08);
  return points.every((point) => distanceToSegment(point, start, end) <= tolerance);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + clamped * dx), point.y - (start.y + clamped * dy));
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
