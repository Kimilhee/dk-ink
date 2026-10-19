import { expect, test } from "vite-plus/test";
import { drawStaticLineStroke, pressureWidth } from "../src/render.ts";

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

test("drawStaticLineStroke는 시작점으로 이동 후 선을 긋고 stroke를 호출한다", () => {
  const calls: string[] = [];
  const fakeCtx = {
    lineWidth: 0,
    beginPath: () => calls.push("beginPath"),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
    stroke: () => calls.push("stroke"),
  } as unknown as CanvasRenderingContext2D;

  drawStaticLineStroke(
    fakeCtx,
    [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ],
    5,
  );

  expect(fakeCtx.lineWidth).toBe(5);
  expect(calls).toEqual(["beginPath", "moveTo(10,20)", "lineTo(30,40)", "stroke"]);
});
