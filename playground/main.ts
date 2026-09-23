import "./styles.css";
import {
  createInkEditor,
  eraseStrokes,
  InkHistory,
  type InkAction,
  type Stroke,
  type WidthMode,
} from "../src/index.ts";
import packageJson from "../package.json" with { type: "json" };
import {
  type EraserContact,
  isFingerTouch,
  MomentaryEraser,
  type MomentaryEraserEvent,
  supportsTouchTypeDetection,
} from "./momentary-eraser.ts";

const canvas = element<HTMLCanvasElement>("ink");
const dumpOutput = element<HTMLPreElement>("dump-output");
const toolbar = element<HTMLElement>("tool-picker");
const dragHandle = element<HTMLButtonElement>("toolbar-drag-handle");
const penButton = toolbar.querySelector<HTMLButtonElement>('[data-tool="pen"]');
const eraserButton = toolbar.querySelector<HTMLButtonElement>('[data-tool="eraser"]');
const settingsPanel = element<HTMLElement>("settings-panel");
const settingsToggle = element<HTMLButtonElement>("settings-toggle");
if (!penButton || !eraserButton) throw new Error("Tool buttons are missing");
element<HTMLElement>("app-version").textContent = `v${packageJson.version}`;
/**
 * 마지막 [전체 지우기] 이후의 편집. 지우개 제스처까지 순서대로 들어 있다.
 *
 * 전체 지우기는 "처음부터 다시"라는 뜻이므로 재생의 시작점도 거기로 옮긴다. 세션
 * 전체를 남겨야 하는 수집 도구라면 `clear`까지 그대로 쌓으면 된다 — 무엇을 재생으로
 * 볼지는 앱 정책이고, 라이브러리는 일어난 일을 빠짐없이 넘겨준다.
 */
const actions: InkAction[] = [];
let replaying = false;
const momentaryEraser = new MomentaryEraser();
let toolbarDrag: { pointerId: number; offsetX: number; offsetY: number } | undefined;

const editor = createInkEditor(canvas, {
  onChange(strokes, action) {
    if (replaying) return;
    if (action.type === "erase") applyMomentaryEraser({ type: "stroke-ended" });
    if (action.type === "clear") {
      actions.length = 0;
    } else if (actions.length === 0 && action.type !== "stroke") {
      // 지운 뒤 되돌리기처럼 이력 없이 나타난 획은 세션의 시작 상태로 잡는다.
      actions.push({ type: "set", strokes: strokes.map((s) => s.map((point) => ({ ...point }))) });
    } else {
      actions.push(action);
    }
    setStatus(`획 ${strokes.length}개 · ${action.type} · 이력 ${actions.length}개`);
    syncButtons();
  },
});

toolbar.addEventListener("click", (event) => {
  if ((event as MouseEvent).detail !== 0) return;
  const button = buttonFrom(event, "[data-tool]");
  if (!button) return;
  if (button.dataset.tool === "pen") momentaryEraser.reset();
  editor.tool = button.dataset.tool === "eraser" ? "eraser" : "pen";
  syncButtons();
});

penButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  momentaryEraser.reset();
  editor.tool = "pen";
  syncButtons();
});
penButton.addEventListener(
  "touchstart",
  (event) => {
    event.preventDefault();
    momentaryEraser.reset();
    editor.tool = "pen";
    syncButtons();
  },
  { passive: false },
);

// 지우개 버튼의 누름·뗌은 Pointer Events와 Touch Events 양쪽에서 들어온다.
// 스타일러스가 두 이벤트를 동시에 내는 기기가 있는가 하면, 손가락의 `touchstart`가
// 유독 전달되지 않는 기기도 있다. 하나만 믿으면 어느 쪽 기기에서든 깨지므로 둘 다
// 받아들인다 — 상태 모듈의 `press`/`contact-released` 처리는 중복 호출에도
// 안전하도록 만들어져 있다 (`press`는 그대로 덮어쓰고, 해제는 `matches()`가 이미
// 끝난 접촉을 걸러낸다).
function contactFromPointer(event: PointerEvent): EraserContact {
  return event.pointerType === "touch"
    ? { source: "finger", id: event.pointerId }
    : { source: "pointer", id: event.pointerId };
}

eraserButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  applyMomentaryEraser({ type: "press", contact: contactFromPointer(event) });
  try {
    eraserButton.setPointerCapture(event.pointerId);
  } catch {
    // 펜 입력과 동시에 손가락 포인터가 취소되어도 지우개 선택은 유지한다.
  }
});
// `touchType`을 못 읽는 브라우저(Safari 이외 전부)에서는 Touch 기반 판정이 스타일러스를
// 손가락으로 오판해, 같은 접촉을 두고 Pointer Events 기반 판정과 서로 다른 결론을 내며
// 경쟁한다 — 그 결과가 "가끔은 바뀌고 가끔은 안 바뀐다"로 나타난다. 그런 브라우저에서는
// Touch 리스너 자체를 걸지 않고 위의 Pointer Events 경로만 신뢰한다.
if (supportsTouchTypeDetection) {
  eraserButton.addEventListener(
    "touchstart",
    (event) => {
      const touch = Array.from(event.changedTouches).find(isFingerTouch);
      if (!touch) return;
      event.preventDefault();
      applyMomentaryEraser({
        type: "press",
        contact: { source: "finger", id: touch.identifier },
      });
    },
    { passive: false },
  );
  window.addEventListener("touchend", finishFingerEraserHold, { capture: true });
  window.addEventListener("touchcancel", (event) => {
    for (const touch of event.changedTouches) {
      if (!isFingerTouch(touch)) continue;
      applyMomentaryEraser({
        type: "contact-canceled",
        contact: { source: "finger", id: touch.identifier },
      });
    }
  });
}

canvas.addEventListener("pointerdown", () => {
  applyMomentaryEraser({ type: "canvas-used" });
});

eraserButton.addEventListener("pointerup", (event) => {
  finishEraserHold(
    contactFromPointer(event),
    containsPoint(eraserButton, event.clientX, event.clientY),
  );
  try {
    eraserButton.releasePointerCapture(event.pointerId);
  } catch {
    // 이미 풀렸거나 애초에 잡히지 않은 캡처는 무시한다.
  }
});
eraserButton.addEventListener("pointercancel", (event) => {
  applyMomentaryEraser({ type: "contact-canceled", contact: contactFromPointer(event) });
});

element<HTMLElement>("width-mode-picker").addEventListener("click", (event) => {
  const button = buttonFrom(event, "[data-width-mode]");
  if (!button) return;
  editor.setStyle({ widthMode: button.dataset.widthMode as WidthMode });
  syncButtons();
});

element<HTMLElement>("stroke-width-picker").addEventListener("click", (event) => {
  const button = buttonFrom(event, "[data-stroke-width]");
  if (!button) return;
  editor.setStyle({ strokeWidth: Number(button.dataset.strokeWidth) });
  syncButtons();
});

element<HTMLInputElement>("eraser-width").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  editor.setStyle({ eraserWidth: value });
  element<HTMLOutputElement>("eraser-width-value").value = `${value}px`;
});

activateOnPress("undo", () => {
  editor.undo();
  syncButtons();
});
activateOnPress("redo", () => {
  editor.redo();
  syncButtons();
});
activateOnPress("clear", () => {
  editor.clear();
  syncButtons();
});
activateOnPress("settings-toggle", () => {
  setSettingsOpen(settingsPanel.hasAttribute("hidden"));
});
activateOnPress("settings-close", () => setSettingsOpen(false));

document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target;
    if (
      settingsPanel.hidden ||
      !(target instanceof Element) ||
      settingsPanel.contains(target) ||
      settingsToggle.contains(target)
    ) {
      return;
    }
    setSettingsOpen(false);
    if (target.closest(".canvas-stage") && !target.closest(".floating-toolbar")) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
  { capture: true },
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSettingsOpen(false);
});

dragHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const bounds = toolbar.getBoundingClientRect();
  toolbarDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - bounds.left,
    offsetY: event.clientY - bounds.top,
  };
  dragHandle.setPointerCapture(event.pointerId);
  toolbar.classList.add("is-dragging");
  event.preventDefault();
});

dragHandle.addEventListener("pointermove", (event) => {
  if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId) return;
  const stageBounds = element<HTMLElement>("canvas-stage").getBoundingClientRect();
  positionToolbar(
    event.clientX - stageBounds.left - toolbarDrag.offsetX,
    event.clientY - stageBounds.top - toolbarDrag.offsetY,
  );
});

dragHandle.addEventListener("pointerup", finishToolbarDrag);
dragHandle.addEventListener("pointercancel", finishToolbarDrag);

window.addEventListener("resize", () => {
  const stageBounds = element<HTMLElement>("canvas-stage").getBoundingClientRect();
  const toolbarBounds = toolbar.getBoundingClientRect();
  positionToolbar(toolbarBounds.left - stageBounds.left, toolbarBounds.top - stageBounds.top);
});
element<HTMLButtonElement>("dump").addEventListener("click", () => {
  const strokes = editor.getStrokes();
  dumpOutput.hidden = false;
  dumpOutput.textContent = JSON.stringify(
    strokes.map((stroke) =>
      stroke.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
        t: Math.round(point.t),
        pressure: point.pressure === undefined ? undefined : Number(point.pressure.toFixed(3)),
      })),
    ),
    undefined,
    1,
  );
});

// 세션을 처음부터 다시 실행한다. 펜은 점 단위로, 지우개는 경로 단위로 재적용하므로
// 실제로 지워지는 과정이 그대로 보인다.
element<HTMLButtonElement>("replay").addEventListener("click", async () => {
  if (replaying || actions.length === 0) return;
  replaying = true;
  element<HTMLButtonElement>("replay").disabled = true;

  // 재생도 편집과 같은 상태 전이를 거쳐야 undo/redo가 원래 자리에서 동작한다.
  const history = new InkHistory(200);
  let state: Stroke[] = [];
  const show = () => editor.setStrokes(state, { recordHistory: false });
  show();

  for (const action of actions) {
    if (action.type === "stroke") {
      history.commit(state);
      const partial: Stroke = [];
      state = [...state, partial];
      for (const point of action.stroke) {
        const previous = partial[partial.length - 1];
        partial.push(point);
        show();
        if (previous) await delay(point.t - previous.t);
      }
    } else if (action.type === "erase") {
      history.commit(state);
      for (let index = 1; index < action.path.length; index += 1) {
        const from = action.path[index - 1];
        const to = action.path[index];
        state = eraseStrokes(state, from, to, action.width).strokes;
        show();
        await delay(to.t - from.t);
      }
    } else if (action.type === "undo") {
      state = history.undo(state) ?? state;
      show();
      await delay(220);
    } else if (action.type === "redo") {
      state = history.redo(state) ?? state;
      show();
      await delay(220);
    } else if (action.type === "clear") {
      history.commit(state);
      state = [];
      show();
      await delay(220);
    } else {
      history.commit(state);
      state = action.strokes;
      show();
      await delay(220);
    }
  }

  replaying = false;
  setStatus(`재생 완료 · 이력 ${actions.length}개`);
  syncButtons();
});

syncButtons();
setStatus("획 0개");

function syncButtons(): void {
  const style = editor.getStyle();
  press("tool-picker", "[data-tool]", (button) => button.dataset.tool === editor.tool);
  press(
    "width-mode-picker",
    "[data-width-mode]",
    (button) => button.dataset.widthMode === style.widthMode,
  );
  press(
    "stroke-width-picker",
    "[data-stroke-width]",
    (button) => Number(button.dataset.strokeWidth) === style.strokeWidth,
  );
  element<HTMLInputElement>("eraser-width").value = String(style.eraserWidth);
  element<HTMLOutputElement>("eraser-width-value").value = `${style.eraserWidth}px`;
  element<HTMLButtonElement>("undo").disabled = !editor.canUndo;
  element<HTMLButtonElement>("redo").disabled = !editor.canRedo;
  element<HTMLButtonElement>("replay").disabled = replaying || actions.length === 0;
}

function finishEraserHold(contact: EraserContact, overButton: boolean): void {
  applyMomentaryEraser({ type: "contact-released", contact, overButton });
}

function finishFingerEraserHold(event: TouchEvent): void {
  const fingerStillDown = Array.from(event.touches).some(
    (touch) =>
      isFingerTouch(touch) && momentaryEraser.matches({ source: "finger", id: touch.identifier }),
  );
  if (fingerStillDown) return;

  for (const touch of event.changedTouches) {
    if (!isFingerTouch(touch)) continue;
    const contact = { source: "finger", id: touch.identifier } as const;
    if (!momentaryEraser.matches(contact)) continue;
    finishEraserHold(contact, containsPoint(eraserButton!, touch.clientX, touch.clientY));
    return;
  }
}

function containsPoint(element: HTMLElement, x: number, y: number): boolean {
  const bounds = element.getBoundingClientRect();
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function applyMomentaryEraser(event: MomentaryEraserEvent): void {
  const nextTool = momentaryEraser.handle(event);
  if (!nextTool) return;
  editor.tool = nextTool;
  syncButtons();
}

function activateOnPress(buttonId: string, action: () => void): void {
  const button = element<HTMLButtonElement>(buttonId);
  // 스타일러스는 `pointerdown`과 `touchstart`를 모두 발생시킨다. 손가락만 걸러내면
  // 스타일러스가 어느 쪽에서도 안 걸리는 기기가 생기므로, 둘 다 받아들이는 대신
  // 같은 입력이 두 번 들어와도 한 번만 반응하도록 짧게 잠근다.
  let lastActivated = 0;
  const activate = () => {
    if (button.disabled) return;
    const now = performance.now();
    if (now - lastActivated < 500) return;
    lastActivated = now;
    action();
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && event.pointerType !== "touch") activate();
  });
  button.addEventListener(
    "touchstart",
    (event) => {
      if (button.disabled) return;
      event.preventDefault();
      activate();
    },
    { passive: false },
  );
  button.addEventListener("click", (event) => {
    if (event.detail === 0) activate();
  });
}

function setSettingsOpen(open: boolean): void {
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
}

function positionToolbar(left: number, top: number): void {
  const stage = element<HTMLElement>("canvas-stage");
  const margin = 8;
  const maxLeft = stage.clientWidth - toolbar.offsetWidth - margin;
  const maxTop = stage.clientHeight - toolbar.offsetHeight - margin;
  toolbar.style.left = `${Math.max(margin, Math.min(maxLeft, left))}px`;
  toolbar.style.top = `${Math.max(margin, Math.min(maxTop, top))}px`;
  toolbar.style.bottom = "auto";
  toolbar.style.transform = "none";
}

function finishToolbarDrag(event: PointerEvent): void {
  if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId) return;
  toolbarDrag = undefined;
  toolbar.classList.remove("is-dragging");
}

function press(
  containerId: string,
  selector: string,
  active: (button: HTMLButtonElement) => boolean,
): void {
  for (const button of element<HTMLElement>(containerId).querySelectorAll<HTMLButtonElement>(
    selector,
  )) {
    button.setAttribute("aria-pressed", String(active(button)));
  }
}

function buttonFrom(event: Event, selector: string): HTMLButtonElement | null {
  return (event.target as HTMLElement).closest<HTMLButtonElement>(selector);
}

function setStatus(value: string): void {
  element<HTMLElement>("status").textContent = value;
}

/** 사람이 멈춰 있던 구간까지 그대로 기다리면 지루하므로 상한을 둔다. */
function delay(ms: number): Promise<void> {
  const capped = Math.max(0, Math.min(32, ms));
  return new Promise((resolve) => setTimeout(resolve, capped));
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing`);
  return found as T;
}
