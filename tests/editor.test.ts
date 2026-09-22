import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createInkEditor, type InkChangeType, type InkEditor } from "../src/index.ts";
import { createFakeCanvas, installBrowserGlobals, type FakeCanvas } from "./fake-canvas.ts";

let fake: FakeCanvas;
let editor: InkEditor;
let changes: InkChangeType[];
let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = installBrowserGlobals();
  fake = createFakeCanvas();
  changes = [];
  editor = createInkEditor(fake.canvas, {
    onChange: (_strokes, change) => changes.push(change),
  });
});

afterEach(() => {
  editor.destroy();
  restoreGlobals();
});

/** (10,10)에서 (30,10)까지 획 하나를 긋는다. */
function drawStroke(offsetY = 10, pointerId = 1): void {
  fake.emit("pointerdown", { x: 10, y: offsetY, pressure: 0.3, pointerId });
  fake.emit("pointermove", { x: 20, y: offsetY, pressure: 0.6, pointerId });
  fake.emit("pointerup", { x: 30, y: offsetY, pressure: 0.6, pointerId });
}

test("펜을 대고 움직이고 떼면 획 하나가 남는다", () => {
  drawStroke();
  const strokes = editor.getStrokes();
  expect(strokes).toHaveLength(1);
  expect(strokes[0]).toHaveLength(3);
  expect(strokes[0][0]).toMatchObject({ x: 10, y: 10, pressure: 0.3 });
  expect(strokes[0][0].t).toBeTypeOf("number");
  expect(changes).toEqual(["stroke"]);
  expect(editor.drawing).toBe(false);
});

test("뭉친 이벤트(coalesced)까지 점으로 풀어낸다", () => {
  fake.emit("pointerdown", { x: 0, y: 0 });
  fake.emit("pointermove", {
    x: 30,
    y: 0,
    coalesced: [
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ],
  });
  fake.emit("pointerup", { x: 30, y: 0 });
  expect(editor.getStrokes()[0].map((point) => point.x)).toEqual([0, 10, 20, 30, 30]);
});

test("진행 중인 획은 다른 포인터를 무시한다", () => {
  fake.emit("pointerdown", { x: 10, y: 10, pointerId: 1 });
  fake.emit("pointermove", { x: 20, y: 20, pointerId: 2 });
  fake.emit("pointerup", { x: 20, y: 20, pointerId: 2 });
  expect(editor.drawing).toBe(true);
  fake.emit("pointerup", { x: 30, y: 10, pointerId: 1 });
  expect(editor.getStrokes()).toHaveLength(1);
  expect(editor.getStrokes()[0].map((point) => point.x)).toEqual([10, 30]);
});

test("되돌리기와 다시 실행이 획 상태를 왕복한다", () => {
  drawStroke(10);
  drawStroke(40);
  expect(editor.getStrokes()).toHaveLength(2);

  expect(editor.undo()).toBe(true);
  expect(editor.getStrokes()).toHaveLength(1);
  expect(editor.redo()).toBe(true);
  expect(editor.getStrokes()).toHaveLength(2);
  expect(editor.redo()).toBe(false);
  expect(changes).toEqual(["stroke", "stroke", "undo", "redo"]);
});

test("전체 지우기는 되돌릴 수 있다", () => {
  drawStroke();
  editor.clear();
  expect(editor.getStrokes()).toHaveLength(0);
  editor.undo();
  expect(editor.getStrokes()).toHaveLength(1);
});

test("빈 캔버스에서 전체 지우기는 아무 일도 하지 않는다", () => {
  editor.clear();
  expect(changes).toEqual([]);
  expect(editor.canUndo).toBe(false);
});

test("지우개는 획을 지우고 되돌리기를 남긴다", () => {
  drawStroke(10);
  editor.tool = "eraser";
  editor.setStyle({ eraserWidth: 40 });
  fake.emit("pointerdown", { x: 20, y: 10 });
  fake.emit("pointerup", { x: 20, y: 10 });

  expect(editor.getStrokes()).toHaveLength(0);
  expect(changes).toEqual(["stroke", "erase"]);
  editor.undo();
  expect(editor.getStrokes()).toHaveLength(1);
});

test("아무것도 지우지 않은 지우개 동작은 이력을 남기지 않는다", () => {
  drawStroke(10);
  editor.undo();
  expect(editor.canUndo).toBe(false);

  editor.tool = "eraser";
  fake.emit("pointerdown", { x: 300, y: 150 });
  fake.emit("pointerup", { x: 300, y: 150 });
  expect(editor.canUndo).toBe(false);
  expect(changes).toEqual(["stroke", "undo"]);
});

test("getStrokes는 내부 상태와 분리된 복사본을 준다", () => {
  drawStroke();
  const strokes = editor.getStrokes();
  strokes[0][0].x = 999;
  expect(editor.getStrokes()[0][0].x).toBe(10);
});

test("recordHistory: false로 넣은 획은 되돌리기 이력을 더럽히지 않는다", () => {
  editor.setStrokes([[{ x: 1, y: 2, t: 0 }]], { recordHistory: false });
  expect(editor.getStrokes()).toHaveLength(1);
  expect(editor.canUndo).toBe(false);
});

test("도구를 data-tool 속성으로 노출한다", () => {
  expect(fake.canvas.dataset.tool).toBe("pen");
  editor.tool = "eraser";
  expect(fake.canvas.dataset.tool).toBe("eraser");
});

test("destroy 이후에는 입력을 받지 않는다", () => {
  editor.destroy();
  drawStroke();
  expect(editor.getStrokes()).toHaveLength(0);
});
