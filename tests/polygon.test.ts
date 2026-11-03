import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createInkEditor, type InkEditor, type Point, type Stroke } from "../src/index.ts";
import { createFakeCanvas, installBrowserGlobals, type BrowserGlobals } from "./fake-canvas.ts";

let fake: ReturnType<typeof createFakeCanvas>;
let globals: BrowserGlobals;
let editor: InkEditor;

beforeEach(() => {
  vi.useFakeTimers();
  globals = installBrowserGlobals();
  fake = createFakeCanvas();
  editor = createInkEditor(fake.canvas);
});

afterEach(() => {
  editor.destroy();
  globals.restore();
  vi.useRealTimers();
});

/**
 * 꼭짓점을 차례로 따라 한 획으로 그린다. 닫으면 첫 꼭짓점으로 돌아와 멈춘다.
 * `bow`를 주면 손으로 그은 변처럼 변 가운데가 그만큼 휜다.
 */
function drawPath(corners: Point[], options: { close?: boolean; bow?: number } = {}): void {
  const { close = true, bow = 0 } = options;
  const path = close ? [...corners, corners[0]] : corners;
  fake.emit("pointerdown", path[0]);
  for (let edge = 0; edge < path.length - 1; edge += 1) {
    const start = path[edge];
    const end = path[edge + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    for (let step = 1; step <= 20; step += 1) {
      const offset = bow * Math.sin((Math.PI * step) / 20) * (edge % 2 ? 1 : -1);
      fake.emit("pointermove", {
        x: start.x + ((end.x - start.x) * step) / 20 - ((end.y - start.y) / length) * offset,
        y: start.y + ((end.y - start.y) * step) / 20 + ((end.x - start.x) / length) * offset,
      });
    }
  }
}

/** 보정된 획에서 방향이 꺾이는 점을 찾는다. 변 위의 점은 모두 한 직선 위에 있다. */
function cornersOf(stroke: Stroke): Point[] {
  const points = stroke.points.slice(0, -1);
  return points.filter((point, index) => {
    const before = points[(index - 1 + points.length) % points.length];
    const after = points[(index + 1) % points.length];
    const turn = Math.atan2(
      (point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x),
      (point.x - before.x) * (after.x - point.x) + (point.y - before.y) * (after.y - point.y),
    );
    return Math.abs(turn) > 0.1;
  });
}

function expectCorners(stroke: Stroke, expected: Point[], precision = 3): void {
  expect(stroke.style.widthMode).toBe("constant");
  const corners = cornersOf(stroke);
  expect(corners).toHaveLength(expected.length);
  for (const target of expected) {
    const nearest = Math.min(...corners.map((c) => Math.hypot(c.x - target.x, c.y - target.y)));
    expect(nearest).toBeLessThan(precision);
  }
}

const rightTriangle = [
  { x: 100, y: 50 },
  { x: 100, y: 150 },
  { x: 250, y: 150 },
];

test("직각삼각형은 그린 꼭짓점 그대로 변만 곧게 펴고, 펜을 떼기 전까지 크기를 조절한다", () => {
  drawPath(rightTriangle, { bow: 3 });
  vi.advanceTimersByTime(700);
  expectCorners(editor.getStrokes()[0], rightTriangle);
  // 무게중심 (150, 116.7)에서 펜까지의 거리가 두 배가 되면 도형도 두 배가 된다.
  fake.emit("pointermove", { x: 50, y: -16.7 });
  fake.emit("pointerup", { x: 50, y: -16.7 });
  const center = { x: 150, y: 350 / 3 };
  expectCorners(
    editor.getStrokes()[0],
    rightTriangle.map((p) => ({
      x: center.x + (p.x - center.x) * 2,
      y: center.y + (p.y - center.y) * 2,
    })),
    5,
  );
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  { name: "삼각형", sides: 3 },
  { name: "마름모", sides: 4 },
  { name: "오각형", sides: 5 },
  { name: "육각형", sides: 6 },
])("변이 조금 휜 $name도 원이 아니라 꼭짓점 수를 맞춰 보정한다", ({ sides }) => {
  const corners = Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + (i / sides) * Math.PI * 2;
    return { x: 150 + 60 * Math.cos(angle), y: 100 + 60 * Math.sin(angle) };
  });
  drawPath(corners, { bow: 3 });
  vi.advanceTimersByTime(700);
  expectCorners(editor.getStrokes()[0], corners);
});

const rectangle = [
  { x: 100, y: 50 },
  { x: 300, y: 50 },
  { x: 300, y: 150 },
  { x: 100, y: 150 },
];

test("2초까지 멈춰 있으면 정다각형으로 바꾼다", () => {
  drawPath(rectangle);
  vi.advanceTimersByTime(1999);
  expectCorners(editor.getStrokes()[0], rectangle);
  vi.advanceTimersByTime(1);
  const corners = cornersOf(editor.getStrokes()[0]);
  expect(corners).toHaveLength(4);
  const sides = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  for (const side of sides) expect(side).toBeCloseTo(sides[0], 5);
  const diagonal = Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
  expect(diagonal).toBeCloseTo(sides[0] * Math.SQRT2, 5);
});

test("2초 전에 펜을 움직여 크기를 조절하면 그린 모양을 유지한다", () => {
  drawPath(rectangle);
  vi.advanceTimersByTime(700);
  fake.emit("pointermove", { x: 120, y: 50 });
  vi.advanceTimersByTime(3000);
  const corners = cornersOf(editor.getStrokes()[0]);
  const width = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
  const height = Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y));
  expect(width / height).toBeCloseTo(2, 5);
});

test.each([
  {
    name: "열린 꺾은선",
    corners: [
      { x: 100, y: 50 },
      { x: 150, y: 150 },
      { x: 200, y: 50 },
      { x: 250, y: 150 },
    ],
    close: false,
  },
  {
    name: "칠각형",
    corners: Array.from({ length: 7 }, (_, i) => ({
      x: 150 + 60 * Math.cos((i / 7) * Math.PI * 2),
      y: 100 + 60 * Math.sin((i / 7) * Math.PI * 2),
    })),
    close: true,
  },
])("$name은 보정하지 않는다", ({ corners, close }) => {
  drawPath(corners, { close });
  vi.advanceTimersByTime(3000);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});
