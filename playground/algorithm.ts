import "./styles.css";
import "./algorithm.css";
import packageJson from "../package.json" with { type: "json" };
import {
  RESAMPLE_STEP,
  distanceToSegment,
  eraseStrokes,
  intersectsEraser,
  resample,
  segmentDistance,
} from "../src/erase.ts";
import {
  MIN_POINT_DISTANCE,
  drawOutlineStroke,
  pressureWidth,
  smoothSamples,
  type OutlineSample,
} from "../src/outline.ts";
import type { InkPoint, Point, Stroke } from "../src/types.ts";

// 계산은 전부 src의 실제 함수가 한다. 이 파일은 그 중간 결과를 그리기만 한다.

interface Step {
  title: string;
  desc: string;
}

const INK = "#1d4ed8";
const FAINT_INK = "rgba(29, 78, 216, 0.12)";
const LEFT_COLOR = "#2563eb";
const RIGHT_COLOR = "#ea580c";
const CAP_COLOR = "#9333ea";
const HIT_COLOR = "#dc2626";
const KEEP_COLOR = "#16a34a";
const FRAGMENT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#ca8a04"];

const PEN_STEPS: Step[] = [
  {
    title: "1. 입력 점",
    desc: "pointermove(뭉친 이벤트 포함)마다 {x, y, t, pressure} 점이 쌓입니다. 점 색이 진할수록 필압이 높습니다. 빠르게 그은 구간은 점 사이가 벌어집니다.",
  },
  {
    title: "2. 가까운 점 거르기",
    desc: `outline.ts · smoothSamples() — 직전 점과 ${MIN_POINT_DISTANCE}px보다 가까운 점은 버립니다(빨간 ×). 펜이 거의 멈춘 자리에서 법선 방향이 튀는 것을 막습니다.`,
  },
  {
    title: "3. 점마다 반지름",
    desc: "pressureWidth()로 필압을 목표 반지름(점선)으로 바꾸고, 실제 반지름(실선)은 직전 값 65% + 목표 35%로 천천히 따라갑니다. 필압이 급히 바뀌어도 굵기가 계단처럼 튀지 않습니다.",
  },
  {
    title: "4. 법선과 좌우 점",
    desc: "drawOutlineStroke() — 앞뒤 점을 잇는 방향에 수직인 법선을 구하고, 중심에서 반지름만큼 양쪽으로 나간 왼쪽 점(파랑)과 오른쪽 점(주황)을 만듭니다.",
  },
  {
    title: "5. 윤곽 잇기",
    desc: "왼쪽 점을 순서대로 → 끝 반원 캡(보라) → 오른쪽 점을 거꾸로 → 시작 반원 캡으로 한 바퀴 돌아 닫힌 경로를 만듭니다.",
  },
  {
    title: "6. 채우기",
    desc: "닫힌 경로를 fill() 하면 화면에 보이는 획이 됩니다. 실제 에디터는 펜이 움직이는 동안 매 프레임(requestAnimationFrame) 캔버스를 비우고 모든 획을 이 방식으로 다시 그립니다 — '진행' 슬라이더나 ▶로 확인해 보세요.",
  },
];

const ERASER_STEPS: Step[] = [
  {
    title: "1. 지우개 선분",
    desc: "에디터는 pointermove마다 직전 위치→현재 위치 선분을 지우개 지름만큼 두껍게 본 캡슐로 eraseStrokes()를 부릅니다. 여기서는 그 선분 하나를 크게 보여줍니다. 캔버스를 끌어 선분을 바꿔 보세요.",
  },
  {
    title: "2. 닿은 획 찾기",
    desc: "erase.ts · intersectsEraser() — 획의 선분마다 segmentDistance()로 지우개 선분과의 최단 거리를 재고, 하나라도 반지름 이하이면 그 획은 손볼 대상입니다(빨강). 나머지 획은 그대로 통과합니다.",
  },
  {
    title: "3. 촘촘히 다시 나누기",
    desc: `resample() — 빠르게 그어 점 사이가 먼 획도 정확히 자르도록, 닿은 획을 ${RESAMPLE_STEP}px 간격으로 보간한 점(작은 점)으로 다시 만듭니다. 큰 빈 원은 원래 점입니다.`,
  },
  {
    title: "4. 안/밖 판정",
    desc: "splitOutsideEraser() — 다시 나눈 점마다 distanceToSegment()가 반지름 이하이면 지울 점(빨강), 아니면 남길 점(초록)입니다.",
  },
  {
    title: "5. 조각 만들기",
    desc: "남길 점이 연속된 구간마다 새 획 조각이 됩니다(점 2개 미만 구간은 버림). 조각은 원래 획의 스타일을 물려받습니다. 색이 다른 것이 서로 다른 조각입니다.",
  },
];

const penCanvas = element<HTMLCanvasElement>("pen-canvas");
const penContext = context2d(penCanvas);
const penWidthInput = element<HTMLInputElement>("pen-width");
const penProgressInput = element<HTMLInputElement>("pen-progress");
const eraserCanvas = element<HTMLCanvasElement>("eraser-canvas");
const eraserContext = context2d(eraserCanvas);
const eraserSizeInput = element<HTMLInputElement>("eraser-size");

let penStep = 0;
let penPoints: InkPoint[] = [];
let penDrawing = false;
let penPlayFrame: number | undefined;

let eraserStep = 0;
let eraserStrokes: Stroke[] = [];
let eraserFrom: Point = { x: 0, y: 0 };
let eraserTo: Point = { x: 0, y: 0 };
let eraserDragging = false;

element<HTMLElement>("app-version").textContent = `v${packageJson.version}`;

buildStepButtons("pen-steps", PEN_STEPS, (index) => {
  penStep = index;
  renderPen();
});
buildStepButtons("eraser-steps", ERASER_STEPS, (index) => {
  eraserStep = index;
  renderEraser();
});

penWidthInput.addEventListener("input", renderPen);
penProgressInput.addEventListener("input", () => {
  stopPenPlay();
  renderPen();
});
element("pen-play").addEventListener("click", playPen);
eraserSizeInput.addEventListener("input", renderEraser);
element("eraser-apply").addEventListener("click", () => {
  eraserStrokes = currentErase().strokes;
  renderEraser();
});
element("eraser-reset").addEventListener("click", () => {
  resetEraser();
  renderEraser();
});

penCanvas.addEventListener("pointerdown", (event) => {
  stopPenPlay();
  penCanvas.setPointerCapture(event.pointerId);
  penDrawing = true;
  penPoints = [inkPointOf(event)];
  syncPenProgress(true);
  renderPen();
});
penCanvas.addEventListener("pointermove", (event) => {
  if (!penDrawing) return;
  for (const sample of event.getCoalescedEvents?.() ?? [event]) penPoints.push(inkPointOf(sample));
  syncPenProgress(true);
  renderPen();
});
penCanvas.addEventListener("pointerup", () => (penDrawing = false));
penCanvas.addEventListener("pointercancel", () => (penDrawing = false));

eraserCanvas.addEventListener("pointerdown", (event) => {
  eraserCanvas.setPointerCapture(event.pointerId);
  eraserDragging = true;
  eraserFrom = pointOf(event, eraserCanvas);
  eraserTo = eraserFrom;
  renderEraser();
});
eraserCanvas.addEventListener("pointermove", (event) => {
  if (!eraserDragging) return;
  eraserTo = pointOf(event, eraserCanvas);
  renderEraser();
});
eraserCanvas.addEventListener("pointerup", () => (eraserDragging = false));
eraserCanvas.addEventListener("pointercancel", () => (eraserDragging = false));

let initialized = false;
new ResizeObserver(() => {
  fitCanvas(penCanvas, penContext);
  fitCanvas(eraserCanvas, eraserContext);
  if (!initialized) {
    initialized = true;
    penPoints = samplePenStroke(penCanvas.clientWidth, penCanvas.clientHeight);
    syncPenProgress(true);
    resetEraser();
  }
  renderPen();
  renderEraser();
}).observe(document.body);

/* ---------- 펜 ---------- */

function renderPen(): void {
  const width = Number(penWidthInput.value);
  element("pen-width-value").textContent = `${width}px`;
  const context = penContext;
  clear(context, penCanvas);

  const points = penPoints.slice(0, Number(penProgressInput.value));
  if (points.length === 0) return;
  const samples = smoothSamples(points, width);

  if (penStep < 5) {
    context.fillStyle = FAINT_INK;
    drawOutlineStroke(context, points, width);
  }

  let readout = "";
  switch (penStep) {
    case 0: {
      polyline(context, points, "#94a3b8", 1);
      for (const point of points) dot(context, point, 3, pressureColor(point.pressure));
      const pressures = points.map((point) => point.pressure ?? 0.5);
      readout = `점 ${points.length}개 · 필압 ${Math.min(...pressures).toFixed(2)}~${Math.max(...pressures).toFixed(2)}`;
      break;
    }
    case 1: {
      const dropped = droppedPoints(points, samples);
      for (const sample of samples) dot(context, sample, 2.5, "#334155");
      for (const point of dropped) cross(context, point, 5, HIT_COLOR);
      readout = `남은 점 ${samples.length}개 · 버린 점 ${dropped.length}개`;
      break;
    }
    case 2: {
      for (const sample of samples) {
        const target = pressureWidth(width, pointNear(points, sample).pressure) / 2;
        circle(context, sample, target, RIGHT_COLOR, [3, 3]);
        circle(context, sample, sample.radius, LEFT_COLOR);
        dot(context, sample, 1.5, "#334155");
      }
      const radii = samples.map((sample) => sample.radius);
      readout = `반지름 ${Math.min(...radii).toFixed(1)}~${Math.max(...radii).toFixed(1)}px (최대 굵기 ${width}px의 절반까지)`;
      break;
    }
    case 3: {
      const { left, right } = outlineSides(samples);
      polyline(context, samples, "#94a3b8", 1);
      for (let index = 0; index < samples.length; index += 1) {
        segment(context, left[index], right[index], "#64748b", 1);
        dot(context, left[index], 2.5, LEFT_COLOR);
        dot(context, right[index], 2.5, RIGHT_COLOR);
      }
      readout = `법선 ${samples.length}개 → 왼쪽 점 ${left.length}개 + 오른쪽 점 ${right.length}개`;
      break;
    }
    case 4: {
      drawOutlinePath(context, samples);
      readout = `윤곽 꼭짓점 ${samples.length * 2}개 + 반원 캡 2개`;
      break;
    }
    default: {
      context.fillStyle = INK;
      drawOutlineStroke(context, points, width);
      readout = `fill() 1번으로 획 하나 완성 · 입력 점 ${points.length}개`;
    }
  }
  element("pen-readout").textContent = readout;
  element("pen-desc").textContent = PEN_STEPS[penStep].desc;
}

/** drawOutlineStroke() 안에서 좌우 외곽점을 구하는 계산과 같은 식이다. */
function outlineSides(samples: readonly OutlineSample[]): { left: Point[]; right: Point[] } {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    const distance = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    const normalX = -(after.y - before.y) / distance;
    const normalY = (after.x - before.x) / distance;
    left.push({ x: sample.x + normalX * sample.radius, y: sample.y + normalY * sample.radius });
    right.push({ x: sample.x - normalX * sample.radius, y: sample.y - normalY * sample.radius });
  }
  return { left, right };
}

function drawOutlinePath(
  context: CanvasRenderingContext2D,
  samples: readonly OutlineSample[],
): void {
  if (samples.length < 2) return;
  const { left, right } = outlineSides(samples);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const startAngle = Math.atan2(samples[1].y - first.y, samples[1].x - first.x);
  const endAngle = Math.atan2(
    last.y - samples[samples.length - 2].y,
    last.x - samples[samples.length - 2].x,
  );

  polyline(context, left, LEFT_COLOR, 2);
  polyline(context, right, RIGHT_COLOR, 2);
  context.save();
  context.strokeStyle = CAP_COLOR;
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(last.x, last.y, last.radius, endAngle + Math.PI / 2, endAngle - Math.PI / 2, true);
  context.stroke();
  context.beginPath();
  context.arc(
    first.x,
    first.y,
    first.radius,
    startAngle - Math.PI / 2,
    startAngle + Math.PI / 2,
    true,
  );
  context.stroke();
  context.restore();
  dot(context, left[0], 4, LEFT_COLOR);
  label(context, "시작", { x: first.x, y: first.y - first.radius - 10 });
  label(context, "끝", { x: last.x, y: last.y - last.radius - 10 });
}

/** smoothSamples()가 건너뛴 입력 점. 남은 점은 원래 좌표를 그대로 갖고 있어 좌표로 맞춘다. */
function droppedPoints(points: readonly InkPoint[], samples: readonly OutlineSample[]): InkPoint[] {
  const dropped: InkPoint[] = [];
  let next = 0;
  for (const point of points) {
    const sample = samples[next];
    if (sample && sample.x === point.x && sample.y === point.y) next += 1;
    else dropped.push(point);
  }
  return dropped;
}

function pointNear(points: readonly InkPoint[], sample: Point): InkPoint {
  return points.find((point) => point.x === sample.x && point.y === sample.y) ?? points[0];
}

function syncPenProgress(toEnd: boolean): void {
  penProgressInput.max = String(Math.max(1, penPoints.length));
  if (toEnd) penProgressInput.value = penProgressInput.max;
}

function playPen(): void {
  stopPenPlay();
  const total = penPoints.length;
  const started = performance.now();
  const tick = (now: number) => {
    // 실제 입력 시각(t)을 따라 재생해, 빠르게 그은 구간이 실제로도 빨리 지나가게 한다.
    const elapsed = now - started;
    const t0 = penPoints[0].t;
    let count = 1;
    while (count < total && penPoints[count].t - t0 <= elapsed) count += 1;
    penProgressInput.value = String(count);
    renderPen();
    penPlayFrame = count < total ? requestAnimationFrame(tick) : undefined;
  };
  penPlayFrame = requestAnimationFrame(tick);
}

function stopPenPlay(): void {
  if (penPlayFrame !== undefined) cancelAnimationFrame(penPlayFrame);
  penPlayFrame = undefined;
}

/** 필압이 오르내리고, 가운데는 빨리 긋고, 중간에 펜이 잠깐 멈춘 예시 획. */
function samplePenStroke(width: number, height: number): InkPoint[] {
  const points: InkPoint[] = [];
  let t = 0;
  for (let u = 0; u <= 1;) {
    const x = width * (0.1 + 0.8 * u);
    const y = height * (0.5 + 0.28 * Math.sin(u * Math.PI * 2.2));
    const pressure = 0.15 + 0.75 * Math.sin(u * Math.PI) ** 0.7;
    points.push({ x, y, t, pressure });
    if (points.length === 20 || points.length === 55) {
      // 펜이 거의 멈춘 자리: 0.35px 안쪽으로 점이 몇 개 더 들어온다.
      for (let k = 1; k <= 3; k += 1) points.push({ x: x + 0.08 * k, y, t: (t += 8), pressure });
    }
    // 가운데로 갈수록 빨리 그어 점 간격이 넓어진다.
    u += 0.006 + 0.014 * Math.sin(u * Math.PI);
    t += 8;
  }
  return points;
}

/* ---------- 지우개 ---------- */

function renderEraser(): void {
  const diameter = Number(eraserSizeInput.value);
  const radius = diameter / 2;
  element("eraser-size-value").textContent = `${diameter}px`;
  const context = eraserContext;
  clear(context, eraserCanvas);

  const hits = eraserStrokes.filter((stroke) =>
    intersectsEraser(stroke.points, eraserFrom, eraserTo, radius),
  );
  const isHit = (stroke: Stroke) => hits.includes(stroke);

  let readout = "";
  switch (eraserStep) {
    case 0: {
      for (const stroke of eraserStrokes) fillStroke(context, stroke, INK);
      capsule(context, eraserFrom, eraserTo, radius, true);
      readout = `선분 길이 ${Math.hypot(eraserTo.x - eraserFrom.x, eraserTo.y - eraserFrom.y).toFixed(0)}px · 반지름 ${radius}px · 획 ${eraserStrokes.length}개`;
      break;
    }
    case 1: {
      capsule(context, eraserFrom, eraserTo, radius, false);
      for (const stroke of eraserStrokes) {
        fillStroke(context, stroke, isHit(stroke) ? "rgba(220, 38, 38, 0.35)" : FAINT_INK);
        if (!isHit(stroke)) continue;
        const points = stroke.points;
        for (let index = 1; index < points.length; index += 1) {
          if (segmentDistance(points[index - 1], points[index], eraserFrom, eraserTo) <= radius) {
            segment(context, points[index - 1], points[index], HIT_COLOR, 3);
          }
        }
      }
      readout = `닿은 획 ${hits.length}개 / 전체 ${eraserStrokes.length}개 · 굵은 빨강은 반지름 안에 든 획 선분`;
      break;
    }
    case 2: {
      capsule(context, eraserFrom, eraserTo, radius, false);
      let before = 0;
      let after = 0;
      for (const stroke of eraserStrokes) {
        fillStroke(context, stroke, FAINT_INK);
        if (!isHit(stroke)) continue;
        const sampled = resample(stroke.points);
        before += stroke.points.length;
        after += sampled.length;
        for (const point of sampled) dot(context, point, 1.2, "#334155");
        for (const point of stroke.points) circle(context, point, 3.5, "#64748b");
      }
      readout = hits.length ? `닿은 획의 점 ${before}개 → ${after}개` : "닿은 획이 없습니다";
      break;
    }
    case 3: {
      capsule(context, eraserFrom, eraserTo, radius, false);
      let inside = 0;
      let outside = 0;
      for (const stroke of eraserStrokes) {
        fillStroke(context, stroke, FAINT_INK);
        if (!isHit(stroke)) continue;
        for (const point of resample(stroke.points)) {
          const erased = distanceToSegment(point, eraserFrom, eraserTo) <= radius;
          if (erased) inside += 1;
          else outside += 1;
          dot(context, point, 1.6, erased ? HIT_COLOR : KEEP_COLOR);
        }
      }
      readout = `지울 점 ${inside}개 · 남길 점 ${outside}개`;
      break;
    }
    default: {
      capsule(context, eraserFrom, eraserTo, radius, false);
      const result = currentErase();
      let color = 0;
      let fragments = 0;
      for (const stroke of result.strokes) {
        if (eraserStrokes.includes(stroke)) {
          fillStroke(context, stroke, FAINT_INK);
          continue;
        }
        fragments += 1;
        fillStroke(context, stroke, FRAGMENT_COLORS[color++ % FRAGMENT_COLORS.length]);
      }
      readout = `획 ${eraserStrokes.length}개 → ${result.strokes.length}개 (새 조각 ${fragments}개, changed: ${result.changed})`;
    }
  }
  element("eraser-readout").textContent = readout;
  element("eraser-desc").textContent = ERASER_STEPS[eraserStep].desc;
}

function currentErase(): { strokes: Stroke[]; changed: boolean } {
  return eraseStrokes(eraserStrokes, eraserFrom, eraserTo, Number(eraserSizeInput.value));
}

function resetEraser(): void {
  const width = eraserCanvas.clientWidth;
  const height = eraserCanvas.clientHeight;
  const stroke = (from: Point, to: Point, bend: number): Stroke => {
    const points: InkPoint[] = [];
    for (let index = 0; index <= 24; index += 1) {
      const u = index / 24;
      points.push({
        x: from.x + (to.x - from.x) * u,
        y: from.y + (to.y - from.y) * u + Math.sin(u * Math.PI * 2) * bend,
        t: index * 16,
        pressure: 0.3 + 0.6 * Math.sin(u * Math.PI),
      });
    }
    return { points, style: { color: INK, strokeWidth: 10, widthMode: "pressure", opacity: 1 } };
  };
  eraserStrokes = [
    stroke({ x: width * 0.08, y: height * 0.28 }, { x: width * 0.92, y: height * 0.28 }, 18),
    stroke({ x: width * 0.08, y: height * 0.62 }, { x: width * 0.92, y: height * 0.62 }, -22),
    stroke({ x: width * 0.2, y: height * 0.88 }, { x: width * 0.85, y: height * 0.12 }, 0),
  ];
  eraserFrom = { x: width * 0.3, y: height * 0.12 };
  eraserTo = { x: width * 0.42, y: height * 0.85 };
}

function fillStroke(context: CanvasRenderingContext2D, stroke: Stroke, color: string): void {
  context.fillStyle = color;
  drawOutlineStroke(context, stroke.points, stroke.style.strokeWidth);
}

function capsule(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  radius: number,
  emphasize: boolean,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.save();
  context.beginPath();
  context.arc(from.x, from.y, radius, angle + Math.PI / 2, angle - Math.PI / 2);
  context.arc(to.x, to.y, radius, angle - Math.PI / 2, angle + Math.PI / 2);
  context.closePath();
  context.fillStyle = emphasize ? "rgba(100, 116, 139, 0.18)" : "rgba(100, 116, 139, 0.08)";
  context.strokeStyle = "#64748b";
  context.setLineDash([5, 4]);
  context.fill();
  context.stroke();
  context.restore();
  segment(context, from, to, "#334155", 1.5);
  dot(context, from, 4, "#334155");
  dot(context, to, 4, "#334155");
  if (emphasize) {
    label(context, "from", { x: from.x, y: from.y - 10 });
    label(context, "to", { x: to.x, y: to.y - 10 });
  }
}

/* ---------- 공통 그리기 ---------- */

function buildStepButtons(
  id: string,
  steps: readonly Step[],
  onSelect: (index: number) => void,
): void {
  const group = element(id);
  const buttons = steps.map((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = step.title;
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => {
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
      onSelect(index);
    });
    return button;
  });
  group.append(...buttons);
}

function fitCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function clear(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

function dot(context: CanvasRenderingContext2D, point: Point, radius: number, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}

function circle(
  context: CanvasRenderingContext2D,
  point: Point,
  radius: number,
  color: string,
  dash: number[] = [],
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash(dash);
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function cross(context: CanvasRenderingContext2D, point: Point, size: number, color: string): void {
  segment(
    context,
    { x: point.x - size, y: point.y - size },
    { x: point.x + size, y: point.y + size },
    color,
    2,
  );
  segment(
    context,
    { x: point.x - size, y: point.y + size },
    { x: point.x + size, y: point.y - size },
    color,
    2,
  );
}

function segment(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  width: number,
): void {
  polyline(context, [from, to], color, width);
}

function polyline(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  width: number,
): void {
  if (points.length === 0) return;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
}

function label(context: CanvasRenderingContext2D, text: string, point: Point): void {
  context.fillStyle = "#334155";
  context.font = "12px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(text, point.x, point.y);
}

function pressureColor(pressure = 0.5): string {
  const lightness = 80 - 55 * pressure;
  return `hsl(221 83% ${lightness}%)`;
}

function inkPointOf(event: PointerEvent): InkPoint {
  return { ...pointOf(event, penCanvas), t: event.timeStamp, pressure: event.pressure };
}

function pointOf(event: PointerEvent, canvas: HTMLCanvasElement): Point {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D 컨텍스트를 얻지 못했습니다.");
  return context;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} 요소가 없습니다.`);
  return found as T;
}
