import { drawOutlineStroke } from "./outline.ts";
import type { InkStyle, Point, Stroke } from "./types.ts";

/** `pressure` 모드에서 필압을 굵기로 바꾼다. */
export function pressureWidth(maxWidth: number, pressure = 0.5): number {
  const normalized = Math.max(0, Math.min(1, pressure));
  // 필압 0.8에서 최대 굵기에 닿는다. 그 위는 사람이 거의 내지 않는 구간이다.
  const response = Math.min(1, normalized / 0.8);
  return 0.2 + (maxWidth - 0.2) * response;
}

/**
 * 캔버스를 비우고 획 전체를 다시 그린다.
 *
 * 색·굵기·투명도는 전역 설정이 아니라 **각 획이 들고 있는 값**을 쓴다. 나중에 설정을 바꿔도
 * 이미 그린 획이 따라 바뀌지 않는 건 이 때문이다.
 */
export function renderStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  size: { width: number; height: number },
): void {
  context.clearRect(0, 0, size.width, size.height);
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
      drawOutlineStroke(context, stroke.points, (pressure) =>
        pressureWidth(style.strokeWidth, pressure),
      );
      continue;
    }
    context.lineWidth = style.strokeWidth;
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let index = 1; index < stroke.points.length; index += 1) {
      context.lineTo(stroke.points[index].x, stroke.points[index].y);
    }
    context.stroke();
  }
  // 지우개 커서처럼 뒤이어 그리는 것이 마지막 획의 투명도를 물려받으면 안 된다.
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
