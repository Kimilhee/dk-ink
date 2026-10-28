import { expect, test } from "vite-plus/test";
import { drawInk, drawStaticLineStroke } from "../src/render.ts";
import type { Stroke } from "../src/types.ts";

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

test("drawInk는 배경과 잉크를 칠하되 획 모양은 한 번만 만든다", () => {
  const calls: string[] = [];
  const fills: Array<{ color: unknown; alpha: unknown }> = [];
  const fakeCtx = {
    globalAlpha: 1,
    fillStyle: "",
    beginPath: () => calls.push("beginPath"),
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    closePath: () => {},
    fill: () => fills.push({ color: fakeCtx.fillStyle, alpha: fakeCtx.globalAlpha }),
  } as unknown as CanvasRenderingContext2D;
  const stroke: Stroke = {
    points: [
      { x: 0, y: 0, t: 0, pressure: 0.5 },
      { x: 10, y: 0, t: 1, pressure: 0.5 },
      { x: 20, y: 5, t: 2, pressure: 0.5 },
    ],
    style: { color: "#00f", strokeWidth: 3, widthMode: "pressure", opacity: 0.7 },
  };

  drawInk(fakeCtx, stroke, 1, "#fff");

  expect(calls.filter((call) => call === "beginPath")).toHaveLength(1);
  expect(fills).toEqual([
    { color: "#fff", alpha: 1 },
    { color: "#00f", alpha: 0.7 },
  ]);
  expect(fakeCtx.globalAlpha).toBe(1);
});
