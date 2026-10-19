import { expect, test, vi } from "vite-plus/test";
import { pressureWidth as publicPressureWidth } from "../src/index.ts";
import { drawOutlineStroke, pressureWidth } from "../src/outline.ts";
import { pressureWidth as renderPressureWidth, renderStrokes } from "../src/render.ts";
import type { InkPoint } from "../src/types.ts";

test("기존 pressureWidth 공개 경로를 유지한다", () => {
  expect(publicPressureWidth).toBe(pressureWidth);
  expect(renderPressureWidth).toBe(pressureWidth);
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
