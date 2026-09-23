import "./styles.css";
import {
  createInkEditor,
  eraseStrokes,
  InkHistory,
  type InkAction,
  type InkTool,
  type Stroke,
  type WidthMode,
} from "../src/index.ts";
import packageJson from "../package.json" with { type: "json" };

const canvas = element<HTMLCanvasElement>("ink");
const dumpOutput = element<HTMLPreElement>("dump-output");
const toolbar = element<HTMLElement>("tool-picker");
const dragHandle = element<HTMLButtonElement>("toolbar-drag-handle");
const penButton = toolbar.querySelector<HTMLButtonElement>('[data-tool="pen"]');
const eraserButton = toolbar.querySelector<HTMLButtonElement>('[data-tool="eraser"]');
const settingsPanel = element<HTMLElement>("settings-panel");
const settingsToggle = element<HTMLButtonElement>("settings-toggle");
const toolStatus = element<HTMLElement>("tool-status");
const debugLog = element<HTMLElement>("debug-log");
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
let toolbarDrag: { pointerId: number; offsetX: number; offsetY: number } | undefined;

const editor = createInkEditor(canvas, {
  onChange(strokes, action) {
    if (replaying) return;
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

// 도구는 토글이다. 누르면 그 도구가 선택된 채로 남고, 다른 도구를 눌러야 바뀐다.
//
// 예전에는 "지우개를 손가락으로 누른 채 유지 → 떼면 펜으로 복귀"라는 순간 지우개가 있었는데,
// 실제 기기(갤럭시탭 P580/P610) 검증에서 그 전제가 깨졌다. 스타일러스가 화면에 근접하면
// 디지타이저가 이미 눌려 있던 손가락 접촉까지 끊고, 손가락을 실제로 뗄 때 `pointerup`도
// `pointercancel`도 보내지 않는다. 해제를 관찰할 수 없으면 복귀 조건 자체가 성립하지 않아
// 그 메커니즘을 걷어냈다. 자세한 검증 결과는 docs/prd/eraser-interaction.md 참고.
selectToolOnPress(penButton, "pen");
selectToolOnPress(eraserButton, "eraser");

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
activateOnPress("debug-log-clear", () => {
  debugLog.replaceChildren();
});

// 스타일러스가 화면에 닿지 않고 근접만 해도(호버) `pointermove`가 `pointerType: "pen"`으로
// 들어온다. 이 호버가 떠 있는 동안 일부 기기(디지타이저)는 손가락 터치를 화면 어디서든 OS
// 레벨에서 막아 브라우저까지 보내지 않는다 — 웹 페이지가 고칠 수 없는 기기 동작이다. 막힌
// 터치 자체는 관찰할 수 없으니, 대신 원인인 호버를 감지해 도구 모음을 회색으로 바꿔 "지금은
// 손가락이 안 먹는다"를 눈으로 바로 알 수 있게 한다.
//
// 펜이 호버 범위를 벗어나면 `pointerout`이 `relatedTarget: null`로 들어온다(엘리먼트 사이를
// 옮겨 다닐 때는 `relatedTarget`이 다음 엘리먼트를 가리키므로 구분된다). 이걸 들으면 화면에서
// 포인터가 사라지는 순간에 맞춰 즉시 회색을 풀 수 있다. 타이머는 이 이벤트를 안 보내는 기기를
// 위한 폴백으로만 남긴다.
//
// 단, 펜이 도구 모음 위에 떠 있을 때는 회색으로 만들지 않는다. 회색은 "여기는 지금 누를 수
// 없다"는 뜻인데, 그 자리의 펜은 실제로 아이콘을 누를 수 있기 때문이다.
let penNearTimer: ReturnType<typeof setTimeout> | undefined;
function markPenNear(overToolbar: boolean): void {
  if (penNearTimer !== undefined) clearTimeout(penNearTimer);
  toolbar.classList.toggle("is-pen-near", !overToolbar);
  penNearTimer = setTimeout(() => endPenNear("시간 초과"), 700);
}

function endPenNear(reason: string): void {
  if (penNearTimer !== undefined) clearTimeout(penNearTimer);
  penNearTimer = undefined;
  if (toolbar.classList.contains("is-pen-near")) {
    logDebug(`펜 호버 끝(${reason}) → 손가락 터치 가능`);
  }
  toolbar.classList.remove("is-pen-near");
}

function penOverToolbar(event: PointerEvent): boolean {
  return containsPoint(toolbar, event.clientX, event.clientY);
}

document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "pen") return;
  if (!toolbar.classList.contains("is-pen-near") && !penOverToolbar(event)) {
    logDebug("펜 호버 시작 → 손가락 터치가 막힐 수 있음");
  }
  markPenNear(penOverToolbar(event));
});
document.addEventListener("pointerout", (event) => {
  if (event.pointerType !== "pen" || event.relatedTarget !== null) return;
  endPenNear("pointerout");
  // 펜이 호버 범위를 벗어나면 버튼 상태를 더 볼 수 없다. 눌린 채로 기억해 두면 다음에
  // 돌아올 때 뗀 것으로 오인해 도구가 멋대로 바뀌므로 여기서 잊는다.
  penContact = false;
  sideButtonDown = false;
});
document.addEventListener("pointerdown", (event) => {
  logDebug(`pointerdown ${describeButtons(event)}`);
  if (event.pointerType !== "pen") return;
  penContact = true;
  markPenNear(penOverToolbar(event));
});
document.addEventListener("pointerup", (event) => {
  logDebug(`pointerup ${describeButtons(event)}`);
  if (event.pointerType !== "pen") return;
  penContact = false;
  markPenNear(penOverToolbar(event));
});
document.addEventListener("pointercancel", (event) => {
  logDebug(`pointercancel ${describeButtons(event)}`);
  if (event.pointerType === "pen") penContact = false;
});

/**
 * S펜 측면 버튼으로 도구를 바꾼다. 버튼을 **클릭**(눌렀다 뗌)하면 펜↔지우개가 토글된다.
 *
 * "버튼을 누른 채 지우고 떼면 복귀"가 더 자연스럽겠지만 이 기기에서는 불가능하다.
 * 측면 버튼이 `buttons` 비트 1을 차지하는데 이건 화면 접촉과 **같은 비트**라, 버튼을
 * 누른 상태에서는 화면에 닿아도 `buttons` 값이 1에서 바뀌지 않는다. 그러면 브라우저가
 * `pointerdown`을 발생시키지 않아 획 자체가 시작되지 않는다 — 버튼을 누르고 있는 동안은
 * 그리기도 지우기도 되지 않는다는 뜻이다.
 *
 * 그래서 누르고 있는 동안이 아니라 버튼을 **뗀 순간** 도구를 바꾼다. 손가락을 전혀 쓰지
 * 않으므로, 스타일러스 호버 중 손가락 터치가 막히는 이 기기의 제약과 무관하다.
 *
 * 호버 중(`pressure === 0`)일 때만 버튼으로 판정한다. 화면에 닿아 그리는 중에는 비트 1이
 * 접촉 때문에 서 있으므로, 이걸 버튼으로 오인하면 획을 끝낼 때마다 도구가 바뀐다.
 */
let penContact = false;
let sideButtonDown = false;

function trackSideButton(event: PointerEvent): void {
  const pressed = (event.buttons & 1) !== 0 && event.pressure === 0 && !penContact;
  if (pressed === sideButtonDown) return;
  sideButtonDown = pressed;
  if (pressed) return;

  // 뗀 순간 전환한다. 누른 순간에 바꾸면, 버튼을 누르고 있는 동안은 어차피 쓸 수 없는
  // 도구가 선택된 채로 기다리게 된다.
  editor.tool = editor.tool === "eraser" ? "pen" : "eraser";
  syncButtons();
  logDebug(`측면 버튼 클릭 → ${editor.tool === "eraser" ? "지우개" : "펜"}`);
}

let lastPenButtons = 0;
document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "pen") return;
  if (event.buttons !== lastPenButtons) {
    lastPenButtons = event.buttons;
    logDebug(`펜 버튼 변화 ${describeButtons(event)}`);
  }
  trackSideButton(event);
});
// 측면 버튼이 Pointer Events 대신 컨텍스트 메뉴로 빠지는 기기도 있어 함께 살펴본다.
document.addEventListener("contextmenu", (event) => {
  logDebug(`contextmenu (기본 동작 유지) target=${describeTarget(event.target)}`);
});

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
  toolStatus.textContent = `도구: ${editor.tool === "eraser" ? "지우개" : "펜"}`;
}

function containsPoint(element: HTMLElement, x: number, y: number): boolean {
  const bounds = element.getBoundingClientRect();
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

/** 진단용: 실제로 도착한 이벤트를 그대로 보여준다 — 막힌 터치는 로그에도 안 남으니,
 * "이후로 로그가 없다"도 유의미한 신호다. */
function logDebug(message: string): void {
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const line = document.createElement("div");
  line.textContent = `${time}.${String(now.getMilliseconds()).padStart(3, "0")} ${message}`;
  debugLog.append(line);
  while (debugLog.childElementCount > 40) debugLog.firstElementChild?.remove();
  debugLog.scrollTop = debugLog.scrollHeight;
}

/**
 * `buttons`는 비트마스크다: 1=접촉/주버튼, 2=측면(barrel) 버튼, 32=지우개 팁.
 * 어느 비트가 섰는지 이름으로 같이 보여줘야 로그만 보고 판단할 수 있다.
 */
function describeButtons(event: PointerEvent): string {
  const names = [
    [1, "접촉"],
    [2, "측면버튼"],
    [4, "가운데"],
    [32, "지우개팁"],
  ] as const;
  const active = names.filter(([bit]) => event.buttons & bit).map(([, name]) => name);
  const decoded = active.length > 0 ? ` [${active.join("+")}]` : "";
  // `pressure`가 0이면 화면에 닿지 않은 호버 상태다 — 접촉과 측면 버튼을 가르는 기준이다.
  const pressure = event.pressure.toFixed(2);
  return `${event.pointerType} id=${event.pointerId} button=${event.button} buttons=${event.buttons}${decoded} p=${pressure}`;
}

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "?";
  return target.id || target.className || target.tagName.toLowerCase();
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

/**
 * 도구 선택 버튼. `activateOnPress`와 달리 중복 호출 방어가 없다 — 도구 선택은 멱등이라
 * 같은 입력이 `pointerdown`과 `touchstart` 양쪽으로 들어와도 결과가 같기 때문이다.
 */
function selectToolOnPress(button: HTMLButtonElement, tool: InkTool): void {
  const select = () => {
    editor.tool = tool;
    syncButtons();
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button === 0) select();
  });
  button.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      select();
    },
    { passive: false },
  );
  // 키보드로 선택했을 때(`detail === 0`)도 같은 도구 상태를 쓸 수 있어야 한다.
  button.addEventListener("click", (event) => {
    if (event.detail === 0) select();
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
