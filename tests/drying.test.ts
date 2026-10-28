import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createDryingLayer } from "../src/drying.ts";
import type { Stroke } from "../src/types.ts";
import { installBrowserGlobals, type BrowserGlobals } from "./fake-canvas.ts";

const STROKE: Stroke = {
  points: [{ x: 0, y: 0, t: 0 }],
  style: { color: "#000", strokeWidth: 3, widthMode: "constant", opacity: 0.7 },
};

let globals: BrowserGlobals;

beforeEach(() => {
  vi.useFakeTimers();
  globals = installBrowserGlobals();
});

afterEach(() => {
  globals.restore();
  vi.useRealTimers();
});

function createLayer() {
  const settle = vi.fn();
  const onWetChange = vi.fn();
  const context = new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D;
  const layer = createDryingLayer({
    context,
    size: () => ({ width: 100, height: 100 }),
    background: () => "#fff",
    settle,
    onWetChange,
  });
  return { layer, settle, onWetChange };
}

/** `ms`만큼 시간을 보내고 그동안 예약된 프레임을 돌린다. */
function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
  globals.flushFrames();
}

test("펜을 뗀 획은 젖어 있다가 마르기 시작하면 앱 캔버스에서 걷고, 다 마르면 넘긴다", () => {
  const { layer, settle, onWetChange } = createLayer();
  layer.add(STROKE);
  expect(layer.wetStrokes()).toEqual([STROKE]);

  advance(400);
  expect(onWetChange).not.toHaveBeenCalled();

  advance(200);
  expect(layer.wetStrokes()).toEqual([]);
  expect(onWetChange).toHaveBeenCalledTimes(1);
  expect(settle).not.toHaveBeenCalled();

  advance(1000);
  expect(settle).toHaveBeenCalledWith(STROKE);
});

test("reset은 마르던 획을 넘기지 않고 버린다", () => {
  const { layer, settle } = createLayer();
  layer.add(STROKE);
  layer.reset();
  advance(2000);
  expect(layer.wetStrokes()).toEqual([]);
  expect(settle).not.toHaveBeenCalled();
});
