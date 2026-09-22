export { createInkEditor, type InkEditor } from "./editor.ts";
export { eraseStrokes } from "./erase.ts";
export { cloneStrokes, InkHistory } from "./history.ts";
export { drawOutlineStroke } from "./outline.ts";
export { drawEraserCursor, pressureWidth, renderStrokes } from "./render.ts";
export type {
  InkChangeType,
  InkEditorOptions,
  InkPoint,
  InkStyle,
  InkTool,
  Point,
  Stroke,
  WidthMode,
} from "./types.ts";
