export { createInkEditor, type InkEditor } from "./editor.ts";
export { createDynamicEraser, type DynamicEraser } from "./dynamic-eraser.ts";
export { eraseStrokes } from "./erase.ts";
export { cloneStrokes, createInkHistory, type InkHistory } from "./history.ts";
export { drawOutlineStroke, pressureWidth } from "./outline.ts";
export { drawEraserCursor, drawStaticLineStroke, renderStrokes } from "./render.ts";
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
