import "./styles.css";
import { createInkEditor, type WidthMode } from "../src/index.ts";
import packageJson from "../package.json" with { type: "json" };
import { watchPenHover } from "./pen-hover.ts";

const canvas = element<HTMLCanvasElement>("ink");
const dumpOutput = element<HTMLPreElement>("dump-output");
const toolbar = element<HTMLElement>("tool-picker");
const dragHandle = element<HTMLButtonElement>("toolbar-drag-handle");
const toolToggle = element<HTMLButtonElement>("tool-toggle");
const settingsPanel = element<HTMLElement>("settings-panel");
const settingsToggle = element<HTMLButtonElement>("settings-toggle");
const toolStatus = element<HTMLElement>("tool-status");
const debugLog = element<HTMLElement>("debug-log");
element<HTMLElement>("app-version").textContent = `v${packageJson.version}`;

let toolbarDrag: { pointerId: number; offsetX: number; offsetY: number } | undefined;

/**
 * 설정은 새로고침해도 남아야 한다. 저장하는 것은 설정뿐이고 그림이나 선택된 도구는 담지
 * 않는다 — 그건 설정이 아니라 작업 상태다.
 *
 * `localStorage`는 사생활 보호 모드나 저장 용량 초과에서 접근 자체가 예외를 던지므로 읽기와
 * 쓰기를 모두 감싼다. 저장이 안 되더라도 이번 세션은 정상 동작해야 한다.
 */
const SETTINGS_KEY = "dk-ink-playground-settings";

type StoredSettings = {
  fingerDrawing?: unknown;
  toolSwitch?: unknown;
  color?: unknown;
  widthMode?: unknown;
  strokeWidth?: unknown;
  eraserWidth?: unknown;
};

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // 남의 손을 탄 값일 수 있으니 모양만 확인하고, 각 항목은 쓰는 자리에서 검사한다.
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredSettings) : {};
  } catch {
    return {};
  }
}

function saveSettings(): void {
  const style = editor.getStyle();
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        fingerDrawing: fingerDrawingEnabled,
        toolSwitch: toolSwitchMode,
        color: style.color,
        widthMode: style.widthMode,
        strokeWidth: style.strokeWidth,
        eraserWidth: style.eraserWidth,
      }),
    );
  } catch {
    // 저장에 실패해도 이번 세션의 설정은 그대로 쓴다.
  }
}

function storedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const stored = loadSettings();

/**
 * 손가락으로 캔버스에 필기하는 것을 막는다. 기본은 꺼짐 — 스타일러스로 쓰는 동안 손바닥이나
 * 손가락이 닿아 획이 그어지는 일을 없애기 위해서다. 도구 모음 조작은 막지 않는다.
 *
 * 리스너를 `createInkEditor`보다 **먼저** 걸어야 한다. 같은 요소에 등록된 리스너는 등록
 * 순서대로 실행되고, `stopImmediatePropagation()`은 아직 실행되지 않은 리스너만 막는다.
 */
let fingerDrawingEnabled = stored.fingerDrawing === true;
canvas.addEventListener("pointerdown", (event) => {
  if (fingerDrawingEnabled || event.pointerType !== "touch") return;
  event.stopImmediatePropagation();
  event.preventDefault();
});

const editor = createInkEditor(canvas, {
  color: typeof stored.color === "string" ? stored.color : undefined,
  widthMode:
    stored.widthMode === "constant" || stored.widthMode === "pressure"
      ? stored.widthMode
      : undefined,
  strokeWidth: storedNumber(stored.strokeWidth),
  eraserWidth: storedNumber(stored.eraserWidth),
  onChange(strokes) {
    setStatus(`획 ${strokes.length}개`);
    syncButtons();
  },
});

// 펜과 지우개는 버튼 하나를 번갈아 써서 바꾼다. "누르고 있는 동안만 지우개" 같은 순간
// 전환을 여러 방식으로 시도했지만 이 기기에서는 어느 것도 성립하지 않았다 — 경위는
// docs/prd/eraser-interaction.md 참고.
//
// 전환을 일으키는 입력은 설정에서 고른다. 두 방식을 동시에 켜면 안 된다 — 호버 상태에서
// 버튼을 탭하면 `pointerenter`와 `pointerdown`이 잇따라 들어와 두 번 뒤집히고 제자리로
// 돌아온다.
let toolSwitchMode: "click" | "hover" = stored.toolSwitch === "click" ? "click" : "hover";

function toggleTool(): void {
  editor.tool = editor.tool === "eraser" ? "pen" : "eraser";
  syncButtons();
}

// 도구를 지정하는 대신 뒤집는 동작이라 멱등이 아니다. 같은 손가락 입력이 `pointerdown`과
// `touchstart` 양쪽으로 들어오면 두 번 뒤집혀 제자리로 돌아오므로, 중복 호출을 걸러주는
// `activateOnPress`로 배선해야 한다.
activateOnPress("tool-toggle", () => {
  if (toolSwitchMode === "click") toggleTool();
});
// 포인터가 버튼 영역에 들어오는 순간 전환한다. `pointerenter`가 있지만 스타일러스 호버에서는
// 기기에 따라 오지 않아, 호버 중에도 꾸준히 들어오는 `pointermove`의 좌표로 직접 판정한다.
// 경계를 넘어선 첫 이벤트에서만 반응해야 하므로 직전 안팎 여부를 기억해 둔다.
let pointerInsideToggle = false;
document.addEventListener("pointermove", (event) => {
  // 기본(탭) 모드에서는 매 이벤트마다 영역을 재는 비용을 치르지 않는다.
  if (toolSwitchMode !== "hover") return;
  const inside = containsPoint(toolToggle, event.clientX, event.clientY);
  if (inside && !pointerInsideToggle) toggleTool();
  pointerInsideToggle = inside;
});

pickable("finger-input-picker", "finger-input", {
  apply: (value) => {
    fingerDrawingEnabled = value === "on";
  },
  current: () => (fingerDrawingEnabled ? "on" : "off"),
});
pickable("tool-switch-picker", "tool-switch", {
  apply: (value) => {
    toolSwitchMode = value === "hover" ? "hover" : "click";
  },
  current: () => toolSwitchMode,
});
// 이미 그린 획은 자기 색을 들고 있어 여기서 바뀌지 않는다. 앞으로 그릴 획에만 적용된다.
pickable("color-picker", "color", {
  apply: (value) => editor.setStyle({ color: value }),
  current: () => editor.getStyle().color,
});
pickable("width-mode-picker", "width-mode", {
  apply: (value) => editor.setStyle({ widthMode: value as WidthMode }),
  current: () => editor.getStyle().widthMode,
});
pickable("stroke-width-picker", "stroke-width", {
  apply: (value) => editor.setStyle({ strokeWidth: Number(value) }),
  current: () => String(editor.getStyle().strokeWidth),
});

element<HTMLInputElement>("eraser-width").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  editor.setStyle({ eraserWidth: value });
  element<HTMLOutputElement>("eraser-width-value").value = `${value}px`;
  saveSettings();
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

// 펜이 근접한 동안에는 이 기기에서 손가락 터치가 막히므로 도구 모음을 회색으로 표시한다.
// 단 펜이 도구 모음 위에 있을 때는 제외한다 — 회색은 "지금 누를 수 없다"는 뜻인데 그 자리의
// 펜은 실제로 아이콘을 누를 수 있어, 표시가 사실과 어긋나기 때문이다.
watchPenHover(
  (event) => containsPoint(toolbar, event.clientX, event.clientY),
  (near, reason) => {
    toolbar.classList.toggle("is-pen-near", near);
    logDebug(
      near ? "펜 호버 시작 → 손가락 터치가 막힐 수 있음" : `펜 호버 끝(${reason}) → 터치 가능`,
    );
  },
);

for (const type of ["pointerdown", "pointerup", "pointercancel"] as const) {
  document.addEventListener(type, (event) => logDebug(`${type} ${describePointer(event)}`));
}

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
  dumpOutput.hidden = false;
  dumpOutput.textContent = JSON.stringify(
    editor.getStrokes().map((stroke) => ({
      style: stroke.style,
      points: stroke.points.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
        t: Math.round(point.t),
        pressure: point.pressure === undefined ? undefined : Number(point.pressure.toFixed(3)),
      })),
    })),
    undefined,
    1,
  );
});

syncButtons();
setStatus("획 0개");

function syncButtons(): void {
  const style = editor.getStyle();
  const erasing = editor.tool === "eraser";
  for (const slot of toolToggle.querySelectorAll<HTMLElement>("[data-tool]")) {
    slot.classList.toggle("is-active", slot.dataset.tool === editor.tool);
  }
  toolToggle.setAttribute(
    "aria-label",
    `${erasing ? "지우개" : "펜"} 사용 중. 누르면 ${erasing ? "펜" : "지우개"}으로 바뀝니다`,
  );
  for (const sync of pickerSyncs) sync();
  element<HTMLInputElement>("eraser-width").value = String(style.eraserWidth);
  element<HTMLOutputElement>("eraser-width-value").value = `${style.eraserWidth}px`;
  element<HTMLButtonElement>("undo").disabled = !editor.canUndo;
  element<HTMLButtonElement>("redo").disabled = !editor.canRedo;
  toolStatus.textContent = `도구: ${erasing ? "지우개" : "펜"}`;
}

/**
 * 값 하나를 고르는 버튼 묶음(색·두께·필기 방식…)을 배선한다. 어느 묶음이든 하는 일이 같다
 * — 눌린 버튼의 `data-*` 값을 읽어 적용하고, 현재 값과 같은 버튼에 `aria-pressed`를 켠다.
 *
 * `dataset` 대신 `getAttribute`를 쓰는 이유: 속성명(`data-width-mode`)을 카멜케이스
 * (`widthMode`)로 바꾸는 변환을 두지 않아도 되기 때문이다.
 */
const pickerSyncs: Array<() => void> = [];

function pickable(
  containerId: string,
  attribute: string,
  handlers: { apply: (value: string) => void; current: () => string },
): void {
  const container = element<HTMLElement>(containerId);
  const selector = `[data-${attribute}]`;
  const valueOf = (button: Element) => button.getAttribute(`data-${attribute}`);

  container.addEventListener("click", (event) => {
    const value = (event.target as HTMLElement).closest(selector);
    if (!value) return;
    handlers.apply(valueOf(value) ?? "");
    syncButtons();
    saveSettings();
  });

  pickerSyncs.push(() => {
    for (const button of container.querySelectorAll(selector)) {
      button.setAttribute("aria-pressed", String(valueOf(button) === handlers.current()));
    }
  });
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

/** `p`(pressure)가 0이면 화면에 닿지 않은 호버 상태다. */
function describePointer(event: PointerEvent): string {
  return `${event.pointerType} id=${event.pointerId} p=${event.pressure.toFixed(2)}`;
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

function setStatus(value: string): void {
  element<HTMLElement>("status").textContent = value;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing`);
  return found as T;
}
