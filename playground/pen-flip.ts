/**
 * S펜이 캔버스 위에 떠 있는 동안 아이콘의 좌측 하단을 포인터에 맞춘다. 아이콘을 펜으로
 * 누르면 필기를 그대로 시작하며 아이콘은 제자리에 머문다. 거의 움직이지 않고 곧바로 떼면(탭) 그 점을
 * 걷어내고 연필이 뒤집혀(180°) 작은 지우개가 된다. 지우개 아이콘은 한 번 누르고 떼면 펜으로 돌아온다.
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
/** 지우개 아이콘을 누른 채 이만큼 넘게 끌면 탭(펜으로 돌아가기)이 아니라 지우기로 본다. */
const ERASE_DRAG_THRESHOLD = 8;
/** 펜 아이콘을 누른 채 이만큼 넘게 끌면 탭(지우개로 전환)이 아니라 필기로 본다. */
const PEN_TAP_THRESHOLD = 8;
/** 펜 아이콘을 이보다 오래 누르고 있으면 탭이 아니라 필기(점 찍기)로 본다. */
const PEN_TAP_MS = 300;
/** 펜이 아이콘 위(이 반경 안)에 있으면 누르려는 것으로 보고 아이콘을 멈춘다. */
const HOLD_RADIUS = 24;
/**
 * 뒤집힌 연필의 지우개 끝이 아이콘 중심에서 떨어진 거리(px, 오른쪽·위가 +). 지우는 동안
 * 이만큼 아이콘을 옮겨 지우개 끝을 지우개 원에 맞춘다. 기기에서 눈으로 맞출 값이다.
 */
const ERASER_END = 8;

export type PenFlip = {
  readonly flipped: boolean;
  /** 끄면 아이콘이 따라다니지 않는다. 뒤집힌 연필은 원래대로 돌린다. */
  enabled: boolean;
  /** 뒤집힌 연필을 원래대로 돌린다. 도구 모음에서 도구를 바꿀 때 쓴다. */
  unflip(): void;
};

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
  image.setAttribute("aria-hidden", "true");
  icon.append(image);
  icon.setAttribute("aria-label", "탭하여 지우개로 전환");
  icon.hidden = true;
  stage.append(icon);
  // 숨겨진 아이콘도 CSS 크기로 중심을 계산해 좌측 하단을 펜 끝에 맞춘다.
  const iconStyle = getComputedStyle(icon);
  const halfWidth = parseFloat(iconStyle.width) / 2;
  const halfHeight = parseFloat(iconStyle.height) / 2;

  let enabled = true;
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
  /** 펜 아이콘을 누른 입력. 짧게 떼면 지우개로 바뀌고, 끌면 필기로 남는다. */
  let penPress: PointerEvent | undefined;
  /** 누르기 직전의 획 개수. 탭으로 끝났을 때 누르며 찍힌 점을 걷어낼지 판단한다. */
  let strokeCountBeforePress = 0;
  /** 지우개 아이콘을 누른 입력. 짧게 떼면 펜으로 돌아가고, 끌면 이 자리부터 지운다. */
  let eraserPress: PointerEvent | undefined;
  /** 지우개에서 펜으로 되돌아가는 회전이 끝날 때까지는 펜을 멀리 들어도 감추지 않는다. */
  let returningToPen = false;

  /** 누른 자리에서 거의 움직이지 않고 곧바로 끝나는 중인가. 아니면 필기다. */
  function isPenTap(event: PointerEvent): boolean {
    if (event.pointerId !== penPress?.pointerId) return false;
    const distance = Math.hypot(event.clientX - penPress.clientX, event.clientY - penPress.clientY);
    return distance <= PEN_TAP_THRESHOLD && event.timeStamp - penPress.timeStamp <= PEN_TAP_MS;
  }

  function cancelFollow(): void {
    if (followTimer !== undefined) clearTimeout(followTimer);
    followTimer = undefined;
  }

  function applyTool(nextTool: "pen" | "eraser"): void {
    editor.tool = nextTool;
    syncIcon();
    onToolChange();
  }

  function setFlipped(next: boolean): void {
    if (next === flipped) return;
    flipped = next;
    eraserPress = undefined;
    if (flipped) {
      savedEraserWidth = editor.getStyle().eraserWidth;
      editor.setStyle({ eraserWidth: FLIPPED_ERASER_WIDTH });
      applyTool("eraser");
    } else {
      editor.setStyle({ eraserWidth: savedEraserWidth });
      applyTool("pen");
    }
  }

  function syncIcon(): void {
    const erasing = editor.tool === "eraser";
    if (icon.classList.contains("is-flipped") === erasing) return;
    icon.classList.toggle("is-flipped", erasing);
    icon.setAttribute(
      "aria-label",
      erasing ? "한 번 누르고 떼어 펜으로 전환" : "탭하여 지우개로 전환",
    );
  }

  function hide(): void {
    if (icon.classList.contains("is-erasing")) icon.classList.remove("is-erasing");
    cancelFollow();
    penPress = undefined;
    if (!icon.hidden) icon.hidden = true;
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

  function stagePoint(event: PointerEvent): { x: number; y: number } {
    const bounds = stage.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  /** 뒤집힌 연필로 지우는 동안에는 지연 없이 지우개 끝을 펜 끝(지우개 원)에 붙인다. */
  function stickToEraserTip(event: PointerEvent): void {
    const { x, y } = stagePoint(event);
    cancelFollow();
    icon.classList.add("is-erasing");
    moveTo(x + ERASER_END, y - ERASER_END);
    icon.hidden = false;
  }

  /** 호버 중인 펜을 따라 아이콘을 띄우거나 지연 이동을 예약한다. */
  function followHoveringPen(event: PointerEvent): void {
    if (icon.hidden && performance.now() < hiddenUntil) return;

    const { x, y } = stagePoint(event);
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
  }

  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "pen" || !enabled) return;
    syncIcon();
    // 아이콘을 누르고 있는 동안에는 그대로 둬야 뒤집히는 모습이 보인다.
    const overIcon = event.target === icon || event.target === image;
    if (overIcon && event.buttons !== 0) return;
    // 누른 자리에서 충분히 끌었거나 오래 눌렀으면 탭이 아니라 필기다. 이후로는 필기 중처럼
    // 아이콘을 숨긴다.
    if (event.pointerId === penPress?.pointerId && !isPenTap(event)) penPress = undefined;
    // 탭인지 판단하는 동안에는 자리를 유지한다.
    if (penPress !== undefined || eraserPress !== undefined) return;
    if (editor.tool === "eraser" && event.buttons !== 0 && event.target === canvas) {
      stickToEraserTip(event);
      return;
    }
    const overCanvas = event.target === canvas || overIcon;
    // 필기 중이거나 캔버스 밖에서는 아이콘을 숨긴다.
    if (!overCanvas || event.buttons !== 0) {
      hide();
      return;
    }
    followHoveringPen(event);
  });

  // 호버가 끝나면(펜을 멀리 들면) 아이콘을 감춘다. 단 뒤집힌 연필은 남긴다 — 연필 뒤의
  // 지우개로 지운다는 느낌이 나려면 지우러 다시 펜을 댈 때 거꾸로 선 연필이 보여야 한다.
  watchPenHover(
    () => false,
    (near) => {
      penNear = near;
      const keepVisible =
        flipped || penPress !== undefined || eraserPress !== undefined || returningToPen;
      if (!near && !keepVisible) hide();
    },
  );

  // 획을 마칠 때마다 다시 나타나는 시점을 미룬다. 아이콘을 탭한 경우는 아이콘이 보이는
  // 중이라 영향이 없다.
  document.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "pen") return;
    // 펜 아이콘을 거의 움직이지 않고 곧바로 뗐으면 탭이다. 누르며 캔버스에 찍힌 점은 필기가
    // 아니므로 걷는다. 에디터가 먼저 같은 pointerup으로 획을 마치므로 여기서 되돌릴 수 있다.
    // 오래 눌렀다 뗀 것은 점 찍기이므로 아래의 보통 필기 마무리로 넘긴다.
    const tapped = isPenTap(event);
    if (event.pointerId === penPress?.pointerId) penPress = undefined;
    if (tapped) {
      if (editor.getStrokes().length === strokeCountBeforePress + 1) editor.undo();
      setFlipped(true);
      return;
    }
    // 지우개 모드에서는 떼자마자 아이콘을 눌러 펜으로 돌아가는 일이 잦아 숨기지 않는다.
    // 지우던 자리(펜 끝)에 그대로 두면 다음 획을 가로채므로 호버 자리로만 옮긴다.
    if (editor.tool === "eraser" && icon.classList.contains("is-erasing")) {
      icon.classList.remove("is-erasing");
      const { x, y } = stagePoint(event);
      moveTo(x + halfWidth, y - halfHeight);
      return;
    }
    // 지우던 자리에 남은 아이콘은 다음 획을 가로막으므로 걷는다.
    if (icon.classList.contains("is-erasing")) hide();
    hiddenUntil = performance.now() + FOLLOW_DELAY_MS;
  });

  icon.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (editor.tool === "eraser") {
      cancelFollow();
      eraserPress = event;
      icon.setPointerCapture(event.pointerId);
      return;
    }
    cancelFollow();
    strokeCountBeforePress = editor.getStrokes().length;
    penPress = event;
    // 탭인지 필기인지 알기 전이므로 일단 일반 캔버스 입력으로 전달해 필기를 지연 없이 시작한다.
    // 에디터가 실제 포인터를 캡처하므로 이어지는 move/up도 캔버스로 와서 필기가 끊기지 않는다.
    canvas.dispatchEvent(new PointerEvent("pointerdown", event));
  });

  // 누른 자리에서 충분히 끌었으면 지우기로 넘긴다. 첫 펜 탭과 같은 방식으로 누른 시점의
  // 입력을 캔버스에 다시 보내고, 에디터가 포인터를 캡처하므로 이후 입력은 캔버스로 간다.
  icon.addEventListener("pointermove", (event) => {
    if (event.pointerId !== eraserPress?.pointerId) return;
    const distance = Math.hypot(
      event.clientX - eraserPress.clientX,
      event.clientY - eraserPress.clientY,
    );
    if (distance <= ERASE_DRAG_THRESHOLD) return;
    const press = eraserPress;
    eraserPress = undefined;
    canvas.dispatchEvent(new PointerEvent("pointerdown", press));
    canvas.dispatchEvent(new PointerEvent("pointermove", event));
  });

  icon.addEventListener("pointerup", (event) => {
    if (event.pointerId !== eraserPress?.pointerId) return;
    eraserPress = undefined;
    if (flipped) {
      setFlipped(false);
    } else {
      // 툴바에서 선택한 지우개의 크기는 유지하고 도구만 펜으로 되돌린다.
      applyTool("pen");
    }
    // 탭하고 바로 펜을 들면 회전이 보이기도 전에 호버 종료로 사라진다. 회전(CSS 전환)이
    // 끝난 뒤에 펜이 이미 멀어졌으면 그때 감춘다. `getAnimations()`가 방금 바뀐 스타일을
    // 반영하므로 막 시작한 전환도 여기 잡힌다.
    returningToPen = true;
    void Promise.allSettled(icon.getAnimations().map((animation) => animation.finished)).then(
      () => {
        returningToPen = false;
        if (!penNear) hide();
      },
    );
  });
  document.addEventListener("pointercancel", (event) => {
    if (event.pointerId === penPress?.pointerId) penPress = undefined;
  });
  icon.addEventListener("pointercancel", (event) => {
    if (event.pointerId === eraserPress?.pointerId) eraserPress = undefined;
  });

  return {
    get flipped() {
      return flipped;
    },
    get enabled() {
      return enabled;
    },
    set enabled(next) {
      enabled = next;
      if (enabled) return;
      penPress = undefined;
      setFlipped(false);
      hide();
    },
    unflip: () => {
      penPress = undefined;
      setFlipped(false);
    },
  };
}
