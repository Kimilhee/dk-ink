import type { InkPoint, Point, Stroke } from "./types.ts";

/** 빠르게 그은 획은 점 사이가 멀어 지우개 판정이 거칠어지므로, 이 간격(px) 이하로 촘촘히 쪼갠다. */
export const RESAMPLE_STEP = 1.5;

/**
 * 지우개가 지나간 선분(`from`→`to`)에 닿은 획을 잘라낸다.
 *
 * 획 단위로 지우지 않고 벡터 단위로 쪼갠다. 획 가운데만 지나가면 획이 두 조각으로
 * 남으므로, 글자 일부만 지우는 자연스러운 동작이 된다.
 */
export function eraseStrokes(
  strokes: readonly Stroke[],
  from: Point,
  to: Point,
  diameter: number,
): { strokes: Stroke[]; changed: boolean } {
  const radius = diameter / 2;
  const output: Stroke[] = [];
  let changed = false;

  for (const stroke of strokes) {
    if (!intersectsEraser(stroke.points, from, to, radius)) {
      output.push(stroke);
      continue;
    }
    changed = true;
    // 쪼개진 조각은 원래 획을 이어받은 것이므로 그릴 때 쓴 속성도 그대로 물려받는다.
    for (const points of splitOutsideEraser(stroke.points, from, to, radius)) {
      output.push({ points, style: { ...stroke.style } });
    }
  }
  return { strokes: output, changed };
}

export function intersectsEraser(
  points: readonly InkPoint[],
  from: Point,
  to: Point,
  radius: number,
): boolean {
  if (points.length === 1) return distanceToSegment(points[0], from, to) <= radius;
  for (let index = 1; index < points.length; index += 1) {
    if (segmentDistance(points[index - 1], points[index], from, to) <= radius) return true;
  }
  return false;
}

/**
 * 지우개 밖에 남는 구간을 조각으로 나눈다.
 *
 * 어디서 자를지는 `RESAMPLE_STEP` 간격으로 보간한 점으로 정하지만, 조각에는 **원래 입력 점만**
 * 남기고 잘린 경계에서만 보간 점을 하나 넣는다. 보간 점을 통째로 남기면 원래 꺾은선 위에 점이
 * 촘촘히 박혀 `traceSide`의 곡선 다듬기가 사라지고, 지운 뒤 부드럽던 곡선이 각져 보인다.
 */
function splitOutsideEraser(
  points: readonly InkPoint[],
  from: Point,
  to: Point,
  radius: number,
): InkPoint[][] {
  if (points.length === 1) return [];

  const fragments: InkPoint[][] = [];
  let fragment: InkPoint[] = [];
  // 조각에 아직 넣지 않은 마지막 보간 점. 지워진 구간에 들어서면 이 점이 조각의 끝이 된다.
  let pendingEdge: InkPoint | undefined;

  const visit = (point: InkPoint, original: boolean) => {
    if (distanceToSegment(point, from, to) <= radius) {
      if (pendingEdge) fragment.push(pendingEdge);
      if (fragment.length > 1) fragments.push(fragment);
      fragment = [];
      pendingEdge = undefined;
      return;
    }
    // 지워진 구간을 막 벗어난 첫 점은 보간 점이어도 조각의 시작이 된다.
    if (original || fragment.length === 0) {
      fragment.push(point);
      pendingEdge = undefined;
    } else {
      pendingEdge = point;
    }
  };

  visit(points[0], true);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const steps = resampleSteps(start, end);
    for (let step = 1; step < steps; step += 1) visit(interpolate(start, end, step / steps), false);
    visit(end, true);
  }
  if (fragment.length > 1) fragments.push(fragment);
  return fragments;
}

function resampleSteps(start: Point, end: Point): number {
  return Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / RESAMPLE_STEP));
}

export function resample(points: readonly InkPoint[]): InkPoint[] {
  const sampled: InkPoint[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const steps = resampleSteps(start, end);
    for (let step = 1; step <= steps; step += 1) {
      sampled.push(interpolate(start, end, step / steps));
    }
  }
  return sampled;
}

function interpolate(start: InkPoint, end: InkPoint, ratio: number): InkPoint {
  const pressure =
    start.pressure === undefined && end.pressure === undefined
      ? undefined
      : (start.pressure ?? 0.5) + ((end.pressure ?? 0.5) - (start.pressure ?? 0.5)) * ratio;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    t: start.t + (end.t - start.t) * ratio,
    pressure,
  };
}

export function segmentDistance(startA: Point, endA: Point, startB: Point, endB: Point): number {
  if (segmentsIntersect(startA, endA, startB, endB)) return 0;
  return Math.min(
    distanceToSegment(startA, startB, endB),
    distanceToSegment(endA, startB, endB),
    distanceToSegment(startB, startA, endA),
    distanceToSegment(endB, startA, endA),
  );
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

function segmentsIntersect(startA: Point, endA: Point, startB: Point, endB: Point): boolean {
  const epsilon = 1e-9;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (start: Point, end: Point, point: Point) =>
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon;
  const a = cross(startA, endA, startB);
  const b = cross(startA, endA, endB);
  const c = cross(startB, endB, startA);
  const d = cross(startB, endB, endA);
  if (Math.abs(a) <= epsilon && onSegment(startA, endA, startB)) return true;
  if (Math.abs(b) <= epsilon && onSegment(startA, endA, endB)) return true;
  if (Math.abs(c) <= epsilon && onSegment(startB, endB, startA)) return true;
  if (Math.abs(d) <= epsilon && onSegment(startB, endB, endA)) return true;
  return a > 0 !== b > 0 && c > 0 !== d > 0;
}
