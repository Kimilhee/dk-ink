import { expect, test } from "vite-plus/test";
import {
  type EraserContact,
  isFingerTouch,
  MomentaryEraser,
  type MomentaryEraserEvent,
} from "../playground/momentary-eraser.ts";

const finger = { source: "finger", id: 1 } as const;

test("짧게 누르면 지우개 선택을 유지한다", () => {
  const hold = start(finger);

  expect(release(hold, finger)).toBeUndefined();
  expect(hold.active).toBe(false);
});

test("누른 동안 캔버스를 사용하면 손을 뗄 때 펜으로 돌아간다", () => {
  const hold = start(finger);
  hold.handle({ type: "canvas-used" });

  expect(release(hold, finger)).toBe("pen");
});

test("입력이 취소되어도 손가락을 떼기 전에는 지우개를 유지한다", () => {
  const hold = start(finger);
  hold.handle({ type: "contact-canceled", contact: finger });
  hold.handle({ type: "canvas-used" });

  expect(hold.active).toBe(true);
  expect(release(hold, finger)).toBe("pen");
});

test("여러 획을 지워도 손가락을 떼기 전에는 지우개를 유지한다", () => {
  const hold = start(finger);
  run(hold, { type: "canvas-used" }, { type: "stroke-ended" });
  run(hold, { type: "canvas-used" }, { type: "stroke-ended" });

  expect(hold.active).toBe(true);
  expect(release(hold, finger)).toBe("pen");
});

test("같은 식별자를 재사용한 펜 종료는 손가락 홀드를 끝내지 않는다", () => {
  const hold = start(finger);
  hold.handle({ type: "canvas-used" });

  expect(release(hold, { source: "pointer", id: finger.id })).toBeUndefined();
  expect(hold.active).toBe(true);
  expect(release(hold, finger)).toBe("pen");
});

test("지우개 아이콘 밖에서 끝난 입력은 손가락 홀드를 끝내지 않는다", () => {
  const hold = start(finger);
  hold.handle({ type: "canvas-used" });

  const result = hold.handle({
    type: "contact-released",
    contact: finger,
    overButton: false,
  });

  expect(result).toBeUndefined();
  expect(hold.active).toBe(true);
});

test("스타일러스 Touch 입력은 손가락으로 취급하지 않는다", () => {
  expect(isFingerTouch({ touchType: "stylus" })).toBe(false);
  expect(isFingerTouch({ touchType: "direct" })).toBe(true);
});

function start(contact: EraserContact): MomentaryEraser {
  const hold = new MomentaryEraser();
  expect(hold.handle({ type: "press", contact })).toBe("eraser");
  return hold;
}

function release(hold: MomentaryEraser, contact: EraserContact): "pen" | "eraser" | undefined {
  return hold.handle({ type: "contact-released", contact, overButton: true });
}

function run(hold: MomentaryEraser, ...events: MomentaryEraserEvent[]): void {
  for (const event of events) expect(hold.handle(event)).toBeUndefined();
}
