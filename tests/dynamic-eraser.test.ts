import { expect, test } from "vite-plus/test";
import { createDynamicEraser } from "../src/dynamic-eraser.ts";

/** 일정 속도(px/ms)로 `durationMs` 동안 `intervalMs` 간격으로 움직이며 지름을 모은다. */
function move(
  eraser: ReturnType<typeof createDynamicEraser>,
  from: { x: number; t: number },
  speed: number,
  durationMs: number,
  intervalMs: number,
): { x: number; t: number; diameters: number[] } {
  let { x, t } = from;
  const diameters: number[] = [];
  const end = t + durationMs;
  while (t < end) {
    t += intervalMs;
    x += speed * intervalMs;
    diameters.push(eraser.next({ x, y: 0, t }));
  }
  return { x, t, diameters };
}

test.each([0.2, 0.4])("느리게 움직이면 최소 지름에 머문다 (%s px/ms)", (speed) => {
  const eraser = createDynamicEraser();
  expect(eraser.next({ x: 0, y: 0, t: 0 })).toBe(20);
  const { diameters } = move(eraser, { x: 0, t: 0 }, speed, 1000, 8);
  expect(Math.max(...diameters)).toBe(20);
});

test("보통 속도로 움직여도 일찍 커지기 시작한다", () => {
  const eraser = createDynamicEraser();
  eraser.next({ x: 0, y: 0, t: 0 });
  const { diameters } = move(eraser, { x: 0, t: 0 }, 1, 304, 8);
  expect(diameters[Math.floor(150 / 8) - 1]).toBeGreaterThan(25);
  expect(diameters.at(-1)).toBeGreaterThan(35);
});

test("빠르게 문지르면 점점 커져 최대 지름 이하로 수렴한다", () => {
  const eraser = createDynamicEraser();
  eraser.next({ x: 0, y: 0, t: 0 });
  const { diameters } = move(eraser, { x: 0, t: 0 }, 4, 3000, 8);
  // 시작 직후(약 50ms)에는 최대 지름의 절반에 못 미친다. 목표 속도가 v_max를 넘으면 약 τ_up 뒤 최대에 닿는다.
  expect(diameters[Math.floor(50 / 8) - 1]).toBeLessThan(90);
  for (let i = 1; i < diameters.length; i++) {
    expect(diameters[i]).toBeGreaterThanOrEqual(diameters[i - 1]);
    expect(diameters[i] - diameters[i - 1]).toBeLessThan(60);
  }
  expect(diameters.at(-1)).toBeGreaterThan(170);
  expect(diameters.at(-1)).toBeLessThanOrEqual(180);
});

test("빠르게 지우다 멈춰도 천천히 작아진다", () => {
  const eraser = createDynamicEraser();
  eraser.next({ x: 0, y: 0, t: 0 });
  const fast = move(eraser, { x: 0, t: 0 }, 4, 2000, 8);
  const peak = fast.diameters.at(-1)!;
  const slow = move(eraser, fast, 0, 200, 8);
  expect(slow.diameters.at(-1)).toBeGreaterThan(peak * 0.6);
  // 멈춘 직후 100ms 동안은 거의 줄지 않는다.
  expect(slow.diameters[Math.floor(100 / 8) - 1]).toBeGreaterThan(peak * 0.95);
  const later = move(eraser, slow, 0, 4000, 8);
  expect(later.diameters.at(-1)).toBeLessThan(25);
});

test("60Hz와 240Hz에서 같은 시간 뒤 지름이 거의 같다", () => {
  const run = (interval: number) => {
    const eraser = createDynamicEraser();
    eraser.next({ x: 0, y: 0, t: 0 });
    return move(eraser, { x: 0, t: 0 }, 2, 480, interval).diameters.at(-1)!;
  };
  expect(Math.abs(run(1000 / 60 / 4) - run(1000 / 60))).toBeLessThan(5);
});

test("reset하면 최소 지름에서 다시 시작한다", () => {
  const eraser = createDynamicEraser();
  eraser.next({ x: 0, y: 0, t: 0 });
  move(eraser, { x: 0, t: 0 }, 4, 2000, 8);
  eraser.reset();
  expect(eraser.next({ x: 0, y: 0, t: 5000 })).toBe(20);
});
