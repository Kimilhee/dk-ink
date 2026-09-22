import type { Point, Stroke } from "./types.ts";

interface OutlineSample extends Point {
  radius: number;
}

const MIN_POINT_DISTANCE = 0.35;

/**
 * 획을 선이 아니라 윤곽을 채운 도형으로 그린다.
 *
 * `lineWidth`는 획 하나에 하나만 줄 수 있어서 점마다 굵기가 다른 필압 획을 표현할 수
 * 없다. 점마다 반지름을 계산해 좌/우 외곽선을 만들고 양 끝을 반원으로 닫아 채운다.
 */
export function drawOutlineStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  widthForPressure: (pressure?: number) => number,
): void {
  const samples = smoothSamples(stroke, widthForPressure);
  if (samples.length === 0) return;
  if (samples.length === 1) {
    context.beginPath();
    context.arc(samples[0].x, samples[0].y, samples[0].radius, 0, Math.PI * 2);
    context.fill();
    return;
  }

  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    const distance = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    const normalX = -(after.y - before.y) / distance;
    const normalY = (after.x - before.x) / distance;
    left.push({ x: sample.x + normalX * sample.radius, y: sample.y + normalY * sample.radius });
    right.push({ x: sample.x - normalX * sample.radius, y: sample.y - normalY * sample.radius });
  }

  const first = samples[0];
  const second = samples[1];
  const last = samples[samples.length - 1];
  const beforeLast = samples[samples.length - 2];
  const startAngle = Math.atan2(second.y - first.y, second.x - first.x);
  const endAngle = Math.atan2(last.y - beforeLast.y, last.x - beforeLast.x);

  context.beginPath();
  traceSide(context, left, true);
  context.arc(last.x, last.y, last.radius, endAngle + Math.PI / 2, endAngle - Math.PI / 2, true);
  traceSide(context, [...right].reverse(), false);
  context.arc(
    first.x,
    first.y,
    first.radius,
    startAngle - Math.PI / 2,
    startAngle + Math.PI / 2,
    true,
  );
  context.closePath();
  context.fill();
}

function smoothSamples(
  stroke: Stroke,
  widthForPressure: (pressure?: number) => number,
): OutlineSample[] {
  const samples: OutlineSample[] = [];
  for (const point of stroke) {
    const previous = samples[samples.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < MIN_POINT_DISTANCE) {
      continue;
    }
    const targetRadius = widthForPressure(point.pressure) / 2;
    samples.push({
      x: point.x,
      y: point.y,
      radius: previous ? previous.radius * 0.65 + targetRadius * 0.35 : targetRadius,
    });
  }
  return samples;
}

function traceSide(context: CanvasRenderingContext2D, points: Point[], moveToStart: boolean): void {
  if (moveToStart) context.moveTo(points[0].x, points[0].y);
  else context.lineTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
}
