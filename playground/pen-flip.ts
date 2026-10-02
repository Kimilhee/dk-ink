/**
 * S펜이 캔버스 위에 떠 있는 동안 포인터 좌상단에 연필 아이콘을 띄운다. 아이콘을 펜으로
 * 탭하면 연필이 뒤집히고(180°), 그 상태에서 화면을 문지르면 연필 뒷부분처럼 작은 지우개가
 * 된다. 다시 탭하면 펜으로 돌아온다.
 *
 * 에디터 공개 API(`tool`, `setStyle`)만 쓴다. 나중에 라이브러리로 옮길 때 이 파일을 그대로
 * 가져가면 된다.
 */
import type { InkEditor } from "../src/index.ts";
import { watchPenHover } from "./pen-hover.ts";

/** 연필 뒷부분 지우개의 지름. 영구 지우개 설정과는 따로 간다. */
const FLIPPED_ERASER_WIDTH = 20;
/** 펜이 움직이면 이만큼 뒤에 그때의 펜 옆으로 순간 이동한다. 그 사이에 펜으로 아이콘을 누를 수 있다. */
const FOLLOW_DELAY_MS = 500;
/** 펜이 아이콘 위(이 반경 안)에 있으면 누르려는 것으로 보고 아이콘을 멈춘다. */
const HOLD_RADIUS = 24;
/**
 * 포인터에서 아이콘 중심까지의 거리(왼쪽 위). 오른손 필기는 오른쪽으로 나아가므로 왼쪽에
 * 두어야 쓰다가 아이콘을 잘못 누르지 않는다.
 */
const OFFSET = 56;
/**
 * 뒤집힌 연필(✎)의 지우개 끝이 아이콘 중심에서 떨어진 거리(px, 오른쪽·위가 +). 지우는 동안
 * 이만큼 아이콘을 옮겨 지우개 끝을 지우개 원에 맞춘다. 글리프 모양은 기기 폰트마다 달라
 * 정확한 값이 아니라 기기에서 눈으로 맞출 값이다.
 */
const ERASER_END = 8;

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
  let holding = false;
  /** 필기 중 숨긴 아이콘은 펜을 뗀 뒤 이 시각까지 다시 띄우지 않는다. 획 사이마다 깜빡이지 않게. */
  let hiddenUntil = 0;
  /** 예약된 순간 이동. 하나만 걸고, 실행될 때 가장 최근 펜 위치로 간다. */
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  let followX = 0;
  let followY = 0;

  function cancelFollow(): void {
    if (followTimer !== undefined) clearTimeout(followTimer);
    followTimer = undefined;
  }

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
    }
    onToolChange();
  }

  function hide(): void {
    icon.classList.remove("is-erasing");
    cancelFollow();
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
    // 뒤집힌 연필로 지우는 동안에는 지연 없이 지우개 끝을 펜 끝(지우개 원)에 붙인다.
    if (flipped && event.buttons !== 0 && event.target === canvas) {
      const bounds = stage.getBoundingClientRect();
      cancelFollow();
      icon.classList.add("is-erasing");
      moveTo(event.clientX - bounds.left + ERASER_END, event.clientY - bounds.top - ERASER_END);
      icon.hidden = false;
      return;
    }
    // 그리는(누르는) 중이거나 영구 지우개일 때는 아이콘이 필요 없다.
    if (!overCanvas || event.buttons !== 0 || (editor.tool !== "pen" && !flipped)) {
      hide();
      return;
    }
    if (icon.hidden && performance.now() < hiddenUntil) return;

    const bounds = stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const targetX = x - OFFSET;
    const targetY = y - OFFSET;

    if (icon.hidden) {
      moveTo(targetX, targetY);
      icon.hidden = false;
      return;
    }
    const iconX = parseFloat(icon.style.left);
    const iconY = parseFloat(icon.style.top);
    holding = Math.hypot(x - iconX, y - iconY) <= HOLD_RADIUS;
    followX = targetX;
    followY = targetY;
    // 이미 걸린 예약은 다시 걸지 않는다. 매번 취소하고 다시 걸면 호버 중 손떨림으로 이벤트가
    // 끊이지 않아 아이콘이 영영 움직이지 않는다.
    if (holding || followTimer !== undefined) return;
    followTimer = setTimeout(() => {
      followTimer = undefined;
      if (!holding) moveTo(followX, followY);
    }, FOLLOW_DELAY_MS);
  });

  // 호버가 끝나면(펜을 멀리 들면) 아이콘만 감춘다. 뒤집힌 상태는 다시 탭할 때까지 유지한다.
  watchPenHover(
    () => false,
    (near) => {
      if (!near) hide();
    },
  );

  // 획을 마칠 때마다 다시 나타나는 시점을 미룬다. 아이콘을 탭한 경우는 아이콘이 보이는
  // 중이라 영향이 없다.
  document.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "pen") return;
    // 지우던 자리에 남은 아이콘은 다음 획을 가로막으므로 걷는다.
    if (icon.classList.contains("is-erasing")) hide();
    hiddenUntil = performance.now() + FOLLOW_DELAY_MS;
  });

  icon.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setFlipped(!flipped);
  });

  return {
    get flipped() {
      return flipped;
    },
    unflip: () => setFlipped(false),
  };
}
