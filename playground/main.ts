import "./styles.css";
import {
  createInkEditor,
  eraseStrokes,
  InkHistory,
  type InkAction,
  type Stroke,
  type WidthMode,
} from "../src/index.ts";

const canvas = element<HTMLCanvasElement>("ink");
const dumpOutput = element<HTMLPreElement>("dump-output");
/**
 * 마지막 [전체 지우기] 이후의 편집. 지우개 제스처까지 순서대로 들어 있다.
 *
 * 전체 지우기는 "처음부터 다시"라는 뜻이므로 재생의 시작점도 거기로 옮긴다. 세션
 * 전체를 남겨야 하는 수집 도구라면 `clear`까지 그대로 쌓으면 된다 — 무엇을 재생으로
 * 볼지는 앱 정책이고, 라이브러리는 일어난 일을 빠짐없이 넘겨준다.
 */
const actions: InkAction[] = [];
let replaying = false;

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

element<HTMLElement>("tool-picker").addEventListener("click", (event) => {
  const button = buttonFrom(event, "[data-tool]");
  if (!button) return;
  editor.tool = button.dataset.tool === "eraser" ? "eraser" : "pen";
  syncButtons();
});

element<HTMLElement>("width-mode-picker").addEventListener("click", (event) => {
  const button = buttonFrom(event, "[data-width-mode]");
  if (!button) return;
  editor.setStyle({ widthMode: button.dataset.widthMode as WidthMode });
  syncButtons();
});

element<HTMLInputElement>("stroke-width").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  editor.setStyle({ strokeWidth: value });
  element<HTMLOutputElement>("stroke-width-value").value = `${value}px`;
});

element<HTMLInputElement>("eraser-width").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  editor.setStyle({ eraserWidth: value });
  element<HTMLOutputElement>("eraser-width-value").value = `${value}px`;
});

element<HTMLButtonElement>("undo").addEventListener("click", () => {
  editor.undo();
  syncButtons();
});
element<HTMLButtonElement>("redo").addEventListener("click", () => {
  editor.redo();
  syncButtons();
});
element<HTMLButtonElement>("clear").addEventListener("click", () => {
  editor.clear();
  syncButtons();
});
element<HTMLButtonElement>("settings-toggle").addEventListener("click", () => {
  const panel = element<HTMLElement>("settings-panel");
  const expanded = panel.hidden;
  panel.hidden = !expanded;
  element<HTMLButtonElement>("settings-toggle").setAttribute("aria-expanded", String(expanded));
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
  element<HTMLInputElement>("stroke-width").value = String(style.strokeWidth);
  element<HTMLOutputElement>("stroke-width-value").value = `${style.strokeWidth}px`;
  element<HTMLInputElement>("eraser-width").value = String(style.eraserWidth);
  element<HTMLOutputElement>("eraser-width-value").value = `${style.eraserWidth}px`;
  element<HTMLButtonElement>("undo").disabled = !editor.canUndo;
  element<HTMLButtonElement>("redo").disabled = !editor.canRedo;
  element<HTMLButtonElement>("replay").disabled = replaying || actions.length === 0;
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
