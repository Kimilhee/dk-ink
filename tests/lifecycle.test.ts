import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createInkEditor, type InkEditor } from "../src/index.ts";
import { createFakeCanvas, installBrowserGlobals, type BrowserGlobals } from "./fake-canvas.ts";

let fake: ReturnType<typeof createFakeCanvas>;
let globals: BrowserGlobals;
let editor: InkEditor | undefined;

beforeEach(() => {
  globals = installBrowserGlobals();
  fake = createFakeCanvas();
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  globals.restore();
});

test("입력을 막지 않도록 필수 스타일을 건다", () => {
  editor = createInkEditor(fake.canvas);
  expect(fake.canvas.style.getPropertyValue("touch-action")).toBe("none");
  expect(fake.canvas.style.getPropertyValue("user-select")).toBe("none");
  expect(fake.canvas.style.getPropertyValue("-webkit-user-select")).toBe("none");
});

test("destroy는 앱이 걸어둔 인라인 스타일을 되돌린다", () => {
  fake.canvas.style.setProperty("touch-action", "pan-y");
  fake.canvas.style.setProperty("user-select", "text", "important");

  editor = createInkEditor(fake.canvas);
  expect(fake.canvas.style.getPropertyValue("touch-action")).toBe("none");

  editor.destroy();
  editor = undefined;
  expect(fake.canvas.style.getPropertyValue("touch-action")).toBe("pan-y");
  expect(fake.canvas.style.getPropertyValue("user-select")).toBe("text");
  expect(fake.canvas.style.getPropertyPriority("user-select")).toBe("important");
});

test("원래 없던 스타일은 destroy 후에도 없다", () => {
  editor = createInkEditor(fake.canvas);
  editor.destroy();
  editor = undefined;
  expect(fake.canvas.style.getPropertyValue("touch-action")).toBe("");
  expect(fake.canvas.style.getPropertyValue("-webkit-user-select")).toBe("");
});

test("destroy는 data-tool도 부착 이전 값으로 되돌린다", () => {
  expect(fake.canvas.dataset.tool).toBeUndefined();
  editor = createInkEditor(fake.canvas);
  expect(fake.canvas.dataset.tool).toBe("pen");
  editor.destroy();
  editor = undefined;
  expect(fake.canvas.dataset.tool).toBeUndefined();
});

test("붙였다 떼기를 반복해도 캔버스가 더럽혀지지 않는다", () => {
  fake.canvas.style.setProperty("touch-action", "manipulation");
  for (let round = 0; round < 3; round += 1) {
    const attached = createInkEditor(fake.canvas);
    attached.destroy();
  }
  expect(fake.canvas.style.getPropertyValue("touch-action")).toBe("manipulation");
  expect(fake.canvas.dataset.tool).toBeUndefined();
});
