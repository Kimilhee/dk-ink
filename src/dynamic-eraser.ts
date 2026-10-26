import type { InkPoint } from "./types.ts";

/** 지름(px). 느리게 움직일 때와 빠르게 문지를 때의 양 끝. */
const MIN_DIAMETER = 20;
const MAX_DIAMETER = 180;
/** 속도(px/ms). `MIN_SPEED` 이하는 항상 최소 지름, `MAX_SPEED` 이상은 항상 최대 지름. */
const MIN_SPEED = 0.4;
const MAX_SPEED = 2.5;
/** 커질 때와 작아질 때의 시간 상수(ms). 커지는 쪽이 빨라야 하고, 작아지는 쪽은 느려야 한다. */
const TAU_UP = 150;
const TAU_DOWN = 400;

export type DynamicEraser = {
  /** 점을 받아 그 점에서의 지우개 지름(px)을 돌려준다. 첫 점은 최소 지름이다. */
  next(point: InkPoint): number;
  /** 새 제스처를 위해 속도 기억을 비운다. */
  reset(): void;
};

/**
 * 펜 이동 속도에 따라 지우개 지름을 연속으로 바꾼다.
 *
 * 속도를 시간 기반 비대칭 EMA로 다듬는다 — 계수를 경과 시간으로 정하므로 이벤트 빈도(60Hz/240Hz)와
 * 무관하다. 멈춘 채 대고 있을 때를 위한 타이머는 없다: 다음 이동 때 긴 간격이 그대로 반영돼 줄어든다.
 */
export function createDynamicEraser(): DynamicEraser {
  let previous: InkPoint | undefined;
  let smoothed = 0;

  return {
    next(point) {
      if (previous) {
        const elapsed = Math.max(point.t - previous.t, 1);
        const instant = Math.hypot(point.x - previous.x, point.y - previous.y) / elapsed;
        const tau = instant > smoothed ? TAU_UP : TAU_DOWN;
        smoothed += (1 - Math.exp(-elapsed / tau)) * (instant - smoothed);
      }
      previous = point;
      const ratio = Math.min(Math.max((smoothed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0), 1);
      return MIN_DIAMETER + (MAX_DIAMETER - MIN_DIAMETER) * ratio;
    },
    reset() {
      previous = undefined;
      smoothed = 0;
    },
  };
}
