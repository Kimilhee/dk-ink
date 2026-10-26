import { expect, test } from "vite-plus/test";
import { eraseStrokes } from "../src/erase.ts";
import type { InkPoint, Stroke, StrokeStyle } from "../src/types.ts";

const STYLE: StrokeStyle = { color: "#000", strokeWidth: 3, widthMode: "pressure", opacity: 1 };

function strokeOf(points: InkPoint[]): Stroke {
  return { points, style: { ...STYLE } };
}

/** y=0 위를 x=0에서 x=100까지 지나는 가로 획. */
function horizontalStroke(): Stroke {
  return strokeOf(Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: 0, t: index })));
}

test("지우개가 닿지 않으면 획이 그대로 남는다", () => {
  const strokes = [horizontalStroke()];
  const result = eraseStrokes(strokes, { x: 50, y: 100 }, { x: 60, y: 100 }, 10);
  expect(result.changed).toBe(false);
  expect(result.strokes).toEqual(strokes);
});

test("획 가운데를 지우면 두 조각으로 쪼개진다", () => {
  const result = eraseStrokes([horizontalStroke()], { x: 50, y: 0 }, { x: 50, y: 0 }, 10);
  expect(result.changed).toBe(true);
  expect(result.strokes).toHaveLength(2);
  // 쪼개진 조각도 원래 획의 속성을 그대로 들고 있어야 한다.
  expect(result.strokes[0].style).toEqual(STYLE);
  expect(result.strokes[1].style).toEqual(STYLE);
  expect(result.strokes[0].points.at(-1)!.x).toBeLessThan(50);
  expect(result.strokes[1].points[0].x).toBeGreaterThan(50);
});

test("획 전체를 덮으면 획이 사라진다", () => {
  const result = eraseStrokes([horizontalStroke()], { x: -20, y: 0 }, { x: 120, y: 0 }, 40);
  expect(result.changed).toBe(true);
  expect(result.strokes).toHaveLength(0);
});

test("점 하나짜리 획(소수점, i의 점)도 지워진다", () => {
  const dot = strokeOf([{ x: 5, y: 5, t: 0 }]);
  expect(eraseStrokes([dot], { x: 5, y: 5 }, { x: 5, y: 5 }, 4).strokes).toHaveLength(0);
  expect(eraseStrokes([dot], { x: 80, y: 80 }, { x: 90, y: 90 }, 4).strokes).toHaveLength(1);
});

test("지운 뒤 남은 조각은 원래 점을 그대로 쓰고 잘린 경계에만 점을 더한다", () => {
  // 점 사이가 먼 사인파. 보간 점으로 채우면 꺾은선이 드러나 곡선이 각져 보인다.
  const original = strokeOf(
    Array.from({ length: 12 }, (_, index) => ({
      x: index * 20,
      y: 50 + 30 * Math.sin((index / 11) * Math.PI * 2),
      t: index,
    })),
  );
  const result = eraseStrokes([original], { x: 110, y: 0 }, { x: 110, y: 100 }, 6);

  expect(result.strokes).toHaveLength(2);
  const [left, right] = result.strokes;
  const isOriginal = (point: InkPoint) =>
    original.points.some((source) => source.x === point.x && source.y === point.y);
  // 경계 점(왼쪽 조각의 끝, 오른쪽 조각의 시작)을 뺀 나머지는 모두 원래 점이다.
  expect(left.points.slice(0, -1).every(isOriginal)).toBe(true);
  expect(right.points.slice(1).every(isOriginal)).toBe(true);
  expect(left.points.at(-1)!.x).toBeCloseTo(107, 0);
  expect(right.points[0].x).toBeCloseTo(113, 0);
  // 지우개가 원래 점 사이(x=100~120)만 지나가므로 잃는 원래 점은 없고 경계 점 2개만 늘어난다.
  expect(left.points.length + right.points.length).toBe(original.points.length + 2);
});
