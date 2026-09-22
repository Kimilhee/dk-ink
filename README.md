# dk-ink

캔버스 하나를 손글씨(digital ink) 에디터로 만드는 프레임워크 비의존 라이브러리.
`dk-script`의 수식 필기 영역을 떼어낸 것이고, 인식·변환은 범위 밖이다.

**[시험용 앱 → kimilhee.github.io/dk-ink](https://kimilhee.github.io/dk-ink/)** (펜/지우개·두께·되돌리기·획 JSON·재생)

- **필압 획** — `PointerEvent.pressure`를 굵기로 반영한다. 캔버스의 `lineWidth`는 획 하나에
  하나뿐이라 점마다 굵기를 못 주므로, 윤곽을 만들어 채운다.
- **벡터 지우개** — 획 단위로 지우지 않고 지나간 자리만 잘라낸다. 글자 가운데를 지나가면
  획이 두 조각으로 남는다.
- **되돌리기 / 다시 실행** — 획 묶음 스냅샷 스택.
- **뭉친 이벤트 복원** — 저사양 기기는 포인터 이벤트를 뭉쳐 보낸다.
  `getCoalescedEvents()`까지 풀어서 궤적이 각지지 않게 한다.
- **DPR 대응** — 백버퍼는 물리 픽셀, 좌표는 CSS 픽셀. `ResizeObserver`로 자동 추적한다.
- **동작 이력** — 획 하나, 지우개 제스처 하나를 `InkAction`으로 흘려보낸다. 모아두면 세션을
  그대로 재생할 수 있다.
- 획 데이터는 전부 평범한 JSON 직렬화 가능 객체다. 저장·전송·재생에 별도 포맷이 필요 없다.

의존성은 없다. 브라우저 API만 쓴다.

## 설치

```bash
pnpm add dk-ink
```

## 사용

```ts
import { createInkEditor } from "dk-ink";

const editor = createInkEditor(document.querySelector("canvas")!, {
  tool: "pen",
  strokeWidth: 3,
  widthMode: "pressure",
  onChange(strokes, action) {
    console.log(strokes.length, action.type); // "stroke" | "erase" | "undo" | ...
  },
});

editor.tool = "eraser";
editor.setStyle({ eraserWidth: 32 });
editor.undo();

const strokes = editor.getStrokes(); // JSON으로 저장 가능
editor.setStrokes(strokes); // 다시 불러오기
editor.destroy();
```

캔버스의 **크기·배경·테두리는 앱이 정한다.** 동작에 필요한 CSS(`touch-action: none` 등)만
라이브러리가 캔버스에 직접 넣으므로 스타일시트를 따로 불러올 필요가 없다. 현재 도구는
`data-tool` 속성으로 노출되니 `canvas[data-tool="eraser"] { cursor: crosshair }` 처럼 쓰면 된다.

### 동작 이력과 재생

`onChange`의 두 번째 인자가 **무슨 편집이 일어났는지**를 담는다:

```ts
type InkAction =
  | { type: "stroke"; stroke: Stroke }
  | { type: "erase"; path: InkPoint[]; width: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" }
  | { type: "set"; strokes: Stroke[] };
```

최종 획 집합만 저장하면 지우개는 흔적도 남지 않는다 — 지워진 자리를 "처음부터 비워둔 채
쓴 것"과 구분할 수 없다. 그래서 `erase`는 지워진 결과가 아니라 **지우개가 지나간 경로**를
담는다. 같은 경로를 같은 상태에 `eraseStrokes`로 다시 적용하면 같은 결과가 나오므로,
결과를 중복 저장할 필요가 없고 재생 도중 아무 시점에서 멈춰도 상태가 맞는다.

이력을 모아 순서대로 재적용하면 세션 재생이 된다. 재생 속도·보간 같은 정책은 앱마다
다르므로 라이브러리는 이력만 주고 재생 루프는 앱이 갖는다 (`playground/main.ts` 참고).

```ts
const actions: InkAction[] = [];
// onChange에서 actions.push(action)
```

`undo` / `redo`를 되짚으려면 재생 쪽도 `InkHistory`를 하나 들고 같은 상태 전이를 따라가면
된다.

### `InkEditor`

| 멤버                               | 설명                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| `tool`                             | `"pen"` \| `"eraser"`. 읽기·쓰기.                                   |
| `drawing`                          | 획이 진행 중인지.                                                   |
| `canUndo` / `canRedo`              | 버튼 활성 상태에 쓴다.                                              |
| `getStrokes()`                     | 내부 상태와 분리된 복사본.                                          |
| `setStrokes(strokes, options?)`    | 통째로 교체. `{ recordHistory: false }`면 되돌리기 이력을 건너뛴다. |
| `getStyle()` / `setStyle(partial)` | 색·굵기·모드·지우개 지름.                                           |
| `undo()` / `redo()` / `clear()`    | 바뀐 게 있으면 `true`.                                              |
| `resize()`                         | `ResizeObserver`가 부르므로 보통 직접 쓸 일이 없다.                 |
| `destroy()`                        | 리스너·옵저버 해제.                                                 |

### 옵션

| 옵션                                      | 기본값                       |
| ----------------------------------------- | ---------------------------- |
| `tool`                                    | `"pen"`                      |
| `color`                                   | `"#182231"`                  |
| `strokeWidth`                             | `3` (필압 모드에선 최대)     |
| `widthMode`                               | `"pressure"`                 |
| `eraserWidth`                             | `24`                         |
| `showEraserCursor`                        | `true`                       |
| `eraserCursorFill` / `eraserCursorStroke` | 청록 계열                    |
| `historyLimit`                            | `50` (`0`이면 되돌리기 없음) |
| `strokes`                                 | 초기 획                      |
| `onChange`                                | —                            |

### 하위 함수

에디터를 쓰지 않고 직접 조립할 때 쓸 순수 함수도 내보낸다:
`eraseStrokes` · `renderStrokes` · `drawOutlineStroke` · `drawEraserCursor` ·
`pressureWidth` · `cloneStrokes` · `InkHistory`.

## 개발

```bash
vp install
vp run playground   # 시험용 앱 (펜/지우개/두께/되돌리기/JSON 확인/재생)
vp test
vp check
vp pack             # dist/ 빌드
```

플레이그라운드의 **[재생]** 은 최종 결과를 다시 그리는 게 아니라 이력을 재적용하므로,
지우개가 지나가는 과정까지 그대로 나온다.

`playground/`는 npm 배포물이 아니다. 라이브러리 소스를 직접 import하므로 수정이 바로 반영되고,
`main`에 푸시하면 GitHub Pages로 배포된다.
