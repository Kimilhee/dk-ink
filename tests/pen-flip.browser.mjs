// Run with the playground on :5179 and Chrome remote debugging on :9231.
import assert from "node:assert/strict";
import packageJson from "../package.json" with { type: "json" };
const pages = await (await fetch("http://127.0.0.1:9231/json/list")).json();
const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(msg.error);
    else p.resolve(msg.result);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails)
    throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await call("Page.enable");
await call("Page.navigate", { url: process.env.PEN_TEST_URL ?? "http://127.0.0.1:5179/" });
await sleep(200);
for (let n = 0; n < 100; n++) {
  if (
    await evaluate(
      `document.querySelector('#app-version')?.textContent === 'v${packageJson.version}'`,
    )
  )
    break;
  await sleep(50);
}
const canvas = await evaluate(
  '(() => {const r=document.querySelector("#ink").getBoundingClientRect(); return {x:r.left+250,y:r.top+200};})()',
);
const mouse = (type, x, y, extra = {}) =>
  call("Input.dispatchMouseEvent", { type, x, y, pointerType: "pen", ...extra });
const hover = () => mouse("mouseMoved", canvas.x, canvas.y);
const state = () =>
  evaluate(
    '(() => {const i=document.querySelector(".pen-flip"),r=i.getBoundingClientRect(); return {hidden:i.hidden,x:r.left+r.width/2,y:r.top+r.height/2,left:parseFloat(i.style.left),top:parseFloat(i.style.top),flipped:i.classList.contains("is-flipped"),tool:document.querySelector("#ink").dataset.tool,status:document.querySelector("#status").textContent};})()',
  );
const click = async (x, y) => {
  await mouse("mousePressed", x, y, { button: "left", buttons: 1, clickCount: 1 });
  await mouse("mouseReleased", x, y, { button: "left", buttons: 0, clickCount: 1 });
};
await hover();
await sleep(30);
let initial = await state();
assert.equal(initial.hidden, false);
assert.equal(initial.x, canvas.x + 20);
assert.equal(initial.y, canvas.y - 20);
await click(initial.x, initial.y);
let first = await state();
assert.equal(first.status, "획 1개");
assert.equal(first.tool, "pen");
assert.equal(first.flipped, false);
assert.equal(first.top, initial.top);
assert.equal(first.left, initial.left);
await evaluate(
  'document.querySelector("#ink").dispatchEvent(new PointerEvent("pointerout", {pointerType:"pen", bubbles:true, relatedTarget:null}))',
);
assert.equal((await state()).hidden, false, "Pen lift must preserve the second-tap window");
await sleep(210);
let raised = await state();
const hits = await evaluate(`(() => {
  const image=document.querySelector('.pen-flip-image'), r=image.getBoundingClientRect();
  return [
    document.elementFromPoint(r.left-1, r.top+r.height/2)?.id,
    document.elementFromPoint(r.right+1, r.top+r.height/2)?.id,
    document.elementFromPoint(r.left+r.width/2, r.top-1)?.id,
    document.elementFromPoint(r.left+r.width/2, r.bottom+1)?.id,
    document.elementFromPoint(r.left+1, r.top+1)?.className,
  ];
})()`);
assert.deepEqual(hits, ["ink", "ink", "ink", "ink", "pen-flip-image"]);
await click(raised.x - 17, raised.y);
assert.equal((await state()).tool, "pen", "Transparent margin must not switch tools");
assert.equal((await state()).hidden, false);
assert.equal((await state()).status, "획 2개", "Transparent margin must write on the canvas");
await mouse("mouseMoved", raised.x, raised.y);
await click(raised.x, raised.y);
let second = await state();
assert.equal(second.flipped, true);
assert.equal(second.tool, "eraser");
assert.equal(second.top, initial.top);
await sleep(750);
await hover();
await sleep(220);
initial = await state();
await mouse("mousePressed", initial.x, initial.y, { button: "left", buttons: 1, clickCount: 1 });
assert.equal((await state()).tool, "eraser", "Press alone must keep eraser mode");
assert.equal(
  (await state()).status,
  initial.status,
  "Returning to pen must not erase on the canvas",
);
await mouse("mouseReleased", initial.x, initial.y, { button: "left", buttons: 0, clickCount: 1 });
assert.equal((await state()).tool, "pen");
await sleep(750);
await hover();
await sleep(220);
initial = await state();
await click(initial.x, initial.y);
await sleep(550);
let expired = await state();
assert.equal(expired.left, initial.left);
assert.equal(expired.top, initial.top);
assert.equal(expired.flipped, false);
assert.equal(expired.tool, "pen");
await sleep(100);
expired = await state();
assert.ok(Math.abs(expired.x - initial.x) < 1);
await sleep(750);
await hover();
await sleep(220);
initial = await state();
await mouse("mousePressed", initial.x, initial.y, { button: "left", buttons: 1, clickCount: 1 });
await mouse("mouseMoved", canvas.x + 80, canvas.y + 30, { button: "left", buttons: 1 });
await sleep(250);
assert.equal((await state()).hidden, false);
assert.equal((await state()).tool, "pen");
await sleep(300);
assert.equal((await state()).hidden, true);
await mouse("mouseReleased", canvas.x + 80, canvas.y + 30, {
  button: "left",
  buttons: 0,
  clickCount: 1,
});
console.log(
  "PASS: first tap stays in place, pen lift preserves the second-tap window, margins write, double tap selects eraser, single release returns to pen, 500ms expiry hides during writing",
);
console.log(expired.status);
ws.close();
