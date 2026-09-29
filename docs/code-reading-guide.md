# dk-ink 코드 분석 커리큘럼

이 가이드는 **화면에서 한 번 조작하고 → 다이어그램에서 흐름을 찾고 → 실제 코드와 테스트로 확인**하는 순서로 읽는다. 각 단계의 완료 조건을 설명할 수 있으면 다음으로 넘어간다. 예상 시간은 단계당 15~25분이다.

## 준비

1. [시험용 앱](https://kimilhee.github.io/dk-ink/)에서 펜으로 선을 하나 그리고, `획 JSON 보기`를 눌러 본다.
2. [코드 구조도](https://kimilhee.github.io/dk-ink/analysis/dk-ink-architecture.html)와 [펜 입력 순서도](https://kimilhee.github.io/dk-ink/analysis/pen-gesture.html)를 새 탭으로 연다. 로컬에서도 `playground/public/analysis/`의 HTML 파일을 바로 열 수 있다.
3. 저장소에서 `vp install` 후 `vp run playground`로 직접 실행한다. 작업을 확인할 때는 `vp test`와 `vp check`를 쓴다.

다이어그램은 코드를 읽는 지도다. 노드를 눌러 설명과 소스 위치를 확인하고, 구체적인 동작은 해당 코드에서 검증한다. 구조도에서 `획 데이터`는 별도 데이터베이스가 아니라 에디터의 메모리 안에 있는 배열이다.

## 1. 바깥에서 안으로: 무엇을 제공하나

**읽기:** [`README.md`](../README.md), [`src/index.ts`](../src/index.ts), [`src/types.ts`](../src/types.ts), [`playground/main.ts`](../playground/main.ts)의 `createInkEditor` 호출.

**해보기:** 선을 하나 그려 JSON을 연다. `points`와 `style`을 찾아 색과 좌표를 확인한다.

**완료 조건:** `createInkEditor(canvas, options)`가 돌려주는 것과 `Stroke = { points, style }`가 의미하는 것을 말할 수 있다. `src/index.ts`가 공개 API를 모아 내보내고, `playground`는 그 API를 쓰는 앱이라는 점을 구분한다.

## 2. 펜 한 획을 따라가기

**그림:** [펜 입력 순서도](https://kimilhee.github.io/dk-ink/analysis/pen-gesture.html).

**읽기:** [`src/editor.ts`](../src/editor.ts)의 `pointerDown`, `pointerMove`, `pointerUp`, `timedPoint`, `scheduleRedraw`와 [`tests/editor.test.ts`](../tests/editor.test.ts).

**해보기:** 펜으로 천천히 선 하나를 긋고 `pointerdown → pointermove → pointerup`에서 `strokes`가 어떻게 바뀌는지 종이에 3줄로 적는다. `getCoalescedEvents()`가 여러 점을 돌려줄 때의 반복문도 찾는다.

**완료 조건:** 왜 `pointerDown`에서 변경 전 획을 이력에 넣는지, `onChange`가 이동할 때마다 불리지 않고 종료 시 호출되는지 설명한다. 한 제스처 중 도구를 바꿔도 `activeTool`이 고정된다는 점을 찾는다.

## 3. 획이 화면에 보이는 이유

**그림:** [코드 구조도](https://kimilhee.github.io/dk-ink/analysis/dk-ink-architecture.html)의 `획 데이터 → 캔버스 렌더러 → 필압 윤곽선`.

**읽기:** [`src/render.ts`](../src/render.ts)의 `renderStrokes`, `pressureWidth`, [`src/outline.ts`](../src/outline.ts)의 `drawOutlineStroke`, [`tests/render.test.ts`](../tests/render.test.ts).

**해보기:** 시험용 앱에서 `필압적용`과 `고정두께`를 번갈아 고른 뒤 선을 그린다. 코드에서 두 모드가 갈라지는 조건을 찾는다.

**완료 조건:** 왜 `renderStrokes`가 전체를 지우고 다시 그리는지, 필압 모드에서는 왜 `lineWidth` 대신 채운 윤곽선이 필요한지 설명한다. `resize()`가 CSS 픽셀 좌표와 DPR 백버퍼를 어떻게 연결하는지도 확인한다.

## 4. 지우개로 획을 나누기

**그림:** [코드 구조도](https://kimilhee.github.io/dk-ink/analysis/dk-ink-architecture.html)의 `에디터 → 벡터 지우개 → 획 데이터`.

**읽기:** [`src/editor.ts`](../src/editor.ts)의 `eraseBetween`과 지우개 분기, [`src/erase.ts`](../src/erase.ts)의 `eraseStrokes`, `intersectsEraser`, `splitOutsideEraser`, [`tests/erase.test.ts`](../tests/erase.test.ts).

**해보기:** 긴 선 하나를 그리고 가운데를 지운다. JSON에서 획이 둘로 나뉘는지 확인한다. 코드에서 `changed`가 `false`일 때 이력이 어떻게 처리되는지 찾는다.

**완료 조건:** 지우개가 이미지 픽셀을 지우는 방식이 아니라 기존 `Stroke`를 조각으로 바꾼다는 점을 설명한다. 분할된 조각이 원래 `style`을 이어받는 위치를 찾는다.

## 5. 되돌리기와 외부에서 상태 바꾸기

**읽기:** [`src/history.ts`](../src/history.ts)의 `commit`, `undo`, `redo`, `cloneStrokes`; [`src/editor.ts`](../src/editor.ts)의 `setStrokes`, `undo`, `redo`, `clear`; [`tests/history.test.ts`](../tests/history.test.ts).

**해보기:** 선 두 개를 그리고 `undo → redo → 새 선` 순으로 조작한다. 새 선을 그린 뒤 `redo` 버튼이 왜 비활성화되는지 `#future`를 보며 설명한다.

**완료 조건:** 이전 상태 스냅샷이 언제 저장되는지, `getStrokes()`가 왜 복사본을 주는지, `setStrokes(..., { recordHistory: false })`가 어떤 경우에 필요한지 설명한다.

## 6. 통합과 수명 주기

**읽기:** [`playground/main.ts`](../playground/main.ts)의 손가락 입력 필터와 도구 버튼 연결, [`src/editor.ts`](../src/editor.ts)의 `resize`와 `destroy`, [`tests/lifecycle.test.ts`](../tests/lifecycle.test.ts).

**해보기:** 캔버스 크기를 바꿔도 획 좌표가 유지되는 경로를 따라간다. `destroy()`가 해제하는 리스너와 `ResizeObserver`, 되돌리는 인라인 스타일을 목록으로 적는다.

**완료 조건:** 앱이 담당하는 UI·설정과 라이브러리가 담당하는 입력·획·렌더링의 경계를 설명한다.

## 마지막 점검

코드를 보지 않고 아래 네 가지를 말해 본다. 막히면 해당 단계의 그림과 파일로 돌아간다.

1. 펜을 누르고 떼면 `Stroke`는 어느 순서로 만들어지고 그려지는가?
2. 획 가운데를 지우면 데이터가 어떻게 변하고, 되돌리기는 어떻게 가능한가?
3. 색을 바꾼 뒤에도 이전 선 색이 유지되는 이유는 무엇인가?
4. 앱에서 에디터를 제거할 때 `destroy()`는 무엇을 정리하는가?

그다음 작은 실습으로 기본 펜 색을 바꿔 보고, 시험용 앱에서 새 획에만 적용되는지 확인한다. `vp test`와 `vp check`가 통과하면 코드 흐름을 실제로 따라간 것이다.
