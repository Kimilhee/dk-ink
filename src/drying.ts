import { drawInk } from "./render.ts";
import type { Stroke } from "./types.ts";

/**
 * 펜을 뗀 뒤 획이 마르기 시작할 때까지와, 다 마르는 데 걸리는 시간(ms).
 *
 * 마르는 동안은 획을 매 프레임 다시 그리므로, 빨리 이어 쓰면 이 시간 안에 쓴 획이 쌓여 필기가
 * 무거워진다. 대기는 앱 캔버스와 이 층의 출력 시점 차이(한두 프레임)를 덮을 만큼만, 마르기는
 * 색 변화가 눈에 띄지 않을 만큼만 둔다. (v0.1.87: 0.5초+1초에서 줄임)
 */
const DRY_DELAY_MS = 250;
const DRY_DURATION_MS = 500;

export type DryingLayer = {
  /** 펜을 뗀 획을 넣는다. 이때부터 마르기 시작할 때까지는 "젖은" 획이다. */
  add(stroke: Stroke): void;
  /**
   * 아직 마르기 시작하지 않은 획. 앱 캔버스에도 같이 그려야 한다 — 이 층(일반 캔버스)은
   * 앱 캔버스(desynchronized)보다 늦게 화면에 나오므로, 펜을 떼자마자 앱 캔버스에서 지우면
   * 그사이 획이 한 프레임 사라진다. 두 층 모두 불투명하게 보이는 상태라 겹쳐도 변하지 않는다.
   */
  wetStrokes(): Stroke[];
  /** 다 쓴 획 층을 통째로 다시 그려 마르던 획이 그 안에 들어갔을 때. 남기면 두 번 그려진다. */
  reset(): void;
  dispose(): void;
};

export type DryingLayerOptions = {
  context: CanvasRenderingContext2D;
  /** 층의 CSS 픽셀 크기와, 획 아래에 깔 배경색. 크기 변경 때 바뀌므로 그릴 때마다 읽는다. */
  size(): { width: number; height: number };
  background(): string;
  /** 다 마른 획을 다 쓴 획 층으로 넘긴다. 이 층에서 빼는 것과 같은 프레임에 불린다. */
  settle(stroke: Stroke): void;
  /** 젖은 획이 마르기 시작해 앱 캔버스에서 걷어야 할 때. */
  onWetChange(): void;
};

/**
 * 막 끝난 획이 잉크가 마르듯 불투명에서 원래 반투명으로 서서히 바뀌는 층.
 *
 * 획은 문항 글자가 비쳐 보이도록 반투명이다. 그런데 반투명 획을 층 사이로 옮기면 두 층이 화면에
 * 나가는 시점이 달라 잠깐 겹쳐 진해지거나 사라진다. 그래서 쓰는 동안과 펜을 뗀 직후에는 배경을
 * 깔아 불투명하게 보이게 하고(겹쳐도 그대로), 배경을 서서히 걷어 원래 모습으로 돌린다. 다 마르면
 * 같은 일반 캔버스인 다 쓴 획 층으로 옮기므로 그 교체는 같은 프레임에 함께 일어난다.
 */
export function createDryingLayer(options: DryingLayerOptions): DryingLayer {
  const { context } = options;
  let entries: Array<{ stroke: Stroke; endedAt: number }> = [];
  let frame: number | undefined;
  /** 새 획이 들어와 다시 그려야 한다. 마르기 전 대기 중에는 모습이 그대로라 그리지 않는다. */
  let stale = false;
  let wetCount = 0;

  /** 0이면 아직 마르기 전, 1이면 다 마름. */
  function progress(endedAt: number, now: number): number {
    return Math.min(1, Math.max(0, (now - endedAt - DRY_DELAY_MS) / DRY_DURATION_MS));
  }

  function countWet(now: number): number {
    return entries.filter((entry) => progress(entry.endedAt, now) === 0).length;
  }

  function render(now: number): void {
    if (!stale && !entries.some((entry) => progress(entry.endedAt, now) > 0)) return;
    stale = false;
    const { width, height } = options.size();
    context.clearRect(0, 0, width, height);
    entries = entries.filter((entry) => {
      const dried = progress(entry.endedAt, now);
      if (dried < 1) {
        drawInk(context, entry.stroke, 1 - dried, options.background());
        return true;
      }
      options.settle(entry.stroke);
      return false;
    });
  }

  function tick(): void {
    frame = undefined;
    const now = performance.now();
    render(now);
    const wet = countWet(now);
    if (wet !== wetCount) {
      wetCount = wet;
      options.onWetChange();
    }
    schedule();
  }

  function schedule(): void {
    if (entries.length > 0 && frame === undefined) frame = requestAnimationFrame(tick);
  }

  return {
    add(stroke) {
      const now = performance.now();
      entries.push({ stroke, endedAt: now });
      wetCount = countWet(now);
      stale = true;
      render(now);
      schedule();
    },
    wetStrokes() {
      const now = performance.now();
      return entries
        .filter((entry) => progress(entry.endedAt, now) === 0)
        .map((entry) => entry.stroke);
    },
    reset() {
      entries = [];
      wetCount = 0;
      const { width, height } = options.size();
      context.clearRect(0, 0, width, height);
    },
    dispose() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      entries = [];
    },
  };
}
