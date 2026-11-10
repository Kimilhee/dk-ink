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

function recordStaticPath(points: Array<{ x: number; y: number }>): string[] {
  const calls: string[] = [];
  const fakeCtx = {
    lineWidth: 0,
    beginPath: () => {},
    moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
      calls.push(`Q${cx},${cy} ${x},${y}`),
    stroke: () => {},
  } as unknown as CanvasRenderingContext2D;
  drawStaticLineStroke(fakeCtx, points, 3);
  return calls;
}

test("drawStaticLineStroke는 점 사이를 곡선으로 잇고 시작점과 끝점은 그대로 지난다", () => {
  expect(
    recordStaticPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
      { x: 30, y: 30 },
    ]),
  ).toEqual(["M0,0", "Q10,0 15,5", "Q20,10 25,20", "L30,30"]);
});

test("drawStaticLineStroke는 90°보다 크게 꺾이는 모서리를 깎지 않는다", () => {
  expect(
    recordStaticPath([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 5 },
    ]),
  ).toEqual(["M0,0", "L20,0", "L10,2.5", "L0,5"]);
});

test("drawStaticLineStroke는 점 하나로 찍은 획도 점으로 칠한다", () => {
  expect(recordStaticPath([{ x: 5, y: 5 }])).toEqual(["M5,5", "L5.01,5"]);
  // 클릭하면 누른 점과 뗀 점이 같은 자리에 두 개 남는다.
  expect(
    recordStaticPath([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]),
  ).toEqual(["M5,5", "L5.01,5"]);
});
