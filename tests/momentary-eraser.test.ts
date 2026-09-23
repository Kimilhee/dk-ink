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

test("포인터가 취소되어도 손가락을 떼기 전에는 지우개를 유지한다", () => {
  const hold = new MomentaryEraser();
  hold.start(1);
  hold.cancel(1);
  hold.use();

  expect(hold.finishErase()).toBe(false);
  expect(hold.active).toBe(true);
  expect(hold.release(1)).toBe(true);
});

test("여러 획을 지워도 손가락을 떼기 전에는 지우개를 유지한다", () => {
  const hold = new MomentaryEraser();
  hold.start(1);
  hold.use();
  hold.finishErase();
  hold.use();
  hold.finishErase();

  expect(hold.active).toBe(true);
  expect(hold.release(1)).toBe(true);
});
