/**
 * `createInkEditor`를 노드에서 돌리기 위한 최소 캔버스 대역.
 *
 * 렌더 결과는 검증 대상이 아니라 호출만 기록한다. 이 테스트가 확인하는 건
 * PointerEvent → Stroke 캡처 경로다.
 */
export interface FakeCanvas {
  canvas: HTMLCanvasElement;
  emit(type: string, init: FakePointerInit): void;
  readonly renderCount: number;
  /** 점선 원(지우개 커서)이 그려진 횟수. setLineDash는 커서만 쓴다. */
  readonly cursorDrawCount: number;
}

export interface FakePointerInit {
  x: number;
  y: number;
  pressure?: number;
  pointerId?: number;
  /** `PointerEvent.timeStamp`. 생략하면 호출마다 1씩 오른다. */
  timeStamp?: number;
  /** `getCoalescedEvents()`가 돌려줄 점. 빈 배열도 실제로 일어난다. */
  coalesced?: Array<{ x: number; y: number; pressure?: number; timeStamp?: number }>;
  /** `getCoalescedEvents()`가 빈 배열을 돌려주는 상황을 재현한다. */
  emptyCoalesced?: boolean;
}

export function createFakeCanvas(
  width = 400,
  height = 200,
  options: { failPointerCapture?: boolean } = {},
): FakeCanvas {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let renderCount = 0;
  let cursorDrawCount = 0;
  let clock = 0;

  const context2d = new Proxy(
    {
      setTransform() {},
      clearRect() {
        renderCount += 1;
      },
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      arc() {},
      fill() {},
      stroke() {},
      setLineDash() {
        cursorDrawCount += 1;
      },
    } as Record<string, unknown>,
    {
      get(target, key) {
        return key in target ? target[key as string] : undefined;
      },
      set(target, key, value) {
        target[key as string] = value;
        return true;
      },
    },
  );

  const canvas = {
    width,
    height,
    style: {
      setProperty() {},
      removeProperty() {},
    } as unknown as CSSStyleDeclaration,
    dataset: {} as DOMStringMap,
    getContext: () => context2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    setPointerCapture() {
      // 포인터가 이미 놓였으면 브라우저가 실제로 이렇게 던진다.
      if (options.failPointerCapture) {
        throw new Error("No active pointer with the given id is found.");
      }
    },
    releasePointerCapture() {},
    addEventListener(type: string, handler: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      listeners.get(type)?.delete(handler);
    },
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    emit(type, init) {
      clock += 1;
      const event = {
        pointerId: init.pointerId ?? 1,
        clientX: init.x,
        clientY: init.y,
        pressure: init.pressure ?? 0.5,
        timeStamp: init.timeStamp ?? clock,
        preventDefault() {},
        getCoalescedEvents: init.coalesced
          ? () =>
              init.coalesced!.map((point, index) => ({
                clientX: point.x,
                clientY: point.y,
                pressure: point.pressure ?? 0.5,
                timeStamp: point.timeStamp ?? clock + index / 100,
              }))
          : undefined,
        ...(init.emptyCoalesced ? { getCoalescedEvents: () => [] } : {}),
      };
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    get renderCount() {
      return renderCount;
    },
    get cursorDrawCount() {
      return cursorDrawCount;
    },
  };
}

export interface BrowserGlobals {
  /** 예약된 프레임 콜백을 실행한다. */
  flushFrames(): void;
  restore(): void;
}

/**
 * ResizeObserver / requestAnimationFrame 등 브라우저 전역을 채운다.
 *
 * rAF는 실제 브라우저처럼 **비동기**로 흉내낸다. 콜백을 즉시 실행하면
 * `frame = requestAnimationFrame(...)` 의 대입이 콜백보다 늦게 끝나서, 콜백이 비운
 * 핸들에 옛 값이 다시 박히고 이후 렌더가 전부 건너뛰어진다.
 */
export function installBrowserGlobals(): BrowserGlobals {
  const target = globalThis as Record<string, unknown>;
  const saved = { ...target };
  const keys = ["ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "window"];
  const frames = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;

  target.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  target.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    frames.set(handle, callback);
    return handle;
  };
  target.cancelAnimationFrame = (handle: number) => {
    frames.delete(handle);
  };
  target.window = { devicePixelRatio: 2 };

  return {
    flushFrames() {
      const pending = [...frames];
      frames.clear();
      for (const [, callback] of pending) callback(0);
    },
    restore() {
      for (const key of keys) {
        if (key in saved) target[key] = saved[key];
        else delete target[key];
      }
    },
  };
}
