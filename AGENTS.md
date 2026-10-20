<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## 이 레포의 규칙

- 커밋 메시지의 제목과 본문은 모두 한글로 작성한다. 코드 식별자, 고유명사, 이슈 참조는 원문을 유지할 수 있다.
- 사용자가 명시적으로 배포하지 말라고 지시하지 않은 한, 작업 완료 후 GitHub Pages 배포까지 수행하고 배포 성공 여부를 확인한다.
- 상태를 가진 객체는 `class` 대신 `createXxx()` 생성자 함수로 만든다 (클로저로 상태를 숨기고, 공개 모양은 `type`으로 정의). `class`는 상속·`instanceof`·대량 인스턴스 등 꼭 필요한 경우에만 쓴다.
- 객체 모양은 `interface` 대신 `type`으로 정의한다. 확장은 `extends` 대신 `&`로 한다. `interface`는 선언 병합(외부 타입 보강 등)이 꼭 필요한 경우에만 쓴다.
- 모둔 수정 사항에 대해서 package.json의 sem version의 마지막 patch 버전을 올리고 화면 상단에 해당 버전이 표시되게 할것.
