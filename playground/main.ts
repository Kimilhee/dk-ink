import "./styles.css";
import { createInkEditor, type Stroke, type WidthMode } from "../src/index.ts";

const canvas = element<HTMLCanvasElement>("ink");
const dumpOutput = element<HTMLPreElement>("dump-output");
let recorded: Stroke[] = [];

const editor = createInkEditor(canvas, {
  onChange(strokes, change) {
    recorded = [...strokes];
    setStatus(`획 ${strokes.length}개 · ${change}`);
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

// 기록한 획을 원래 속도로 다시 채워 넣는다. t 값이 온전한지 눈으로 확인하는 용도다.
element<HTMLButtonElement>("replay").addEventListener("click", async () => {
  const source = recorded;
  if (source.length === 0) return;
  const played: Stroke[] = [];
  editor.setStrokes(played, { recordHistory: false });
  for (const stroke of source) {
    const partial: Stroke = [];
    played.push(partial);
    for (const point of stroke) {
      const previous = partial[partial.length - 1];
      partial.push(point);
      editor.setStrokes(played, { recordHistory: false });
      // 사람이 멈춰 있던 구간까지 그대로 기다리면 지루하므로 상한을 둔다.
      if (previous) await delay(Math.max(0, Math.min(32, point.t - previous.t)));
    }
  }
  setStatus(`재생 완료 · 획 ${source.length}개`);
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
  const erasing = editor.tool === "eraser";
  element<HTMLElement>("width-mode-picker").hidden = erasing;
  element<HTMLElement>("stroke-width-picker").hidden = erasing;
  element<HTMLElement>("eraser-width-control").hidden = !erasing;
  element<HTMLButtonElement>("undo").disabled = !editor.canUndo;
  element<HTMLButtonElement>("redo").disabled = !editor.canRedo;
  element<HTMLButtonElement>("replay").disabled = recorded.length === 0;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing`);
  return found as T;
}
