import type { InkPoint, Point } from "./types.ts";

export type Circle = Point & { radius: number };

/** 앞뒤의 짧은 꼬리를 제외하고 원을 찾는다. 입력 속도에 따라 꼬리의 비중이 달라지지 않게 거리로 나눈다. */
export function recognizeCircle(points: readonly Point[]): Circle | undefined {
  if (points.length < 12) return;
  const samples = resample(points);
  const maxTrim = Math.floor((samples.length - 1) * 0.25);
  let best: Circle | undefined;
  let bestError = Infinity;
  // 꼬리를 자르지 않은 후보(trim 0)부터 본다. 통째로 맞으면 꼬리를 자른 후보와 견주지 않는다.
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    for (let start = 0; start <= trim; start += 1) {
      const candidate = samples.slice(start, samples.length - (trim - start));
      const fit = fitCircle(candidate);
      if (!fit) continue;
      // 비슷하게 맞으면 꼬리를 덜 잘라낸 후보를 고른다.
      const error = fit.error + (trim / samples.length) * 0.01;
      if (error < bestError && isSmooth(candidate)) {
        best = fit.circle;
        bestError = error;
      }
    }
    if (trim === 0 && best) break;
  }
  return best;
}

/** 최소 약 300도를 돌고 시작점 근처까지 돌아왔는지 확인한다. */
function fitCircle(points: readonly Point[]): { circle: Circle; error: number } | undefined {
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
  if (Math.hypot(first.x - last.x, first.y - last.y) > radius * 0.9) return;

  let sweep = 0;
  let travel = 0;
  let squaredError = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const deviation = Math.hypot(point.x - x, point.y - y) - radius;
    if (Math.abs(deviation) > radius * 0.35) return;
    squaredError += (deviation / radius) ** 2;
    if (i === 0) continue;
    const before = points[i - 1];
    const angle = Math.atan2(
      (before.x - x) * (point.y - y) - (before.y - y) * (point.x - x),
      (before.x - x) * (point.x - x) + (before.y - y) * (point.y - y),
    );
    sweep += angle;
    travel += Math.abs(angle);
  }
  if (Math.abs(sweep) < Math.PI * 1.65 || travel > Math.PI * 2.5) return;
  return { circle: { x, y, radius }, error: squaredError / points.length };
}

/**
 * 둘레가 고르게 휘는지 본다. 다각형은 모서리를 둥글게 그려도 곧은 변이 둘레의 많은 부분을
 * 차지하므로, 거의 꺾이지 않는 구간이 4분의 1을 넘으면 원으로 보지 않는다.
 */
function isSmooth(samples: readonly Point[]): boolean {
  // 같은 간격으로 다시 뽑은 점에서 앞뒤 4칸씩 비교해 손떨림보다 큰 휘어짐만 잰다.
  const span = 4;
  const turns: number[] = [];
  for (let i = span; i < samples.length - span; i += 1) {
    const before = samples[i - span];
    const point = samples[i];
    const after = samples[i + span];
    const inX = point.x - before.x;
    const inY = point.y - before.y;
    const outX = after.x - point.x;
    const outY = after.y - point.y;
    turns.push(Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY)));
  }
  const mean = turns.reduce((sum, turn) => sum + turn, 0) / turns.length;
  const straight = turns.filter((turn) => turn < mean * 0.3).length;
  return straight <= turns.length * 0.25;
}

/** 최대 97개 점으로 제한해 꼬리를 찾는 비용이 원래 입력 점 수에 따라 급증하지 않게 한다. */
function resample(points: readonly Point[]): Point[] {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    distances.push(
      distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  const length = distances[distances.length - 1];
  if (length === 0) return [];
  const samples: Point[] = [points[0]];
  let segment = 1;
  for (let i = 1; i < 96; i += 1) {
    const distance = (length * i) / 96;
    while (distances[segment] < distance) segment += 1;
    const fraction =
      (distance - distances[segment - 1]) / (distances[segment] - distances[segment - 1]);
    const before = points[segment - 1];
    const after = points[segment];
    samples.push({
      x: before.x + (after.x - before.x) * fraction,
      y: before.y + (after.y - before.y) * fraction,
    });
  }
  samples.push(points[points.length - 1]);
  return samples;
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
