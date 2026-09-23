import { expect, test } from "vite-plus/test";
import { MomentaryEraser } from "../playground/momentary-eraser.ts";

test("짧게 누르면 지우개 선택을 유지한다", () => {
  const hold = new MomentaryEraser();
  hold.start(1);

  expect(hold.release(1)).toBe(false);
});

test("누른 동안 캔버스를 사용하면 손을 뗄 때 펜으로 돌아간다", () => {
  const hold = new MomentaryEraser();
  hold.start(1);
  hold.use();

  expect(hold.release(1)).toBe(true);
});

test("손가락이 취소되어도 펜 지우기가 끝나면 펜으로 돌아간다", () => {
  const hold = new MomentaryEraser();
  hold.start(1);
  hold.cancel(1);
  hold.use();

  expect(hold.finishErase()).toBe(true);
});

test("지우기를 시작한 뒤 손가락이 취소되면 즉시 펜으로 돌아간다", () => {
  const hold = new MomentaryEraser();
  hold.start(1);
  hold.use();

  expect(hold.cancel(1)).toBe(true);
});
