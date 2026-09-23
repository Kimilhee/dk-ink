import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  createInkEditor,
  eraseStrokes,
  type InkAction,
  type InkEditor,
  type StrokeStyle,
} from "../src/index.ts";
import { createFakeCanvas, installBrowserGlobals, type BrowserGlobals } from "./fake-canvas.ts";

function strokeStyle(): StrokeStyle {
  return { color: "#000", strokeWidth: 3, widthMode: "pressure", opacity: 1 };
}

let fake: ReturnType<typeof createFakeCanvas>;
let editor: InkEditor;
let actions: InkAction[];
let globals: BrowserGlobals;

beforeEach(() => {
  globals = installBrowserGlobals();
  fake = createFakeCanvas();
  actions = [];
  editor = createInkEditor(fake.canvas, {
    onChange: (_strokes, action) => actions.push(action),
  });
});

afterEach(() => {
  editor.destroy();
  globals.restore();
});

test("펜 동작은 그은 획을 그대로 담는다", () => {
  fake.emit("pointerdown", { x: 10, y: 10, pressure: 0.2 });
  fake.emit("pointermove", { x: 20, y: 10, pressure: 0.6 });
  fake.emit("pointerup", { x: 30, y: 10, pressure: 0.6 });

  const action = actions[0];
  expect(action.type).toBe("stroke");
  if (action.type !== "stroke") return;
  expect(action.stroke.points.map((point) => point.x)).toEqual([10, 20, 30]);
  expect(action.stroke.points[0].pressure).toBe(0.2);
});

test("펜 동작의 획은 이후 편집에 흔들리지 않는다", () => {
  fake.emit("pointerdown", { x: 10, y: 10 });
  fake.emit("pointerup", { x: 30, y: 10 });
  const action = actions[0];

  // 같은 획을 지워도 이미 기록된 동작은 그대로여야 재생이 맞는다.
  editor.tool = "eraser";
  editor.setStyle({ eraserWidth: 60 });
  fake.emit("pointerdown", { x: 20, y: 10, pointerId: 2 });
  fake.emit("pointerup", { x: 20, y: 10, pointerId: 2 });

  expect(editor.getStrokes()).toHaveLength(0);
  if (action.type !== "stroke") return;
  expect(action.stroke.points).toHaveLength(2);
});

test("지우개 동작은 결과가 아니라 지나간 경로와 두께를 담는다", () => {
  fake.emit("pointerdown", { x: 10, y: 10 });
  fake.emit("pointermove", { x: 100, y: 10 });
  fake.emit("pointerup", { x: 200, y: 10 });

  editor.tool = "eraser";
  editor.setStyle({ eraserWidth: 18 });
  fake.emit("pointerdown", { x: 90, y: 30, pointerId: 2 });
  fake.emit("pointermove", { x: 100, y: 10, pointerId: 2 });
  fake.emit("pointerup", { x: 110, y: 30, pointerId: 2 });

  const action = actions[1];
  expect(action.type).toBe("erase");
  if (action.type !== "erase") return;
  expect(action.width).toBe(18);
  expect(action.path.map((point) => point.x)).toEqual([90, 100, 110]);
  expect(action.path.every((point) => Number.isFinite(point.t))).toBe(true);
});

test("기록한 경로를 다시 적용하면 같은 결과가 나온다", () => {
  fake.emit("pointerdown", { x: 0, y: 0 });
  for (let x = 10; x <= 200; x += 10) fake.emit("pointermove", { x, y: 0 });
  fake.emit("pointerup", { x: 200, y: 0 });
  const drawn = actions[0];

  editor.tool = "eraser";
  editor.setStyle({ eraserWidth: 20 });
  fake.emit("pointerdown", { x: 100, y: 20, pointerId: 2 });
  fake.emit("pointermove", { x: 100, y: 0, pointerId: 2 });
  fake.emit("pointerup", { x: 100, y: -20, pointerId: 2 });
  const erased = actions[1];

  // 재생이 성립하는 근거: 같은 상태에 같은 경로를 적용하면 편집 결과가 재현된다.
  if (drawn.type !== "stroke" || erased.type !== "erase") throw new Error("unexpected actions");
  let replayed = [drawn.stroke];
  for (let index = 1; index < erased.path.length; index += 1) {
    replayed = eraseStrokes(
      replayed,
      erased.path[index - 1],
      erased.path[index],
      erased.width,
    ).strokes;
  }
  expect(replayed.map((stroke) => stroke.points.length)).toEqual(
    editor.getStrokes().map((stroke) => stroke.points.length),
  );
});

test("아무것도 지우지 않은 지우개 제스처는 이력에 남지 않는다", () => {
  editor.tool = "eraser";
  fake.emit("pointerdown", { x: 300, y: 150 });
  fake.emit("pointermove", { x: 320, y: 150 });
  fake.emit("pointerup", { x: 340, y: 150 });
  expect(actions).toEqual([]);
});

test("되돌리기·전체지우기·교체도 이력에 남는다", () => {
  fake.emit("pointerdown", { x: 10, y: 10 });
  fake.emit("pointerup", { x: 30, y: 10 });
  editor.undo();
  editor.redo();
  editor.clear();
  editor.setStrokes([{ points: [{ x: 1, y: 2, t: 0 }], style: strokeStyle() }]);

  expect(actions.map((action) => action.type)).toEqual(["stroke", "undo", "redo", "clear", "set"]);
  const set = actions[4];
  if (set.type !== "set") return;
  expect(set.strokes[0].points[0].x).toBe(1);
});

test("뭉친 이벤트 안의 점들이 각자 시각을 갖는다", () => {
  fake.emit("pointerdown", { x: 0, y: 0, timeStamp: 100 });
  fake.emit("pointermove", {
    x: 30,
    y: 0,
    coalesced: [
      { x: 10, y: 0, timeStamp: 104 },
      { x: 20, y: 0, timeStamp: 108 },
      { x: 30, y: 0, timeStamp: 112 },
    ],
  });
  fake.emit("pointerup", { x: 40, y: 0, timeStamp: 120 });

  // 핸들러 실행 시각을 찍으면 뭉친 3점이 전부 같은 값이 되어 프레임 내부 타이밍이 사라진다.
  expect(editor.getStrokes()[0].points.map((point) => point.t)).toEqual([100, 104, 108, 112, 120]);
});

test("필기 속도를 점 간격으로 복원할 수 있다", () => {
  fake.emit("pointerdown", { x: 0, y: 0, timeStamp: 1000 });
  fake.emit("pointermove", { x: 10, y: 0, timeStamp: 1008 });
  fake.emit("pointerup", { x: 40, y: 0, timeStamp: 1016 });

  const points = editor.getStrokes()[0].points;
  const gaps = points.slice(1).map((point, index) => point.t - points[index].t);
  expect(gaps).toEqual([8, 8]);
});
