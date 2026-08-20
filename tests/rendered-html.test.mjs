import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the anonymous multiplayer sign-in page", async () => {
  const response = await render("/multiplayer");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>多人牌桌 · RangeCraft<\/title>/i);
  assert.match(html, /先确认身份，再坐上牌桌/);
  assert.match(html, /使用 ChatGPT 登录/);
  assert.match(html, /\/signin-with-chatgpt\?return_to=%2Fmultiplayer/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders the RangeCraft landing page before mounting a poker table", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RangeCraft · 德州扑克训练室<\/title>/i);
  assert.match(html, /把每一手牌/);
  assert.match(html, /进入单人训练/);
  assert.match(html, /免注册入桌/);
  assert.doesNotMatch(html, /正在洗牌/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the multiplayer and strategy boundaries with product metadata", async () => {
  const [page, globalsCss, multiplayerClient, staticMultiplayer, edgeFunction, layout, transport, strategy, policy, sizing, evaluator, selfPlay, serviceWorker, pagesIndex, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/MultiplayerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/poker-api/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/poker-transport.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/poker-strategy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/poker-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/poker-sizing.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/poker-evaluator.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ai-self-play.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function settleShowdown/);
  assert.match(page, /function chooseAiAction/);
  assert.match(page, /function LandingHome/);
  assert.match(page, /function SoloTrainer/);
  assert.match(page, /portalViewFromHash/);
  assert.match(page, /return "#\/multiplayer"/);
  assert.match(page, /近似 GTO 建议/);
  assert.match(page, /加注尺寸路线/);
  assert.match(page, /pokerRaiseTargetForFraction/);
  assert.match(page, /20 手整局/);
  assert.match(page, /function setHeroShowChoice/);
  assert.match(page, /function WinningHands/);
  assert.match(page, /赢家手牌/);
  assert.match(globalsCss, /width: min\(800px, 78%, calc\(82dvh - 59px\)\)/);
  assert.match(globalsCss, /\.seat-0 \{ left: 50%; bottom: -100px/);
  assert.match(globalsCss, /\.seat-3 \{ left: 50%; top: -84px/);
  assert.match(multiplayerClient, /function WinningHands/);
  assert.match(multiplayerClient, /手牌未公开/);
  assert.match(multiplayerClient, /粘贴邀请码/);
  assert.match(multiplayerClient, /复制邀请码/);
  assert.match(multiplayerClient, /FRIENDS CLUB/);
  assert.match(multiplayerClient, /visualSeat/);
  assert.match(multiplayerClient, /3_000 \+ Math\.floor\(Math\.random\(\) \* 2_001\)/);
  assert.match(multiplayerClient, /秒后进入下一手/);
  assert.match(multiplayerClient, /全桌倒计时完成后自动发牌/);
  assert.match(multiplayerClient, /整局时间库/);
  assert.match(multiplayerClient, /时间牌 \+/);
  assert.match(multiplayerClient, /type: "timeout"/);
  assert.doesNotMatch(multiplayerClient, /这是其他玩家唯一能看到的信息/);
  assert.match(staticMultiplayer, /supabase\.co\/functions\/v1\/poker-api/);
  assert.match(staticMultiplayer, /rangecraft\.multiplayer\.guest-token/);
  assert.match(staticMultiplayer, /signOutLabel="返回首页"/);
  assert.doesNotMatch(staticMultiplayer, /onSignOut=\{clearToken\}/);
  assert.match(edgeFunction, /function normalizeRoomSettings/);
  assert.match(edgeFunction, /type === "use-time-bank" \|\| type === "timeout"/);
  assert.match(page, /choosePokerPolicyAction/);
  assert.match(page, /policyPlan\.actionFrequencies/);
  assert.match(page, /弃牌来自翻前范围/);
  assert.match(page, /const TABLE_PRESETS/);
  assert.match(page, /function grantSquid/);
  assert.match(page, /血战鱿鱼计分/);
  assert.match(page, /sampleAiLineup\(PLAYER_TEMPLATES\.length - 1\)/);
  assert.doesNotMatch(page, /shuffle\(PLAYER_TEMPLATES\.slice\(1\)/);
  assert.match(layout, /RangeCraft · 德州扑克训练室/);
  assert.match(transport, /export interface PokerTransport/);
  assert.match(strategy, /export interface PokerStrategyProvider/);
  assert.match(policy, /balancedBluffRate/);
  assert.match(sizing, /跟注后底池/);
  assert.match(sizing, /scorePokerRaiseSize/);
  assert.match(evaluator, /export function estimateEquity/);
  assert.match(selfPlay, /choosePokerPolicyAction/);
  assert.match(selfPlay, /estimateEquity/);
  assert.match(serviceWorker, /key\.startsWith\("rangecraft-"\)/);
  assert.match(pagesIndex, /https:\/\/phyll1s0\.com\/poker\//);
  assert.match(pagesIndex, /在线多人入口/);
  assert.match(packageJson, /"name": "rangecraft-poker-trainer"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
