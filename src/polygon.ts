import { isSmooth, resample } from "./circle.ts";
import type { InkPoint, Point } from "./types.ts";

/**
 * 닫힌 획에서 꼭짓점 3~6개를 찾는다. 꼭짓점은 그린 자리를 그대로 쓰므로 직각삼각형이나
 * 직사각형도 모양을 유지한 채 변만 곧아진다. 고르게 휘는 획은 원이나 타원이므로 제외한다.
 */
export function recognizePolygon(points: readonly Point[]): Point[] | undefined {
  if (points.length < 12) return;
  const samples = resample(points);
  if (samples.length === 0 || isSmooth(samples)) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of samples) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  if (size < 24) return;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > size * 0.2) return;

  // 손떨림은 무시하고 변이 꺾이는 곳만 남긴다.
  const tolerance = size * 0.06;
  // 끝점은 시작점 근처라 버리고, 닫는 변이 그 틈을 잇게 한다.
  let corners = simplify(samples, tolerance).slice(0, -1);
  corners = dropMinorCorners(corners, tolerance);
  if (corners.length < 3 || corners.length > 6) return;
  for (const point of samples) {
    if (distanceToPolygon(point, corners) > tolerance * 2) return;
  }
  if (!corners.every((corner, index) => isSharp(samples, corners, index))) return;
  return corners;
}

/** 꼭짓점 개수와 크기, 방향은 유지하고 변과 각이 모두 같은 정다각형으로 바꾼다. */
export function regularPolygon(corners: readonly Point[]): Point[] {
  const count = corners.length;
  const center = centroid(corners);
  const radius =
    corners.reduce((sum, point) => sum + Math.hypot(point.x - center.x, point.y - center.y), 0) /
    count;
  // 그린 방향(시계/반시계)을 따라 꼭짓점을 놓아야 그린 꼭짓점과 하나씩 짝이 맞는다.
  const direction = signedArea(corners) < 0 ? -1 : 1;
  // 꼭짓점마다 "정다각형이라면 놓였을 각도"와의 차이를 평균해, 그린 도형과 가장 가깝게 돌린다.
  let sumX = 0;
  let sumY = 0;
  corners.forEach((point, index) => {
    const angle =
      Math.atan2(point.y - center.y, point.x - center.x) -
      (direction * index * Math.PI * 2) / count;
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
  });
  const rotation = Math.atan2(sumY, sumX);
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + (direction * index * Math.PI * 2) / count;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

export function centroid(points: readonly Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

/**
 * 기존 획 형식으로 다각형을 만든다. 렌더러가 점 사이를 곡선으로 이으므로, 변이 휘지 않게
 * 변을 따라 점을 촘촘히 채운다.
 */
export function polygonPoints(corners: readonly Point[], sample: InkPoint): InkPoint[] {
  const points: InkPoint[] = [];
  corners.forEach((start, index) => {
    const end = corners[(index + 1) % corners.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 4));
    for (let step = 0; step < steps; step += 1) {
      points.push({
        ...sample,
        x: start.x + ((end.x - start.x) * step) / steps,
        y: start.y + ((end.y - start.y) * step) / steps,
      });
    }
  });
  points.push({ ...points[0] });
  return points;
}

/** Douglas–Peucker: 양 끝을 잇는 직선에서 가장 먼 점이 허용 오차를 넘으면 그 점에서 나눈다. */
function simplify(points: readonly Point[], tolerance: number): Point[] {
  const start = points[0];
  const end = points[points.length - 1];
  let farthest = 0;
  let farthestDistance = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distanceToSegment(points[i], start, end);
    if (distance > farthestDistance) {
      farthest = i;
      farthestDistance = distance;
    }
  }
  if (farthestDistance <= tolerance) return [start, end];
  return [
    ...simplify(points.slice(0, farthest + 1), tolerance),
    ...simplify(points.slice(farthest), tolerance).slice(1),
  ];
}

/**
 * 거의 꺾이지 않는 꼭짓점을 지우고 서로 붙은 꼭짓점을 합친다. 변 중간에서 그리기 시작했거나,
 * 시작점을 조금 지나쳐 끝냈거나, 모서리를 둥글게 그려 한 모서리가 둘로 나뉜 경우에 생긴다.
 */
function dropMinorCorners(corners: Point[], tolerance: number): Point[] {
  const result = [...corners];
  while (result.length > 3) {
    let weakest = -1;
    let weakestTurn = Math.PI / 7;
    let merged = false;
    const perimeter = result.reduce((sum, point, index) => {
      const next = result[(index + 1) % result.length];
      return sum + Math.hypot(next.x - point.x, next.y - point.y);
    }, 0);
    // 둥근 모서리가 둘로 나뉘면 그 사이에 다른 변보다 훨씬 짧은 변이 생긴다.
    const shortEdge = Math.max(tolerance * 2, (perimeter / result.length) * 0.3);
    for (let i = 0; i < result.length; i += 1) {
      const before = result[(i - 1 + result.length) % result.length];
      const point = result[i];
      const after = result[(i + 1) % result.length];
      if (Math.hypot(point.x - after.x, point.y - after.y) < shortEdge) {
        // 둥근 모서리의 양 끝 대신, 양쪽 변을 늘여 만나는 곳을 모서리로 삼는다.
        const afterNext = result[(i + 2) % result.length];
        result[i] = intersection(before, point, after, afterNext) ?? point;
        result.splice((i + 1) % result.length, 1);
        merged = true;
        break;
      }
      const turn = turnAt(before, point, after);
      if (turn < weakestTurn) {
        weakest = i;
        weakestTurn = turn;
      }
    }
    if (merged) continue;
    if (weakest < 0) break;
    result.splice(weakest, 1);
  }
  return result;
}

/**
 * 그린 획이 이 꼭짓점 근처에서 실제로 꺾였는지 본다. 타원도 꼭짓점 몇 개로 근사할 수 있지만,
 * 그 꼭짓점 근처의 획은 완만하게 휠 뿐이라 다각형의 각만큼 꺾이지 않는다.
 */
function isSharp(samples: readonly Point[], corners: readonly Point[], index: number): boolean {
  const corner = corners[index];
  const loop = samples.slice(0, -1);
  let nearest = 0;
  loop.forEach((point, i) => {
    const best = loop[nearest];
    if (
      Math.hypot(point.x - corner.x, point.y - corner.y) <
      Math.hypot(best.x - corner.x, best.y - corner.y)
    ) {
      nearest = i;
    }
  });
  const span = 4;
  const drawn = turnAt(
    loop[(nearest - span + loop.length) % loop.length],
    loop[nearest],
    loop[(nearest + span) % loop.length],
  );
  const expected = turnAt(
    corners[(index - 1 + corners.length) % corners.length],
    corner,
    corners[(index + 1) % corners.length],
  );
  return drawn >= expected * 0.5;
}

function turnAt(before: Point, point: Point, after: Point): number {
  const inX = point.x - before.x;
  const inY = point.y - before.y;
  const outX = after.x - point.x;
  const outY = after.y - point.y;
  return Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
}

/** 직선 a1-a2와 b1-b2가 만나는 점. 거의 나란하면 없다. */
function intersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | undefined {
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) < 1e-6 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return;
  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / cross;
  return { x: a1.x + ax * t, y: a1.y + ay * t };
}

function distanceToPolygon(point: Point, corners: readonly Point[]): number {
  let nearest = Infinity;
  corners.forEach((start, index) => {
    nearest = Math.min(
      nearest,
      distanceToSegment(point, start, corners[(index + 1) % corners.length]),
    );
  });
  return nearest;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  });
  return area / 2;
}
