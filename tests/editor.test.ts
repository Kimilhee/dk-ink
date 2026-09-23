import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createInkEditor, type InkEditor, type StrokeStyle } from "../src/index.ts";
import {
  createFakeCanvas,
  installBrowserGlobals,
  type BrowserGlobals,
  type FakeCanvas,
} from "./fake-canvas.ts";

function editorStrokeStyle(): StrokeStyle {
  return { color: "#000", strokeWidth: 3, widthMode: "pressure", opacity: 1 };
}

let fake: FakeCanvas;
let editor: InkEditor;
let changes: number[];
let globals: BrowserGlobals;

beforeEach(() => {
  globals = installBrowserGlobals();
  fake = createFakeCanvas();
  changes = [];
  editor = createInkEditor(fake.canvas, {
    onChange: (strokes) => changes.push(strokes.length),
  });
});

afterEach(() => {
  editor.destroy();
  globals.restore();
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
  expect(strokes[0].points).toHaveLength(3);
  expect(strokes[0].points[0]).toMatchObject({ x: 10, y: 10, pressure: 0.3 });
  expect(strokes[0].points[0].t).toBeTypeOf("number");
  expect(changes).toEqual([1]);
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
  expect(editor.getStrokes()[0].points.map((point) => point.x)).toEqual([0, 10, 20, 30, 30]);
});

test("뭉친 이벤트가 빈 배열이면 이벤트 자신을 점으로 쓴다", () => {
  fake.emit("pointerdown", { x: 0, y: 0 });
  fake.emit("pointermove", { x: 10, y: 5, emptyCoalesced: true });
  fake.emit("pointermove", { x: 20, y: 9, emptyCoalesced: true });
  fake.emit("pointerup", { x: 30, y: 0 });
  // 빈 배열을 그대로 쓰면 중간 점이 사라져 시작·끝만 남는다.
  expect(editor.getStrokes()[0].points.map((point) => point.x)).toEqual([0, 10, 20, 30]);
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

test("진행 중인 획은 다른 포인터를 무시한다", () => {
  fake.emit("pointerdown", { x: 10, y: 10, pointerId: 1 });
  fake.emit("pointermove", { x: 20, y: 20, pointerId: 2 });
  fake.emit("pointerup", { x: 20, y: 20, pointerId: 2 });
  expect(editor.drawing).toBe(true);
  fake.emit("pointerup", { x: 30, y: 10, pointerId: 1 });
  expect(editor.getStrokes()).toHaveLength(1);
  expect(editor.getStrokes()[0].points.map((point) => point.x)).toEqual([10, 30]);
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
  expect(changes).toEqual([1, 2, 1, 2]);
});

test("이미 그린 획은 나중에 스타일을 바꿔도 그대로다", () => {
  editor.setStyle({ color: "#111111", strokeWidth: 2, opacity: 0.5 });
  drawStroke();

  editor.setStyle({ color: "#ff0000", strokeWidth: 9, opacity: 1 });
  drawStroke(50);

  const [first, second] = editor.getStrokes();
  expect(first.style).toMatchObject({ color: "#111111", strokeWidth: 2, opacity: 0.5 });
  expect(second.style).toMatchObject({ color: "#ff0000", strokeWidth: 9, opacity: 1 });
});

test("지우개로 쪼갠 조각은 원래 획의 스타일을 물려받는다", () => {
  editor.setStyle({ color: "#00ff00", strokeWidth: 7 });
  drawStroke(10);
  const before = editor.getStrokes()[0].style;

  editor.tool = "eraser";
  editor.setStyle({ eraserWidth: 4, color: "#0000ff" });
  fake.emit("pointerdown", { x: 20, y: 10 });
  fake.emit("pointerup", { x: 20, y: 10 });

  for (const stroke of editor.getStrokes()) {
    expect(stroke.style).toEqual(before);
  }
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
  expect(changes).toEqual([1, 0]);
  editor.undo();
  expect(editor.getStrokes()).toHaveLength(1);
});

test("지우개 커서는 지우는 동안만 그려진다", () => {
  editor.tool = "eraser";
  const beforeGesture = fake.cursorDrawCount;

  fake.emit("pointerdown", { x: 100, y: 100 });
  fake.emit("pointermove", { x: 120, y: 100 });
  globals.flushFrames();
  expect(fake.cursorDrawCount).toBeGreaterThan(beforeGesture);

  // 펜을 떼면 그 자리에서 커서 없이 다시 그린다.
  fake.emit("pointerup", { x: 140, y: 100 });
  const afterRelease = fake.cursorDrawCount;
  globals.flushFrames();
  editor.resize();
  expect(fake.cursorDrawCount).toBe(afterRelease);
});

test("아무것도 지우지 않은 지우개 동작은 이력을 남기지 않는다", () => {
  drawStroke(10);
  editor.undo();
  expect(editor.canUndo).toBe(false);

  editor.tool = "eraser";
  fake.emit("pointerdown", { x: 300, y: 150 });
  fake.emit("pointerup", { x: 300, y: 150 });
  expect(editor.canUndo).toBe(false);
  expect(changes).toEqual([1, 0]);
});

test("포인터 캡처가 실패해도 획은 계속 기록된다", () => {
  const failing = createFakeCanvas(400, 200, { failPointerCapture: true });
  const captureless = createInkEditor(failing.canvas);
  try {
    failing.emit("pointerdown", { x: 10, y: 10 });
    failing.emit("pointermove", { x: 20, y: 10 });
    failing.emit("pointerup", { x: 30, y: 10 });
    // 캡처 실패로 pointerDown이 중단되면 획이 아예 안 생기고 이후 입력도 먹힌다.
    expect(captureless.getStrokes()[0]?.points.map((point) => point.x)).toEqual([10, 20, 30]);

    failing.emit("pointerdown", { x: 10, y: 50, pointerId: 2 });
    failing.emit("pointerup", { x: 30, y: 50, pointerId: 2 });
    expect(captureless.getStrokes()).toHaveLength(2);
  } finally {
    captureless.destroy();
  }
});

test("getStrokes는 내부 상태와 분리된 복사본을 준다", () => {
  drawStroke();
  const strokes = editor.getStrokes();
  strokes[0].points[0].x = 999;
  expect(editor.getStrokes()[0].points[0].x).toBe(10);
});

test("recordHistory: false로 넣은 획은 되돌리기 이력을 더럽히지 않는다", () => {
  editor.setStrokes([{ points: [{ x: 1, y: 2, t: 0 }], style: editorStrokeStyle() }], {
    recordHistory: false,
  });
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
