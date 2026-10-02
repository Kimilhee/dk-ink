/**
 * S펜이 캔버스 위에 떠 있는 동안 포인터 우상단에 연필 아이콘을 띄운다. 아이콘을 펜으로
 * 탭하면 연필이 뒤집히고(180°), 그 상태에서 화면을 문지르면 연필 뒷부분처럼 작은 지우개가
 * 된다. 지운 뒤 펜을 떼면 바로 펜으로 돌아오는 **임시** 지우개다.
 *
 * 에디터 공개 API(`tool`, `setStyle`)만 쓴다. 나중에 라이브러리로 옮길 때 이 파일을 그대로
 * 가져가면 된다.
 */
import type { InkEditor } from "../src/index.ts";
import { watchPenHover } from "./pen-hover.ts";

/** 연필 뒷부분 지우개의 지름. 영구 지우개 설정과는 따로 간다. */
const FLIPPED_ERASER_WIDTH = 20;
/** 아이콘은 펜이 이만큼 전에 있던 자리를 따라온다. 그 사이에 펜으로 아이콘을 누를 수 있다. */
const FOLLOW_DELAY_MS = 500;
/** 펜이 아이콘 위(이 반경 안)에 있으면 누르려는 것으로 보고 아이콘을 멈춘다. */
const HOLD_RADIUS = 24;
/** 포인터에서 아이콘 중심까지의 거리(오른쪽 위). */
const OFFSET = 28;

export interface PenFlip {
  readonly flipped: boolean;
  /** 뒤집힌 연필을 원래대로 돌린다. 도구 모음에서 도구를 바꿀 때 쓴다. */
  unflip(): void;
}

export function attachPenFlip(
  editor: InkEditor,
  stage: HTMLElement,
  onToolChange: () => void,
): PenFlip {
  const canvas = editor.canvas;
  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = "pen-flip";
  icon.textContent = "✎";
  icon.setAttribute("aria-label", "연필 뒤집기(임시 지우개)");
  icon.hidden = true;
  stage.append(icon);

  let flipped = false;
  let savedEraserWidth = 0;
  let erasingPointerId: number | undefined;
  let holding = false;
  /** 아이콘이 보이는 동안 쌓인 이동 예약. 숨길 때 한꺼번에 취소한다. */
  const followTimers = new Set<ReturnType<typeof setTimeout>>();

  function setFlipped(next: boolean): void {
    if (next === flipped) return;
    flipped = next;
    icon.classList.toggle("is-flipped", flipped);
    if (flipped) {
      savedEraserWidth = editor.getStyle().eraserWidth;
      editor.setStyle({ eraserWidth: FLIPPED_ERASER_WIDTH });
      editor.tool = "eraser";
    } else {
      editor.setStyle({ eraserWidth: savedEraserWidth });
      editor.tool = "pen";
      erasingPointerId = undefined;
    }
    onToolChange();
  }

  function hide(): void {
    for (const timer of followTimers) clearTimeout(timer);
    followTimers.clear();
    icon.hidden = true;
  }

  function moveTo(x: number, y: number): void {
    icon.style.left = `${x}px`;
    icon.style.top = `${y}px`;
  }

  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "pen") return;
    // 아이콘을 누르고 있는 동안에는 그대로 둬야 뒤집히는 모습이 보인다.
    if (event.target === icon && event.buttons !== 0) return;
    const overCanvas = event.target === canvas || event.target === icon;
    // 그리는(누르는) 중이거나 영구 지우개일 때는 아이콘이 필요 없다.
    if (!overCanvas || event.buttons !== 0 || (editor.tool !== "pen" && !flipped)) {
      hide();
      return;
    }

    const bounds = stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const targetX = x + OFFSET;
    const targetY = y - OFFSET;

    if (icon.hidden) {
      moveTo(targetX, targetY);
      icon.hidden = false;
      return;
    }
    const iconX = parseFloat(icon.style.left);
    const iconY = parseFloat(icon.style.top);
    holding = Math.hypot(x - iconX, y - iconY) <= HOLD_RADIUS;
    // 이동마다 따로 예약해 0.5초 늦게 같은 궤적을 따라오게 한다. 매번 취소하고 다시 걸면
    // 호버 중 손떨림으로 이벤트가 끊이지 않아 아이콘이 영영 움직이지 않는다.
    const timer = setTimeout(() => {
      followTimers.delete(timer);
      if (!holding) moveTo(targetX, targetY);
    }, FOLLOW_DELAY_MS);
    followTimers.add(timer);
  });

  // 호버가 끝나면(펜을 멀리 들면) 아이콘만 감춘다. 뒤집힌 상태는 다음 획까지 유지한다.
  watchPenHover(
    () => false,
    (near) => {
      if (!near) hide();
    },
  );

  icon.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setFlipped(!flipped);
  });

  // 에디터보다 나중에 등록되므로, 에디터가 지우기를 마무리한 뒤에 펜으로 되돌린다.
  canvas.addEventListener("pointerdown", (event) => {
    if (flipped) erasingPointerId = event.pointerId;
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    canvas.addEventListener(type, (event) => {
      if (flipped && event.pointerId === erasingPointerId) setFlipped(false);
    });
  }

  return {
    get flipped() {
      return flipped;
    },
    unflip: () => setFlipped(false),
  };
}
