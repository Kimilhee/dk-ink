import packageJson from "../package.json" with { type: "json" };

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
// 버전을 빌드 결과물에 함께 넣는다. 화면에 보이는 버전이 실제로 로드된 코드와 항상 같게 하려고
// package.json을 따로 읽지 않고 이 값을 쓴다.
export const VERSION: string = packageJson.version;
