import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createInkEditor, type InkEditor } from "../src/index.ts";
import { createFakeCanvas, installBrowserGlobals, type BrowserGlobals } from "./fake-canvas.ts";

let fake: ReturnType<typeof createFakeCanvas>;
let globals: BrowserGlobals;
let editor: InkEditor;

beforeEach(() => {
  vi.useFakeTimers();
  globals = installBrowserGlobals();
  fake = createFakeCanvas();
  editor = createInkEditor(fake.canvas);
});

afterEach(() => {
  editor.destroy();
  globals.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** (10,20)에서 오른쪽으로 거의 곧게 긋는다. */
function drawNearlyStraight(): void {
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit("pointermove", { x: 40, y: 22 });
  fake.emit("pointermove", { x: 70, y: 19 });
  fake.emit("pointermove", { x: 100, y: 21 });
}

test("곧게 긋고 끝에서 0.7초 멈추면 시작점과 끝점을 잇는 직선이 되고, 떼기 전까지 끝점이 따라온다", () => {
  drawNearlyStraight();
  fake.emit("pointermove", { x: 104, y: 21 });
  vi.advanceTimersByTime(699);
  expect(editor.getStrokes()[0].points).toHaveLength(5);
  vi.advanceTimersByTime(1);
  expect(editor.getStrokes()[0].points).toMatchObject([
    { x: 10, y: 20 },
    { x: 104, y: 21 },
  ]);

  fake.emit("pointermove", { x: 130, y: 60 });
  fake.emit("pointerup", { x: 140, y: 70 });
  const [stroke] = editor.getStrokes();
  expect(stroke.points).toMatchObject([
    { x: 10, y: 20 },
    { x: 140, y: 70 },
  ]);
  expect(stroke.style.widthMode).toBe("constant");
  editor.undo();
  expect(editor.getStrokes()).toEqual([]);
  editor.redo();
  expect(editor.getStrokes()).toEqual([stroke]);
});

test("시작점에서 오래 누른 뒤 글씨를 써도 직선이 되지 않는다", () => {
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit("pointermove", { x: 14, y: 20 });
  vi.advanceTimersByTime(2000);
  fake.emit("pointermove", { x: 40, y: 60 });
  fake.emit("pointermove", { x: 20, y: 90 });
  fake.emit("pointerup", { x: 50, y: 90 });
  expect(editor.getStrokes()[0].points).toHaveLength(5);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test("꺾인 획은 끝에서 멈춰도 자유 필기를 유지한다", () => {
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit("pointermove", { x: 100, y: 20 });
  fake.emit("pointermove", { x: 100, y: 110 });
  vi.advanceTimersByTime(2000);
  fake.emit("pointerup", { x: 100, y: 110 });
  expect(editor.getStrokes()[0].points).toHaveLength(4);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test("멈추지 않고 계속 움직이면 대기 시간이 다시 시작된다", () => {
  drawNearlyStraight();
  vi.advanceTimersByTime(600);
  fake.emit("pointermove", { x: 130, y: 20 });
  vi.advanceTimersByTime(600);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  vi.advanceTimersByTime(100);
  expect(editor.getStrokes()[0].points).toMatchObject([
    { x: 10, y: 20 },
    { x: 130, y: 20 },
  ]);
});

test("옵션을 끄면 끝에서 멈춰도 자유 필기로 그린다", () => {
  editor.setStyle({ holdToStraightLine: false });
  drawNearlyStraight();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(3000);
  fake.emit("pointerup", { x: 100, y: 21 });
  expect(editor.getStrokes()[0].points).toHaveLength(5);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test.each(["pointerup", "pointercancel"])("%s 후에는 대기 중인 타이머가 남지 않는다", (event) => {
  drawNearlyStraight();
  fake.emit(event, { x: 100, y: 21 });
  expect(vi.getTimerCount()).toBe(0);
});

test("획 교체와 에디터 해제는 타이머와 표시점을 정리한다", () => {
  fake.emit("pointerdown", { x: 10, y: 20 });
  editor.setStrokes([]);
  expect(vi.getTimerCount()).toBe(0);
  drawNearlyStraight();
  vi.advanceTimersByTime(2000);
  const arc = vi.spyOn(fake.canvas.getContext("2d")!, "arc");
  editor.clear();
  expect(arc).not.toHaveBeenCalled();
  fake.emit("pointerdown", { x: 10, y: 20 });
  editor.destroy();
  expect(vi.getTimerCount()).toBe(0);
});

test("지우개는 오래 눌러도 직선 모드로 바뀌지 않는다", () => {
  editor.tool = "eraser";
  fake.emit("pointerdown", { x: 10, y: 20 });
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(2000);
  fake.emit("pointerup", { x: 100, y: 70 });
  expect(editor.getStrokes()).toEqual([]);
});

test.each([500, 700, 1500])("설정한 %dms 동안 멈춰야 직선이 된다", (delay) => {
  editor.setStyle({ straightLineDelay: delay });
  drawNearlyStraight();
  vi.advanceTimersByTime(delay - 1);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
  vi.advanceTimersByTime(1);
  expect(editor.getStrokes()[0].style.widthMode).toBe("constant");
});

test("직선 도구는 기다리지 않고 누른 자리에서 뗀 자리까지 직선을 긋는다", () => {
  editor.tool = "line";
  const arc = vi.spyOn(fake.canvas.getContext("2d")!, "arc");
  fake.emit("pointerdown", { x: 10, y: 20 });
  expect(arc).toHaveBeenCalledWith(10, 20, 6, 0, Math.PI * 2);
  expect(vi.getTimerCount()).toBe(0);
  fake.emit("pointermove", {
    x: 90,
    y: 60,
    coalesced: [
      { x: 40, y: 80 },
      { x: 90, y: 60 },
    ],
  });
  expect(editor.getStrokes()[0].points).toMatchObject([
    { x: 10, y: 20 },
    { x: 90, y: 60 },
  ]);
  fake.emit("pointerup", { x: 100, y: 70 });
  const [stroke] = editor.getStrokes();
  expect(stroke.points).toMatchObject([
    { x: 10, y: 20 },
    { x: 100, y: 70 },
  ]);
  expect(stroke.style.widthMode).toBe("constant");
  expect(fake.canvas.dataset.tool).toBe("line");
});
