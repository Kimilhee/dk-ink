import { expect, test } from "vite-plus/test";
import { cloneStrokes, InkHistory } from "../src/history.ts";
import type { Stroke } from "../src/types.ts";

const a: Stroke[] = [[{ x: 0, y: 0, t: 0 }]];
const b: Stroke[] = [[{ x: 1, y: 1, t: 1 }]];

test("되돌리고 다시 실행한다", () => {
  const history = new InkHistory(10);
  expect(history.canUndo).toBe(false);

  history.commit(a);
  expect(history.undo(b)).toEqual(a);
  expect(history.canUndo).toBe(false);
  expect(history.redo(a)).toEqual(b);
});

test("새로 편집하면 다시 실행 가지는 버려진다", () => {
  const history = new InkHistory(10);
  history.commit(a);
  history.undo(b);
  expect(history.canRedo).toBe(true);

  history.commit(a);
  expect(history.canRedo).toBe(false);
});

test("스택 깊이를 넘으면 오래된 것부터 버린다", () => {
  const history = new InkHistory(1);
  history.commit(a);
  history.commit(b);
  expect(history.undo([])).toEqual(b);
  expect(history.canUndo).toBe(false);
});

test("스냅샷은 원본과 분리된다", () => {
  const source: Stroke[] = [[{ x: 0, y: 0, t: 0 }]];
  const copy = cloneStrokes(source);
  source[0][0].x = 99;
  expect(copy[0][0].x).toBe(0);
});
