import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createInkEditor, type InkEditor, type Stroke } from "../src/index.ts";
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

function drawRound(
  options: { ry?: number; turns?: number; direction?: number; wobble?: number } = {},
): void {
  const { ry = 50, turns = 1, direction = 1, wobble = 0 } = options;
  for (let i = 0; i <= 48; i += 1) {
    const angle = (i / 48) * Math.PI * 2 * turns * direction;
    const noise = 1 + wobble * Math.sin(angle * 5);
    fake.emit(i === 0 ? "pointerdown" : "pointermove", {
      x: 150 + 50 * Math.cos(angle) * noise,
      y: 100 + ry * Math.sin(angle) * noise,
    });
  }
}

function expectCircle(stroke: Stroke, radius: number): void {
  expect(stroke.style.widthMode).toBe("constant");
  expect(stroke.points[0]).toEqual(stroke.points[stroke.points.length - 1]);
  for (const point of stroke.points) {
    expect(Math.hypot(point.x - 150, point.y - 100)).toBeCloseTo(radius, 5);
  }
}

test("원을 그리고 0.7초 멈추면 보정하고, 중심을 고정한 채 크기를 조절한 뒤 확정한다", () => {
  drawRound();
  vi.advanceTimersByTime(699);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  vi.advanceTimersByTime(1);
  expectCircle(editor.getStrokes()[0], 50);
  fake.emit("pointermove", { x: 230, y: 100 });
  expectCircle(editor.getStrokes()[0], 80);
  fake.emit("pointermove", { x: 150, y: 70 });
  expectCircle(editor.getStrokes()[0], 30);
  fake.emit("pointerup", { x: 150, y: 80 });
  const [stroke] = editor.getStrokes();
  expectCircle(stroke, 20);
  expect(vi.getTimerCount()).toBe(0);
  editor.undo();
  expect(editor.getStrokes()).toEqual([]);
  editor.redo();
  expect(editor.getStrokes()).toEqual([stroke]);
});

test.each([1, -1])("방향 %d로 조금 삐뚤게 그린 원도 보정한다", (direction) => {
  drawRound({ direction, wobble: 0.08 });
  vi.advanceTimersByTime(700);
  const stroke = editor.getStrokes()[0];
  expect(stroke.style.widthMode).toBe("constant");
  expect(stroke.points[0]).toEqual(stroke.points[stroke.points.length - 1]);
});

test.each([{ turns: 0.75 }, { turns: 2 }, { ry: 25 }])(
  "열린 호, 두 바퀴 획, 긴 타원은 보정하지 않는다: %j",
  (options) => {
    drawRound(options);
    vi.advanceTimersByTime(2000);
    expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  },
);

test("촘촘하게 그린 사각형도 원으로 보정하지 않는다", () => {
  const corners = [
    { x: 200, y: 50 },
    { x: 200, y: 150 },
    { x: 100, y: 150 },
    { x: 100, y: 50 },
    { x: 200, y: 50 },
  ];
  fake.emit("pointerdown", corners[0]);
  for (let edge = 0; edge < 4; edge += 1) {
    for (let step = 1; step <= 12; step += 1) {
      const start = corners[edge];
      const end = corners[edge + 1];
      fake.emit("pointermove", {
        x: start.x + ((end.x - start.x) * step) / 12,
        y: start.y + ((end.y - start.y) * step) / 12,
      });
    }
  }
  vi.advanceTimersByTime(2000);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test("원 보정을 꺼도 직선 보정은 유지한다", () => {
  editor.setStyle({ holdToCircle: false });
  drawRound();
  vi.advanceTimersByTime(700);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  fake.emit("pointerup", { x: 200, y: 100 });
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit("pointermove", { x: 100, y: 20 });
  vi.advanceTimersByTime(700);
  expect(editor.getStrokes()[1].points).toHaveLength(2);
});

test("직선 보정을 꺼도 원은 설정한 시간에 보정한다", () => {
  editor.setStyle({ holdToStraightLine: false, straightLineDelay: 1000 });
  drawRound();
  vi.advanceTimersByTime(999);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  vi.advanceTimersByTime(1);
  expectCircle(editor.getStrokes()[0], 50);
});

test("멈추기 전에 펜을 떼면 자유 필기로 남긴다", () => {
  drawRound();
  fake.emit("pointerup", { x: 200, y: 100 });
  vi.advanceTimersByTime(1000);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test.each(["clear", "undo", "setStrokes"] as const)(
  "%s 뒤에는 원 조절 상태가 남지 않는다",
  (action) => {
    drawRound();
    vi.advanceTimersByTime(700);
    if (action === "setStrokes") editor.setStrokes([]);
    else editor[action]();
    fake.emit("pointerdown", { x: 10, y: 20 });
    fake.emit("pointermove", { x: 12, y: 22 });
    fake.emit("pointerup", { x: 15, y: 25 });
    expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  },
);
