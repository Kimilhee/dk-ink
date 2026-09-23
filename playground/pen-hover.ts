/**
 * 스타일러스가 화면에 닿지 않고 근접만 한 상태(호버)를 감지한다.
 *
 * 왜 필요한가: 일부 기기(예: S펜 지원 갤럭시탭)는 펜이 근접해 있는 동안 손가락 터치를
 * 화면 어디서든 OS 레벨에서 막아 브라우저까지 보내지 않는다. 막힌 터치 자체는 웹 페이지가
 * 관찰할 수 없으므로, 대신 원인인 호버를 감지해 "지금은 손가락이 안 먹는다"를 UI로 알린다.
 */

/** 호버 중이라도 이 판정이 참이면 근접으로 보지 않는다(예: 펜이 도구 모음 위에 있을 때). */
type ExemptCheck = (event: PointerEvent) => boolean;

type HoverChange = (near: boolean, reason: string) => void;

/** 마지막 펜 이벤트 이후 이만큼 조용하면 호버가 끝난 것으로 본다. */
const IDLE_TIMEOUT_MS = 700;

export function watchPenHover(isExempt: ExemptCheck, onChange: HoverChange): void {
  let near = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function set(next: boolean, reason: string): void {
    if (next === near) return;
    near = next;
    onChange(near, reason);
  }

  function refresh(event: PointerEvent): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    // 펜이 멀어지는 것을 `pointerout`으로 알려주지 않는 기기를 위한 폴백이다.
    idleTimer = setTimeout(() => set(false, "시간 초과"), IDLE_TIMEOUT_MS);
    set(!isExempt(event), "펜 근접");
  }

  function forget(reason: string): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
    set(false, reason);
  }

  document.addEventListener("pointermove", (event) => {
    if (event.pointerType === "pen") refresh(event);
  });
  for (const type of ["pointerdown", "pointerup"] as const) {
    document.addEventListener(type, (event) => {
      if (event.pointerType === "pen") refresh(event);
    });
  }
  // 펜이 호버 범위를 벗어나면 `relatedTarget`이 비어 있다. 엘리먼트 사이를 옮겨 다닐 때는
  // 다음 엘리먼트가 들어 있으므로 그것과 구분된다. 이 이벤트를 듣지 않고 위의 타이머에만
  // 기대면, 화면의 포인터는 이미 사라졌는데 표시가 한참 뒤에 풀린다.
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType === "pen" && event.relatedTarget === null) forget("pointerout");
  });
}
