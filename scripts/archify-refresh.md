$archify 스킬로 이 저장소의 최신 코드를 읽고 기존 분석 문서 5개를 다시 생성한다.
이 파일은 `vp run archify:refresh`의 작업 지시다. 해당 스크립트를 재귀 호출하지 않는다.

- 프로젝트 지침을 읽고 src/와 playground/의 실제 호출·분기·상태 변경을 추적한다.
- 구조도, 펜 입력 순서도, 렌더링 데이터 흐름도, 지우개 흐름도, 되돌리기 상태도를 모두 갱신한다.
- 기존 .archify/**/candidate.json은 참고만 한다. revision이나 줄 번호만 바꾸거나 기존 JSON만 렌더링해서 끝내지 않는다.
- 각 다이어그램에 새 .archify/<type>-<slug>-<로컬 시각>/ 폴더를 만들고 candidate.json과 검증된 HTML을 보관한다. 이전 결과는 보존한다.
- 현재 HEAD를 저장소 근거로 고정하고 각 노드의 sources를 실제 코드와 대조한다. 미커밋 소스 변경이 있으면 HEAD의 코드와 구분하고, 근거가 검증되지 않는 문서를 최신이라고 표시하지 않는다.
- 한국어 설명과 정확한 코드 식별자를 사용한다. 한국어 Viewer 번역을 제공하지 않으면 Viewer UI의 영어 fallback을 명시한다.
- 각 후보에 archify finalize를 --repo-root 및 --quality showcase로 실행하여 검증·전달·브라우저 검사를 모두 통과시킨다. 실패를 숨기거나 검사를 우회하지 않는다.
- 5개가 모두 통과한 다음 HTML을 playground/public/analysis/ 아래의 기존 파일명으로 복사한다:
  dk-ink-architecture.html, pen-gesture.html, render-dataflow.html, eraser-workflow.html, history-lifecycle.html.
- 설명이 달라진 경우 docs/code-reading-guide.md도 실제 코드에 맞춘다. 라이브러리와 playground의 동작은 바꾸지 않는다.
- 레포 규칙에 따라 package.json patch 버전을 한 번 올리고 상단 표시가 해당 버전을 사용하는지 확인한다.
- vp check, vp test, vp run playground:build를 실행한다.
- 이 명령은 로컬 문서 재생성만 수행한다. 커밋·push·배포하지 않는다. 사용자의 다른 변경을 되돌리지 않는다.
- 마지막에 생성 경로와 검증 결과, 미해결 문제를 간결하게 보고한다.
