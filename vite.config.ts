import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: { resolveDepSubpath: true },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // 헬퍼 함수를 파일 아래쪽에 모으는 건 이 레포의 컨벤션이므로 함수는 뺀다. 끌어올려지지
      // 않는 `const`/`let`만 본다 — 첫 사용보다 아래에 선언하면 모듈 실행이 거기서 멈추는데,
      // 타입 검사도 빌드도 이걸 못 잡는다 (v0.1.1~0.1.2에서 실제로 나간 버그다).
      "no-use-before-define": ["error", { functions: false, variables: true, classes: true }],
    },
  },
  fmt: {},
});
