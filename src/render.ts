import { drawOutlineStroke } from "./outline.ts";
import type { InkStyle, Point, Stroke } from "./types.ts";

/** 고정 굵기로 연속된 점들을 선으로 잇는다. */
export function drawStaticLineStroke(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  strokeWidth: number,
): void {
  context.lineWidth = strokeWidth;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();
}

/** 캔버스를 비우고 획 전체를 다시 그린다. */
export function renderStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  size: { width: number; height: number },
): void {
  context.clearRect(0, 0, size.width, size.height);
  drawStrokes(context, strokes);
}

/**
 * 지우지 않고 획들을 덧그린다.
 *
 * 색·굵기·투명도는 전역 설정이 아니라 **각 획이 들고 있는 값**을 쓴다. 나중에 설정을 바꿔도
 * 이미 그린 획이 따라 바뀌지 않는 건 이 때문이다.
 */
export function drawStrokes(context: CanvasRenderingContext2D, strokes: readonly Stroke[]): void {
  context.lineCap = "round";
  context.lineJoin = "round";
  const previousAlpha = context.globalAlpha;
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const style = stroke.style;
    context.globalAlpha = style.opacity;
    context.strokeStyle = style.color;
    context.fillStyle = style.color;
    if (style.widthMode === "pressure") {
      drawOutlineStroke(context, stroke.points, style.strokeWidth);
    } else {
      drawStaticLineStroke(context, stroke.points, style.strokeWidth);
    }
  }
  // 지우개 커서처럼 뒤이어 그리는 것이 마지막 획의 투명도를 물려받으면 안 된다.
  context.globalAlpha = previousAlpha;
}

/**
 * 획 모양대로 배경색을 `underlay`만큼 깔고 그 위에 획을 칠한다.
 *
 * `underlay`가 1이면 아래가 가려져, 바탕 위에 반투명으로 칠한 것과 같은 색의 **불투명** 획이 된다.
 * 불투명 획은 두 층에 겹쳐 그려져도 진해지지 않으므로 층을 옮기는 동안 쓴다. 0이면 원래 반투명
 * 획이고, 그 사이 값은 아래의 교차점·문항 글자가 서서히 비쳐 나오는 "마르는 중"이다.
 */
export function drawInk(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  underlay: number,
  background: string,
): void {
  const { style } = stroke;
  if (underlay <= 0 || style.opacity >= 1 || stroke.points.length === 0) {
    drawStrokes(context, [stroke]);
    return;
  }
  drawStrokes(context, [{ ...stroke, style: { ...style, color: background, opacity: underlay } }]);
  // 칠한 뒤에도 캔버스는 마지막 경로를 기억하므로, 같은 모양을 잉크색으로 한 번 더 칠한다.
  // 획을 두 번 그리면 필압 윤곽 계산도 두 번이 되는데, 쓰는 중인 획은 펜 이벤트마다 여기를 지난다.
  const previousAlpha = context.globalAlpha;
  context.globalAlpha = style.opacity;
  context.fillStyle = style.color;
  context.strokeStyle = style.color;
  if (style.widthMode === "pressure") context.fill();
  else context.stroke();
  context.globalAlpha = previousAlpha;
}

/** 지우개가 어디를 지울지 보여주는 점선 원. */
export function drawEraserCursor(
  context: CanvasRenderingContext2D,
  point: Point,
  style: InkStyle,
): void {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, style.eraserWidth / 2, 0, Math.PI * 2);
  context.fillStyle = style.eraserCursorFill;
  context.strokeStyle = style.eraserCursorStroke;
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.fill();
  context.stroke();
  context.restore();
}
