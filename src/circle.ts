import type { InkPoint, Point } from "./types.ts";

export type Circle = Point & { radius: number };

/** 거의 한 바퀴를 그린 원만 받는다. 열린 호, 타원, 각진 도형과 되짚은 획은 제외한다. */
export function recognizeCircle(points: readonly Point[]): Circle | undefined {
  if (points.length < 12) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  const radius = (maxX - minX + maxY - minY) / 4;
  if (radius < 12) return;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > radius * 0.5) return;

  let sweep = 0;
  let travel = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (Math.abs(Math.hypot(point.x - x, point.y - y) - radius) > radius * 0.25) return;
    if (i === 0) continue;
    const before = points[i - 1];
    const angle = Math.atan2(
      (before.x - x) * (point.y - y) - (before.y - y) * (point.x - x),
      (before.x - x) * (point.x - x) + (before.y - y) * (point.y - y),
    );
    // 점이 너무 드물면 원과 다각형을 구분할 수 없다.
    if (Math.abs(angle) > Math.PI / 3) return;
    sweep += angle;
    travel += Math.abs(angle);
  }
  if (Math.abs(sweep) < Math.PI * 1.75 || travel > Math.PI * 2.5) return;
  return { x, y, radius };
}

/** 기존 획 형식을 유지해 저장, 지우개, 실행 취소에도 같은 경로를 쓴다. */
export function circlePoints(center: Point, radius: number, sample: InkPoint): InkPoint[] {
  const count = Math.max(64, Math.min(512, Math.ceil((Math.PI * 2 * radius) / 4)));
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      ...sample,
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
  points.push({ ...points[0] });
  return points;
}
