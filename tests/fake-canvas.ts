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
}

export interface FakePointerInit {
  x: number;
  y: number;
  pressure?: number;
  pointerId?: number;
  /** `getCoalescedEvents()`가 돌려줄 점. 빈 배열도 실제로 일어난다. */
  coalesced?: Array<{ x: number; y: number; pressure?: number }>;
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
      setLineDash() {},
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
      const event = {
        pointerId: init.pointerId ?? 1,
        clientX: init.x,
        clientY: init.y,
        pressure: init.pressure ?? 0.5,
        preventDefault() {},
        getCoalescedEvents: init.coalesced
          ? () =>
              init.coalesced!.map((point) => ({
                clientX: point.x,
                clientY: point.y,
                pressure: point.pressure ?? 0.5,
              }))
          : undefined,
        ...(init.emptyCoalesced ? { getCoalescedEvents: () => [] } : {}),
      };
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    get renderCount() {
      return renderCount;
    },
  };
}

/** ResizeObserver / requestAnimationFrame 등 브라우저 전역을 채운다. */
export function installBrowserGlobals(): () => void {
  const target = globalThis as Record<string, unknown>;
  const saved = { ...target };
  const keys = ["ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "window"];

  target.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // rAF를 즉시 실행해 테스트가 프레임을 기다리지 않게 한다.
  target.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  target.cancelAnimationFrame = () => {};
  target.window = { devicePixelRatio: 2 };

  return () => {
    for (const key of keys) {
      if (key in saved) target[key] = saved[key];
      else delete target[key];
    }
  };
}
