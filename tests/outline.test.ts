import { expect, test, vi } from "vite-plus/test";
import { drawOutlineStroke, pressureWidth } from "../src/outline.ts";
import { renderStrokes } from "../src/render.ts";
import type { InkPoint } from "../src/types.ts";

test("필압이 0.8이면 최대 굵기에 닿는다", () => {
  expect(pressureWidth(4, 0.8)).toBeCloseTo(4);
  expect(pressureWidth(4, 1)).toBeCloseTo(4);
});

test("필압이 낮을수록 얇아지고 0에서도 굵기가 남는다", () => {
  expect(pressureWidth(4, 0.4)).toBeCloseTo(2.1);
  expect(pressureWidth(4, 0)).toBeCloseTo(0.2);
});

test("필압을 보고하지 않는 입력은 중간 굵기로 그린다", () => {
  expect(pressureWidth(4)).toBeCloseTo(pressureWidth(4, 0.5));
});

test.each(["outline", "render"])("%s에서 필압에 따른 굵기와 둥근 양 끝을 유지한다", (entry) => {
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
  const canvasContext = context as unknown as CanvasRenderingContext2D;
  const points: InkPoint[] = [
    { x: 10, y: 20, t: 0, pressure: 0 },
    { x: 30, y: 20, t: 1, pressure: 0.8 },
  ];

  if (entry === "outline") {
    drawOutlineStroke(canvasContext, points, 4);
  } else {
    renderStrokes(
      canvasContext,
      [{ points, style: { color: "#000", strokeWidth: 4, widthMode: "pressure", opacity: 1 } }],
      { width: 100, height: 100 },
    );
  }

  expect(context.moveTo).toHaveBeenCalledWith(10, 20.1);
  const [endCap, startCap] = context.arc.mock.calls;
  expect(endCap[0]).toBe(30);
  expect(endCap[1]).toBe(20);
  expect(endCap[2]).toBeCloseTo(0.765);
  expect(startCap[0]).toBe(10);
  expect(startCap[1]).toBe(20);
  expect(startCap[2]).toBeCloseTo(0.1);
  expect(context.closePath).toHaveBeenCalledOnce();
  expect(context.fill).toHaveBeenCalledOnce();
});
