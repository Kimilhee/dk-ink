/**
 * S펜이 캔버스 위에 떠 있는 동안 아이콘의 좌측 하단을 포인터에 맞춘다. 아이콘을 펜으로
 * 처음 탭하면 필기를 그대로 시작하며 아이콘은 제자리에 머문다. 0.5초 안에 다시 탭하면
 * 연필이 뒤집히고(180°) 작은 지우개가 된다. 지우개 아이콘은 한 번 누르고 떼면 펜으로 돌아온다.
 *
 * 에디터 공개 API(`tool`, `setStyle`)만 쓴다. 나중에 라이브러리로 옮길 때 이 파일을 그대로
 * 가져가면 된다.
 */
import type { InkEditor } from "../src/index.ts";
import { watchPenHover } from "./pen-hover.ts";

/** 연필 뒷부분 지우개의 지름. 영구 지우개 설정과는 따로 간다. */
const FLIPPED_ERASER_WIDTH = 20;
/** 펜이 움직이면 이만큼 뒤에 그때의 펜 옆으로 옮겨 간다. 그 사이에 펜으로 아이콘을 누를 수 있다. */
const FOLLOW_DELAY_MS = 500;
/** 나타날 때 서서히 보이는 시간. */
const FADE_IN_MS = 1000;
/**
 * 아이콘을 놓은 뒤 펜이 이만큼 넘게 움직여야 이동을 예약한다. 호버 중 손떨림 이벤트가 미리
 * 예약을 걸어 두면, 실제로 움직이기 시작했을 때 0.5초를 다 기다리지 않고 옮겨지기 때문이다.
 */
const MOVE_THRESHOLD = 8;
/** 펜이 아이콘 위(이 반경 안)에 있으면 누르려는 것으로 보고 아이콘을 멈춘다. */
const HOLD_RADIUS = 24;
/** 첫 탭 이후 다시 탭할 수 있는 시간. */
const TAP_WINDOW_MS = 500;
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
  const image = document.createElement("span");
  image.className = "pen-flip-image";
  image.textContent = "✎";
  image.setAttribute("aria-hidden", "true");
  icon.append(image);
  icon.setAttribute("aria-label", "0.5초 안에 두 번 탭하여 지우개로 전환");
  icon.hidden = true;
  stage.append(icon);
  // 숨겨진 아이콘도 CSS 크기로 중심을 계산해 좌측 하단을 펜 끝에 맞춘다.
  const iconStyle = getComputedStyle(icon);
  const halfWidth = parseFloat(iconStyle.width) / 2;
  const halfHeight = parseFloat(iconStyle.height) / 2;

  let flipped = false;
  let savedEraserWidth = 0;
  let holding = false;
  let penNear = false;
  /** 필기 중 숨긴 아이콘은 펜을 뗀 뒤 이 시각까지 다시 띄우지 않는다. 획 사이마다 깜빡이지 않게. */
  let hiddenUntil = 0;
  /** 예약된 순간 이동. 하나만 걸고, 실행될 때 가장 최근 펜 위치로 간다. */
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  let followX = 0;
  let followY = 0;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let tapDeadline = 0;
  let returnToPenPointer: number | undefined;

  function resetTap(): void {
    if (tapTimer === undefined) return;
    clearTimeout(tapTimer);
    tapTimer = undefined;
  }

  function cancelFollow(): void {
    if (followTimer !== undefined) clearTimeout(followTimer);
    followTimer = undefined;
  }

  function setFlipped(next: boolean): void {
    if (next === flipped) return;
    flipped = next;
    returnToPenPointer = undefined;
    if (flipped) {
      savedEraserWidth = editor.getStyle().eraserWidth;
      editor.setStyle({ eraserWidth: FLIPPED_ERASER_WIDTH });
      editor.tool = "eraser";
    } else {
      editor.setStyle({ eraserWidth: savedEraserWidth });
      editor.tool = "pen";
    }
    syncIcon();
    onToolChange();
  }

  function syncIcon(): void {
    const erasing = editor.tool === "eraser";
    icon.classList.toggle("is-flipped", erasing);
    icon.setAttribute(
      "aria-label",
      erasing ? "한 번 누르고 떼어 펜으로 전환" : "0.5초 안에 두 번 탭하여 지우개로 전환",
    );
  }

  function hide(): void {
    icon.classList.remove("is-erasing");
    cancelFollow();
    resetTap();
    icon.hidden = true;
  }

  function moveTo(x: number, y: number): void {
    icon.style.left = `${x}px`;
    icon.style.top = `${y}px`;
  }

  /** 숨어 있다 나타날 때 갑자기 튀지 않게 투명에서 CSS 불투명도까지 서서히 보인다. */
  function fadeIn(): void {
    // 키프레임 하나에 `offset: 0`이 없으면 끝 값으로 해석돼 거꾸로 페이드 아웃된다.
    icon.animate([{ opacity: 0, offset: 0 }], { duration: FADE_IN_MS, easing: "ease-out" });
  }

  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "pen") return;
    syncIcon();
    // 아이콘을 누르고 있는 동안에는 그대로 둬야 뒤집히는 모습이 보인다.
    const overIcon = event.target === icon || event.target === image;
    if (overIcon && event.buttons !== 0) return;
    const overCanvas = event.target === canvas || overIcon;
    // 펜을 떼거나 캔버스를 벗어나도 두 번째 탭을 기다리는 동안에는 자리를 유지한다.
    if (tapTimer !== undefined || returnToPenPointer !== undefined) return;
    // 뒤집힌 연필로 지우는 동안에는 지연 없이 지우개 끝을 펜 끝(지우개 원)에 붙인다.
    if (editor.tool === "eraser" && event.buttons !== 0 && event.target === canvas) {
      const bounds = stage.getBoundingClientRect();
      cancelFollow();
      icon.classList.add("is-erasing");
      moveTo(event.clientX - bounds.left + ERASER_END, event.clientY - bounds.top - ERASER_END);
      icon.hidden = false;
      return;
    }
    // 필기 중이거나 캔버스 밖에서는 아이콘을 숨긴다.
    if (!overCanvas || event.buttons !== 0) {
      hide();
      return;
    }
    if (icon.hidden && performance.now() < hiddenUntil) return;

    const bounds = stage.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const targetX = x + halfWidth;
    const targetY = y - halfHeight;

    if (icon.hidden) {
      moveTo(targetX, targetY);
      icon.hidden = false;
      fadeIn();
      return;
    }
    const iconX = parseFloat(icon.style.left);
    const iconY = parseFloat(icon.style.top);
    holding = Math.hypot(x - iconX, y - iconY) <= HOLD_RADIUS;
    followX = targetX;
    followY = targetY;
    // 이미 걸린 예약은 다시 걸지 않는다. 매번 취소하고 다시 걸면 호버 중 손떨림으로 이벤트가
    // 끊이지 않아 아이콘이 영영 움직이지 않는다.
    // 아이콘을 놓았을 때의 펜 위치에서 거의 안 움직였으면 손떨림이다.
    const moved = Math.hypot(targetX - iconX, targetY - iconY) > MOVE_THRESHOLD;
    if (holding || !moved || followTimer !== undefined) return;
    followTimer = setTimeout(() => {
      followTimer = undefined;
      // 미끄러지듯 멈추는 움직임은 CSS 전환(styles.css의 .pen-flip)이 맡는다.
      if (!holding) moveTo(followX, followY);
    }, FOLLOW_DELAY_MS);
  });

  // 호버가 끝나면(펜을 멀리 들면) 아이콘만 감춘다. 뒤집힌 상태는 다시 탭할 때까지 유지한다.
  watchPenHover(
    () => false,
    (near) => {
      penNear = near;
      if (!near && tapTimer === undefined && returnToPenPointer === undefined) hide();
    },
  );

  // 획을 마칠 때마다 다시 나타나는 시점을 미룬다. 아이콘을 탭한 경우는 아이콘이 보이는
  // 중이라 영향이 없다.
  document.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "pen") return;
    // 지우던 자리에 남은 아이콘은 다음 획을 가로막으므로 걷는다.
    if (tapTimer === undefined && icon.classList.contains("is-erasing")) hide();
    hiddenUntil = performance.now() + FOLLOW_DELAY_MS;
  });

  icon.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (editor.tool === "eraser") {
      cancelFollow();
      returnToPenPointer = event.pointerId;
      icon.setPointerCapture(event.pointerId);
      return;
    }
    if (tapTimer !== undefined && performance.now() < tapDeadline) {
      resetTap();
      setFlipped(true);
      return;
    }
    resetTap();
    cancelFollow();
    tapDeadline = performance.now() + TAP_WINDOW_MS;
    tapTimer = setTimeout(() => {
      resetTap();
      // 움직임 이벤트가 끊겨도 0.5초 뒤 계속 필기 중이면 즉시 숨긴다.
      if (editor.drawing || !penNear) hide();
    }, TAP_WINDOW_MS);
    // 첫 탭은 도구를 바꾸지 않고 일반 캔버스 입력으로 전달한다. 에디터가 실제 포인터를
    // 캡처하므로 이어지는 move/up도 캔버스로 와서 필기가 끊기지 않는다.
    canvas.dispatchEvent(new PointerEvent("pointerdown", event));
  });

  icon.addEventListener("pointerup", (event) => {
    if (event.pointerId !== returnToPenPointer) return;
    returnToPenPointer = undefined;
    if (flipped) setFlipped(false);
    else {
      // 툴바에서 선택한 지우개의 크기는 유지하고 도구만 펜으로 되돌린다.
      editor.tool = "pen";
      syncIcon();
      onToolChange();
    }
  });
  icon.addEventListener("pointercancel", (event) => {
    if (event.pointerId === returnToPenPointer) returnToPenPointer = undefined;
  });

  return {
    get flipped() {
      return flipped;
    },
    unflip: () => {
      resetTap();
      setFlipped(false);
    },
  };
}
