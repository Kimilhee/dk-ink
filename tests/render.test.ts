import { expect, test } from "vite-plus/test";
import { drawStaticLineStroke } from "../src/render.ts";

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
