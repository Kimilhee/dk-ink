import { drawOutlineStroke } from "./outline.ts";
import type { InkStyle, Point, Stroke } from "./types.ts";

/** `pressure` 모드에서 필압을 굵기로 바꾼다. */
export function pressureWidth(style: InkStyle, pressure = 0.5): number {
  const normalized = Math.max(0, Math.min(1, pressure));
  // 필압 0.8에서 최대 굵기에 닿는다. 그 위는 사람이 거의 내지 않는 구간이다.
  const response = Math.min(1, normalized / 0.8);
  return 0.2 + (style.strokeWidth - 0.2) * response;
}

/** 캔버스를 비우고 획 전체를 다시 그린다. */
export function renderStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  style: InkStyle,
  size: { width: number; height: number },
): void {
  context.clearRect(0, 0, size.width, size.height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (style.widthMode === "pressure") {
      drawOutlineStroke(context, stroke, (pressure) => pressureWidth(style, pressure));
      continue;
    }
    context.lineWidth = style.strokeWidth;
    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);
    for (let index = 1; index < stroke.length; index += 1) {
      context.lineTo(stroke[index].x, stroke[index].y);
    }
    context.stroke();
  }
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
