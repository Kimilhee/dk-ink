# dk-ink

캔버스 하나를 손글씨(digital ink) 에디터로 만드는 프레임워크 비의존 라이브러리.
`dk-script`의 수식 필기 영역을 떼어낸 것이고, 인식·변환은 범위 밖이다.

**[시험용 앱 → kimilhee.github.io/dk-ink](https://kimilhee.github.io/dk-ink/)** (펜/지우개·두께·되돌리기·획 JSON)

- **필압 획** — `PointerEvent.pressure`를 굵기로 반영한다. 캔버스의 `lineWidth`는 획 하나에
  하나뿐이라 점마다 굵기를 못 주므로, 윤곽을 만들어 채운다.
- **벡터 지우개** — 획 단위로 지우지 않고 지나간 자리만 잘라낸다. 글자 가운데를 지나가면
  획이 두 조각으로 남는다.
- **되돌리기 / 다시 실행** — 획 묶음 스냅샷 스택.
- **뭉친 이벤트 복원** — 저사양 기기는 포인터 이벤트를 뭉쳐 보낸다.
  `getCoalescedEvents()`까지 풀어서 궤적이 각지지 않게 한다.
- **DPR 대응** — 백버퍼는 물리 픽셀, 좌표는 CSS 픽셀. `ResizeObserver`로 자동 추적한다.
- **변경 알림** — 획이 바뀔 때마다 `onChange`가 현재 획 전체를 준다. 그대로 저장하거나
  보내면 된다.
- 획 데이터는 전부 평범한 JSON 직렬화 가능 객체다. 저장·전송에 별도 포맷이 필요 없다.

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
  onChange(strokes) {
    console.log(strokes.length);
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
라이브러리가 캔버스에 직접 넣으므로 스타일시트를 따로 불러올 필요가 없다. 넣기 전의 인라인
값은 기억해 두었다가 `destroy()`에서 되돌리므로, 앱이 걸어둔 스타일을 덮어쓴 채 떠나지 않는다.
현재 도구는 `data-tool` 속성으로 노출되니 `canvas[data-tool="eraser"] { cursor: crosshair }`
처럼 쓰면 된다.

`InkPoint.t`는 `PointerEvent.timeStamp` 그대로다 (`performance.now()`와 같은 시간 원점).
뭉쳐 들어온 점들도 각자 실제 샘플 시각을 가지므로, 획순과 필기 속도가 점 데이터에 남는다.

### `InkEditor`

| 멤버                               | 설명                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tool`                             | `"pen"` \| `"eraser"`. 읽기·쓰기.                                                                  |
| `drawing`                          | 획이 진행 중인지.                                                                                  |
| `canUndo` / `canRedo`              | 버튼 활성 상태에 쓴다.                                                                             |
| `getStrokes()`                     | 내부 상태와 분리된 복사본.                                                                         |
| `setStrokes(strokes, options?)`    | 통째로 교체. `{ recordHistory: false }`면 되돌리기 이력을 건너뛴다.                                |
| `getStyle()` / `setStyle(partial)` | 색·굵기·모드·지우개 지름.                                                                          |
| `undo()` / `redo()` / `clear()`    | 바뀐 게 있으면 `true`.                                                                             |
| `resize()`                         | `ResizeObserver`가 부르므로 보통 직접 쓸 일이 없다.                                                |
| `destroy()`                        | 리스너·옵저버 해제, 이력 비움, 캔버스 스타일·`data-tool`을 부착 이전으로 복원. 그린 내용은 그대로. |

### 옵션

| 옵션                                      | 기본값                       |
| ----------------------------------------- | ---------------------------- |
| `tool`                                    | `"pen"`                      |
| `color`                                   | `"#1d4ed8"`                  |
| `strokeWidth`                             | `3` (필압 모드에선 최대)     |
| `widthMode`                               | `"pressure"`                 |
| `opacity`                                 | `0.7`                        |
| `eraserWidth`                             | `50`                         |
| `showEraserCursor`                        | `true`                       |
| `eraserCursorFill` / `eraserCursorStroke` | 청록 계열                    |
| `historyLimit`                            | `50` (`0`이면 되돌리기 없음) |
| `strokes`                                 | 초기 획                      |
| `onChange`                                | —                            |

### 획은 자기 스타일을 들고 다닌다

`Stroke`는 점 배열이 아니라 `{ points, style }`이다. 획을 시작할 때 그 시점의 색·굵기·모드·
투명도를 복사해 넣으므로, 나중에 `setStyle`로 설정을 바꿔도 **이미 그린 획은 그대로다** —
사람이 그때 그 펜으로 쓴 것이기 때문이다. 지우개로 쪼갠 조각도 원래 획의 스타일을 물려받는다.

```ts
type Stroke = { points: InkPoint[]; style: StrokeStyle };
type StrokeStyle = { color: string; strokeWidth: number; widthMode: WidthMode; opacity: number };
```

`setStyle`은 **앞으로 그릴 획**의 설정을 바꾼다. 이미 그린 획을 바꾸려면 `getStrokes()`로
받아 `style`을 고친 뒤 `setStrokes()`로 되돌려 넣으면 된다.

### 하위 함수

에디터를 쓰지 않고 직접 조립할 때 쓸 순수 함수도 내보낸다:
`eraseStrokes` · `renderStrokes` · `drawOutlineStroke` · `drawEraserCursor` ·
`pressureWidth` · `cloneStrokes` · `InkHistory`.

## 개발

```bash
vp install
vp run playground   # 시험용 앱 (펜/지우개/두께/되돌리기/JSON 확인)
vp test
vp check
vp pack             # dist/ 빌드
```

`playground/`는 npm 배포물이 아니다. 라이브러리 소스를 직접 import하므로 수정이 바로 반영되고,
`main`에 푸시하면 GitHub Pages로 배포된다.
