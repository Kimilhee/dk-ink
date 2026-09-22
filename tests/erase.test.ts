import { expect, test } from "vite-plus/test";
import { eraseStrokes } from "../src/erase.ts";
import type { Stroke } from "../src/types.ts";

/** y=0 위를 x=0에서 x=100까지 지나는 가로 획. */
function horizontalStroke(): Stroke {
  return Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: 0, t: index }));
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
  expect(result.strokes[0].at(-1)!.x).toBeLessThan(50);
  expect(result.strokes[1][0].x).toBeGreaterThan(50);
});

test("획 전체를 덮으면 획이 사라진다", () => {
  const result = eraseStrokes([horizontalStroke()], { x: -20, y: 0 }, { x: 120, y: 0 }, 40);
  expect(result.changed).toBe(true);
  expect(result.strokes).toHaveLength(0);
});

test("점 하나짜리 획(소수점, i의 점)도 지워진다", () => {
  const dot: Stroke = [{ x: 5, y: 5, t: 0 }];
  expect(eraseStrokes([dot], { x: 5, y: 5 }, { x: 5, y: 5 }, 4).strokes).toHaveLength(0);
  expect(eraseStrokes([dot], { x: 80, y: 80 }, { x: 90, y: 90 }, 4).strokes).toHaveLength(1);
});
