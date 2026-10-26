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

test("2초간 누르면 표시점이 생기고, 움직이는 동안 시작점과 끝점만 잇는다", () => {
  const arc = vi.spyOn(fake.canvas.getContext("2d")!, "arc");
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit("pointermove", { x: 12, y: 21 });
  arc.mockClear();
  vi.advanceTimersByTime(1999);
  expect(arc).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(arc).toHaveBeenCalledWith(10, 20, 6, 0, Math.PI * 2);

  fake.emit("pointermove", {
    x: 90,
    y: 60,
    coalesced: [
      { x: 40, y: 80 },
      { x: 70, y: 10 },
      { x: 90, y: 60 },
    ],
  });
  expect(editor.getStrokes()[0].points).toMatchObject([
    { x: 10, y: 20 },
    { x: 90, y: 60 },
  ]);
  arc.mockClear();
  fake.emit("pointerup", { x: 100, y: 70 });
  editor.resize();
  expect(arc).not.toHaveBeenCalled();
  const [stroke] = editor.getStrokes();
  expect(stroke.points).toMatchObject([
    { x: 10, y: 20 },
    { x: 100, y: 70 },
  ]);
  expect(stroke.style.widthMode).toBe("constant");
  editor.undo();
  expect(editor.getStrokes()).toEqual([]);
  editor.redo();
  expect(editor.getStrokes()).toEqual([stroke]);
});

test("2초 전에 그리기 시작하면 나중에 멈춰도 자유 필기를 유지한다", () => {
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit("pointermove", { x: 30, y: 60 });
  fake.emit("pointermove", { x: 10, y: 20 });
  vi.advanceTimersByTime(2000);
  fake.emit("pointerup", { x: 100, y: 70 });
  expect(editor.getStrokes()[0].points).toHaveLength(4);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test("옵션을 끄면 오래 눌러도 자유 필기로 그린다", () => {
  editor.setStyle({ holdToStraightLine: false });
  fake.emit("pointerdown", { x: 10, y: 20 });
  vi.advanceTimersByTime(3000);
  fake.emit("pointermove", { x: 30, y: 60 });
  fake.emit("pointerup", { x: 100, y: 70 });
  expect(editor.getStrokes()[0].points).toHaveLength(3);
  expect(editor.getStrokes()[0].style.widthMode).toBe("pressure");
});

test.each(["pointerup", "pointercancel"])("%s 후에는 대기 중인 타이머가 남지 않는다", (event) => {
  fake.emit("pointerdown", { x: 10, y: 20 });
  fake.emit(event, { x: 10, y: 20 });
  expect(vi.getTimerCount()).toBe(0);
});

test("획 교체와 에디터 해제는 타이머와 표시점을 정리한다", () => {
  fake.emit("pointerdown", { x: 10, y: 20 });
  editor.setStrokes([]);
  expect(vi.getTimerCount()).toBe(0);
  fake.emit("pointerdown", { x: 10, y: 20 });
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
