export { createInkEditor, type InkEditor } from "./editor.ts";
export { eraseStrokes } from "./erase.ts";
export { cloneStrokes, InkHistory } from "./history.ts";
export { drawOutlineStroke } from "./outline.ts";
export { drawEraserCursor, pressureWidth, renderStrokes } from "./render.ts";
export type {
  InkEditorOptions,
  InkPoint,
  InkStyle,
  InkTool,
  Point,
  Stroke,
  StrokeStyle,
  WidthMode,
} from "./types.ts";
