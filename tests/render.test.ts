import { expect, test } from "vite-plus/test";
import { pressureWidth } from "../src/render.ts";

test("필압이 0.8이면 최대 굵기에 닿는다", () => {
  expect(pressureWidth(4, 0.8)).toBeCloseTo(4);
  expect(pressureWidth(4, 1)).toBeCloseTo(4);
});

test("필압이 낮을수록 얇아지고 0에서도 굵기가 남는다", () => {
  expect(pressureWidth(4, 0.4)).toBeCloseTo(2.1);
  expect(pressureWidth(4, 0)).toBeCloseTo(0.2);
});

test("필압을 보고하지 않는 입력은 중간 굵기로 그린다", () => {
  expect(pressureWidth(4)).toBeCloseTo(pressureWidth(4, 0.5));
});
