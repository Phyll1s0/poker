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

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `缺少 ${startMarker}`);
  assert.notEqual(end, -1, `缺少 ${endMarker}`);
  return source.slice(start, end);
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
  assert.match(html, /开始之前，先知道这里能练什么/);
  assert.match(html, /完整 GTO 的边界/);
  assert.match(html, /安装成应用/);
  const landingHeader = html.match(/<header class="landing-nav"[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(landingHeader, /aria-label="把 RangeCraft 安装到桌面"/);
  assert.match(landingHeader, /安装应用/);
  assert.match(landingHeader, /aria-label="查看德州扑克规则"/);
  assert.doesNotMatch(html, /正在洗牌/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the multiplayer and strategy boundaries with product metadata", async () => {
  const [page, globalsCss, multiplayerClient, multiplayerCss, staticMultiplayer, edgeFunction, layout, transport, strategy, policy, sizing, evaluator, selfPlay, serviceWorker, pagesIndex, history, packageJson, multiplayerAudio, pokerAudio, rulesModal] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/multiplayer.module.css", import.meta.url), "utf8"),
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
    readFile(new URL("../lib/poker-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/multiplayer-audio-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/poker-audio.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/PokerRulesModal.tsx", import.meta.url), "utf8"),
  ]);

  const landingSource = sourceBetween(page, "function LandingHome", "function SoloTrainer");
  const soloSource = sourceBetween(page, "function SoloTrainer", "function InstallAppModal");

  assert.match(page, /function settleShowdown/);
  assert.match(page, /function chooseAiAction/);
  assert.match(page, /function LandingHome/);
  assert.match(page, /LANDING_GUIDE_ITEMS/);
  assert.match(page, /id="about-range-craft"/);
  assert.match(page, /训练模式、策略边界、规则覆盖和安装方式都放在主页/);
  assert.match(landingSource, /className="install-app-button"/);
  assert.match(landingSource, /aria-label="把 RangeCraft 安装到桌面"/);
  assert.match(landingSource, /aria-label="查看德州扑克规则"/);
  assert.match(landingSource, /onInstallApp/);
  assert.match(landingSource, /onOpenRules/);
  assert.ok(
    page.indexOf("完整 GTO 的边界") < page.indexOf("function SoloTrainer"),
    "产品说明应位于最外层主页，而不是牌桌规则弹窗",
  );
  assert.match(page, /function SoloTrainer/);
  assert.match(page, /portalViewFromHash/);
  assert.match(page, /return "#\/multiplayer"/);
  assert.match(page, /进入加注分支后的尺寸混合/);
  assert.match(page, /function AiDecisionHint/);
  assert.match(page, /AI 决策提示 · 按需查看/);
  assert.match(page, /查看本次 AI 提示/);
  assert.match(page, /const \[revealedHintKey, setRevealedHintKey\]/);
  assert.match(page, /game\.actionHistory\.length/);
  assert.match(page, /revealedHintKey === hintDecisionKey/);
  assert.match(page, /aria-pressed=\{training\}/);
  assert.doesNotMatch(page, /disabled=\{isReviewRun\}/);
  assert.match(page, /setTraining\(nextMode === "per_hand"\)/);
  assert.match(page, /hintUsed: hintUsedForDecision/);
  assert.match(page, /hintedDecisionKeys\.current\.has\(hintDecisionKey\)/);
  assert.match(page, /使用 AI 提示/);
  assert.match(page, /<AiDecisionHint[\s\S]*?compact[\s\S]*?enabled=\{training\}/);
  assert.match(page, /pokerRaiseTargetForFraction/);
  assert.match(page, /resetStacks: false/);
  assert.match(page, /shuffleStyles: false/);
  assert.doesNotMatch(page, /resetStacks: mode === "hand"/);
  assert.match(page, /筹码延续 · 每手即时点评/);
  assert.match(page, /下一手 · 筹码延续/);
  assert.match(page, /startingDepthBefore/);
  assert.match(page, /maxContestableTarget/);
  assert.match(page, /当前双方后手/);
  assert.match(page, /本手起始有效/);
  assert.match(page, /allIn: actualRaiseTo === sizingContext\.playerBet \+ sizingContext\.playerStack/);
  assert.doesNotMatch(page, /allIn: actualRaiseTo === pokerSizingMaxTarget/);
  assert.match(page, /20 手整局/);
  assert.match(page, /type GameMode = "per_hand" \| "session" \| "endless"/);
  assert.match(page, /无尽对局/);
  assert.match(page, /画像自适应 · 主动结束复盘/);
  assert.match(page, /结束无尽局并复盘/);
  assert.match(page, /function pokerRunBbPer100|pokerRunBbPer100/);
  assert.match(page, /BB \/ 100/);
  assert.match(page, /mode === "endless" \? 1\.25 : 0\.7/);
  assert.match(page, /heroActive: !game\.players\[0\]\.folded/);
  assert.match(page, /pokerRunCanStartNextHand\(mode, sessionEnded/);
  assert.match(page, /mode === "per_hand" \|\| finishedGame\.status/);
  assert.match(page, /function setHeroShowChoice/);
  assert.match(page, /function WinningHands/);
  assert.match(page, /赢家手牌/);
  assert.match(page, /bestHandWithCards\(cards\)/);
  assert.match(page, /BEST FIVE · 最佳五张/);
  assert.match(page, /data-source=\{source\}/);
  assert.match(evaluator, /export function bestHandWithCards/);
  assert.match(globalsCss, /\.winning-card-source\[data-source="hole"\]/);
  assert.match(page, /function PrivatePeekOpportunity/);
  assert.match(page, /PRIVATE PEEK · 每手一次/);
  assert.match(page, /只对你可见，不算公开亮牌，也不会改变 AI 对你的画像/);
  assert.match(page, /peekedPlayerIds: \[\]/);
  assert.match(page, /game\.status !== "showdown" \|\| !game\.showChoiceMade/);
  assert.match(page, /pokerPrivatePeekCandidateIds\(game\.players, game\.shownPlayerIds\)/);
  assert.match(page, /PrivatePeekOpportunity game=\{game\} onPeek=\{choosePrivatePeek\}/);
  assert.match(page, /查看德州扑克规则/);
  assert.doesNotMatch(soloSource, /className="install-app-button"|aria-label="把 RangeCraft 安装到桌面"|installHelpOpen|beforeinstallprompt/);
  assert.match(soloSource, /<PokerRulesModal onClose=\{\(\) => setRulesOpen\(false\)\}/);
  assert.match(rulesModal, /TEXAS HOLD.*EM RULEBOOK/);
  assert.match(rulesModal, /从七张牌里组成最强的五张牌/);
  assert.match(rulesModal, /主池、边池与退回/);
  assert.match(rulesModal, /花色不分大小/);
  assert.match(rulesModal, /不足额全下不一定会/);
  assert.match(rulesModal, /不是标准德州扑克规则/);
  assert.match(rulesModal, /多人 2–6 人，支持现金练习与单桌淘汰/);
  assert.doesNotMatch(page, /ABOUT THE LAB|关于 GTO 边界/);
  assert.match(globalsCss, /\.landing-about-grid/);
  assert.match(globalsCss, /\.landing-nav-actions > a:not\(\.landing-account-link\)/);
  assert.match(globalsCss, /\.poker-rules-modal/);
  assert.match(globalsCss, /\.poker-hand-ranks/);
  assert.match(page, /最近 30 手牌谱与回放/);
  assert.match(page, /所有电脑底牌已在赛后记录中公开/);
  assert.match(page, /setSealedRunHistory/);
  assert.match(page, /sessionEnded && sealedRunHistory\.length/);
  assert.match(page, /pokerReplayEventsAtStep\(selectedHistory, replayStep\)/);
  assert.match(page, /function HandHistoryReplayTable/);
  assert.match(page, /hand-history-poker-table/);
  assert.match(page, /replay\.table\.players/);
  assert.match(page, /replay\.table\.action\.label/);
  assert.match(page, /本手总池/);
  assert.match(page, /桌上底池 0/);
  assert.match(page, /replay\.table\.settled && <em>已结算<\/em>/);
  assert.match(page, /<HandHistoryReplayTable entry=\{selectedHistory\} replay=\{replayState\}/);
  assert.match(page, /本轮结束后解锁完整牌谱/);
  assert.match(page, /window\.localStorage\.setItem\(POKER_HAND_HISTORY_STORAGE_KEY/);
  assert.match(globalsCss, /\.hand-history-modal/);
  assert.match(globalsCss, /\.hand-history-players/);
  assert.match(globalsCss, /\.hand-history-table-stage/);
  assert.match(globalsCss, /\.hand-history-table-seat\.is-current/);
  assert.match(globalsCss, /\.hand-history-action-banner/);
  assert.match(history, /POKER_HAND_HISTORY_LIMIT = 30/);
  assert.match(history, /rangecraft\.solo-hand-history\.v1/);
  assert.match(history, /function buildPokerReplayEvents/);
  assert.match(history, /function buildPokerReplayTableState/);
  assert.match(history, /加注到/);
  assert.match(history, /pot = 0/);
  assert.match(history, /function parsePokerHandHistoryJson/);
  assert.doesNotMatch(multiplayerClient, /poker-history|PokerHandHistoryEntry|完整牌谱/);
  assert.match(page, /setInstallHelpOpen\(true\)/);
  assert.match(page, /ChatGPT \/ 微信等内置浏览器/);
  assert.doesNotMatch(page, /if \(!installPrompt\) \{\s*setRulesOpen\(true\)/);
  assert.match(globalsCss, /width: min\(800px, 78%, calc\(82dvh - 59px\)\)/);
  assert.match(globalsCss, /\.seat-0 \{ left: 50%; bottom: -100px/);
  assert.match(globalsCss, /\.seat-3 \{ left: 50%; top: -84px/);
  assert.match(multiplayerClient, /function WinningHands/);
  assert.match(multiplayerClient, /手牌未公开/);
  assert.match(multiplayerClient, /最佳五张/);
  assert.match(multiplayerClient, /winningHands\?\.find/);
  assert.match(multiplayerClient, /function HandHistoryModal/);
  assert.match(multiplayerClient, /function ReplayTable/);
  assert.match(multiplayerClient, /snapshot\?\.table\.handHistory \?\? \[\]/);
  assert.match(multiplayerClient, /牌谱 \{handHistory\.length\}\/30/);
  assert.match(multiplayerClient, /const maxStep = actionCount \+ 1/);
  assert.match(multiplayerClient, /加注到 \$\{action\.raiseTo/);
  assert.match(multiplayerClient, /player\.stackAfterHand/);
  assert.match(multiplayerClient, /<HandHistoryModal/);
  assert.match(multiplayerCss, /\.historyDialog\s*\{/);
  assert.match(multiplayerCss, /\.replayTableViewport\s*\{/);
  assert.match(multiplayerCss, /\.replayActionCurrent\s*\{/);
  assert.match(multiplayerClient, /粘贴邀请码/);
  assert.match(multiplayerClient, /复制邀请码/);
  assert.match(multiplayerClient, /FRIENDS CLUB/);
  assert.match(multiplayerClient, /visualSeat/);
  assert.match(multiplayerClient, /data-suit-tone=\{red \? "red" : "black"\}/);
  assert.match(multiplayerClient, /WebkitTextFillColor: red \? "#c92f35" : "#171b19"/);
  assert.match(multiplayerClient, /const VISUAL_SEATS_BY_PLAYER_COUNT/);
  assert.match(multiplayerClient, /multiplayerBoardDealTransition/);
  assert.match(multiplayerClient, /const BOARD_DEAL_STAGGER_MS = 300/);
  assert.match(multiplayerClient, /styles\.boardDealtCard/);
  assert.match(multiplayerClient, /index - boardDeal\.dealFrom/);
  assert.match(multiplayerClient, /multiplayerAudioTransition\(lastAudioFrame\.current, nextAudioFrame\)/);
  assert.match(multiplayerClient, /lastAudioFrame\.current = nextAudioFrame/);
  assert.match(multiplayerClient, /audioCues\.forEach\(\(cue\) => playPokerSound\(cue\.sound, cue\.delaySeconds\)\)/);
  assert.match(multiplayerClient, /setPokerAudioEnabled\(next\)/);
  assert.match(multiplayerClient, /styles\.navSoundToggle/);
  assert.match(multiplayerClient, /aria-label=\{soundOn \? "关闭牌桌音效" : "开启牌桌音效"\}/);
  assert.match(multiplayerClient, /const \[rulesOpen, setRulesOpen\] = useState\(false\)/);
  assert.match(multiplayerClient, /className=\{styles\.navHelpButton\}/);
  assert.match(multiplayerClient, /aria-label="查看德州扑克规则"/);
  assert.match(multiplayerClient, /<PokerRulesModal onClose=\{\(\) => setRulesOpen\(false\)\} closeLabel="看懂了，回到多人牌桌"/);
  assert.match(multiplayerClient, /const \[tableHintOpen, setTableHintOpen\] = useState\(false\)/);
  assert.match(multiplayerClient, /styles\.navHintToggle/);
  assert.match(multiplayerClient, /查看牌桌操作提示/);
  assert.match(multiplayerClient, /跟注需要再投入 \$\{legal\.callAmount\} 筹码/);
  assert.match(multiplayerClient, /合法范围 \$\{legal\.minRaiseTo\}–\$\{legal\.maxRaiseTo\}/);
  assert.match(multiplayerClient, /朋友局只解释公开规则、合法金额和倒计时/);
  assert.doesNotMatch(multiplayerClient, /evaluatePokerPolicy|choosePokerPolicyAction|actionFrequencies|近似 GTO 建议/);
  assert.match(multiplayerClient, /2: \[0, 3\]/);
  assert.match(multiplayerClient, /3: \[0, 2, 4\]/);
  assert.match(multiplayerClient, /浅筹/);
  assert.match(multiplayerClient, /bigBlinds: 40/);
  assert.match(multiplayerClient, /标准/);
  assert.match(multiplayerClient, /bigBlinds: 100/);
  assert.match(multiplayerClient, /深筹/);
  assert.match(multiplayerClient, /bigBlinds: 200/);
  assert.match(multiplayerClient, /role="radiogroup" aria-label="筹码深度"/);
  assert.match(multiplayerClient, /const \[actionSeconds, setActionSeconds\] = useState\(20\)/);
  assert.match(multiplayerClient, /\[5, 10, 15, 20, 30, 45, 60\]\.map\(\(value\) => <option/);
  assert.match(multiplayerClient, /"createRoom", \{[\s\S]*?actionSeconds,[\s\S]*?timeBankSeconds,/);
  assert.match(multiplayerClient, /每次 \{actionSeconds\}s/);
  assert.match(multiplayerClient, /className=\{styles\.primaryActions\}/);
  assert.match(multiplayerClient, /className=\{styles\.raiseControl\}/);
  assert.match(multiplayerClient, /addEventListener\("keydown", handleTableShortcut\)/);
  assert.match(multiplayerClient, /SHOW OR MUCK · 本手赢家/);
  assert.match(multiplayerClient, /亮牌选择与全桌共用同一个下一手倒计时/);
  assert.match(multiplayerClient, /到点未选择会自动盖牌/);
  assert.match(multiplayerClient, /秒后生成整局结算/);
  assert.match(multiplayerClient, /不会增加额外等待/);
  assert.match(multiplayerClient, /这是服务端统一倒计时/);
  assert.match(multiplayerClient, /styles\.nextHandWaitingPanel[\s\S]*?styles\.showDecisionInline[\s\S]*?styles\.autoNextHand/);
  assert.doesNotMatch(multiplayerClient, /styles\.showDecisionPanel|亮牌选择最长 8 秒/);
  assert.match(multiplayerClient, /street: game\.street/);
  assert.match(multiplayerClient, /bigBlind: snapshot\?\.table\.bigBlind/);
  assert.match(multiplayerClient, /showDecisionDeadlineAt/);
  assert.match(multiplayerClient, /nextHandAt/);
  assert.doesNotMatch(multiplayerClient, /3_000 \+ Math\.floor\(Math\.random\(\) \* 2_001\)/);
  assert.match(multiplayerClient, /秒后进入下一手/);
  assert.match(multiplayerClient, /任一在线玩家都可在到点后触发发牌/);
  assert.match(multiplayerClient, /单桌淘汰赛结束/);
  assert.match(multiplayerClient, /整局时间库/);
  assert.match(multiplayerClient, /时间牌 \+/);
  assert.match(multiplayerClient, /type: "timeout"/);
  assert.match(multiplayerClient, /player\.streetCommitted > 0/);
  assert.doesNotMatch(multiplayerClient, /player\.committed > 0/);
  assert.match(multiplayerClient, /const \[raiseDraft, setRaiseDraft\]/);
  assert.match(multiplayerClient, /快捷下注尺寸/);
  assert.match(multiplayerClient, /raiseAllInOnly/);
  assert.match(multiplayerClient, /void loadRooms\(\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(multiplayerClient, /setRaiseTo\(next\.game\.legalActions\.minRaiseTo\)/);
  assert.match(multiplayerClient, /暂离牌桌（保留座位）/);
  assert.match(multiplayerClient, /未全下的手牌会自动弃牌；已经全下的手牌会继续结算/);
  assert.match(multiplayerClient, /const leavingRef = useRef\(false\)/);
  assert.match(multiplayerClient, /const roomViewGeneration = useRef\(0\)/);
  assert.match(multiplayerClient, /viewedRoomId\.current !== roomId/);
  assert.match(multiplayerClient, /const viewIsCurrent = \(\) =>/);
  assert.match(multiplayerClient, /next\.room\.revision >= latestRevision\.current/);
  assert.match(multiplayerClient, /leavingRef\.current \|\| next\.room\.revision < latestRevision\.current/);
  assert.match(multiplayerClient, /leavingRef\.current = true/);
  assert.match(multiplayerClient, /已永久离开/);
  assert.match(multiplayerClient, /type: "finish"/);
  assert.match(multiplayerClient, /type: "restart"/);
  assert.match(multiplayerClient, /所有人的本局分析/);
  assert.match(multiplayerClient, /不虚构求解器 EV 损失或“GTO 准确率”/);
  assert.match(multiplayerClient, /sessionReport/);
  assert.doesNotMatch(multiplayerClient, /const canLeave =/);
  assert.doesNotMatch(multiplayerClient, /!canLeave/);
  assert.doesNotMatch(multiplayerClient, /这是其他玩家唯一能看到的信息/);
  assert.match(multiplayerCss, /\.multiplayerPage \.card\.redCard,[\s\S]*?\.multiplayerPage \.miniCard\.redCard\s*\{\s*color:/);
  assert.match(multiplayerCss, /\.multiplayerPage \.card\.blackCard,[\s\S]*?\.multiplayerPage \.miniCard\.blackCard\s*\{\s*color:/);
  assert.match(multiplayerCss, /\.multiplayerPage \.boardDealtCard\s*\{[\s\S]*?animation:\s*multiplayerDealCommunityCard 0\.48s/);
  assert.match(multiplayerCss, /\.winningBestFive\s*\{/);
  assert.match(multiplayerCss, /\.multiplayerPage \.winningHandCards \.card\s*\{/);
  assert.match(multiplayerCss, /\.multiplayerPage \.seatSelf \.miniCard,[\s\S]*?width:\s*48px/);
  assert.match(multiplayerCss, /\.navHelpButton\s*\{[\s\S]*?width:\s*32px/);
  assert.match(multiplayerCss, /@media \(max-width: 700px\)[\s\S]*?\.multiplayerPage \.seatSelf \.miniCard,[\s\S]*?width:\s*52px/);
  assert.match(multiplayerCss, /@keyframes multiplayerDealCommunityCard/);
  assert.match(multiplayerCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.multiplayerPage \.boardDealtCard/);
  assert.match(multiplayerCss, /\[data-suit-tone="red"\][\s\S]*?-webkit-text-fill-color:\s*#c92f35/);
  assert.match(multiplayerCss, /\[data-suit-tone="black"\][\s\S]*?-webkit-text-fill-color:\s*#171b19/);
  assert.match(multiplayerCss, /width: min\(800px, 78%, calc\(82dvh - 59px\)\)/);
  assert.match(multiplayerCss, /grid-template-columns: 150px minmax\(330px, 1fr\) 270px/);
  assert.match(multiplayerCss, /\.handTransition\s*\{[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(multiplayerCss, /\.showDecisionInline\s*\{[\s\S]*?border-bottom:/);
  assert.match(multiplayerCss, /\.nextHandWaitingPanel\s*\{[\s\S]*?display:\s*grid/);
  assert.doesNotMatch(multiplayerCss, /\.showDecisionPanel/);
  assert.match(multiplayerCss, /\.sessionSummary\s*\{/);
  assert.match(multiplayerCss, /\.summaryGrid\s*\{/);
  assert.match(staticMultiplayer, /supabase\.co\/functions\/v1\/poker-api/);
  assert.match(staticMultiplayer, /rangecraft\.multiplayer\.guest-token/);
  assert.match(staticMultiplayer, /signOutLabel="返回首页"/);
  assert.doesNotMatch(staticMultiplayer, /onSignOut=\{clearToken\}/);
  assert.match(edgeFunction, /function normalizeRoomSettings/);
  assert.match(edgeFunction, /result\?\.totalPot \?\? hand\.committedPot/);
  assert.match(edgeFunction, /raiseAllInOnly: table\.legalActions\.raise\?\.allInOnly \?\? false/);
  assert.match(edgeFunction, /result\.winnerDetails/);
  assert.match(edgeFunction, /bestOnlineHand\(\[\.\.\.hand\.community, \.\.\.detail\.holeCards\]\)/);
  assert.match(edgeFunction, /if \(!detail\?\.holeCards/);
  assert.match(edgeFunction, /type === "use-time-bank" \|\| type === "timeout"/);
  assert.match(edgeFunction, /type === "finish"/);
  assert.match(edgeFunction, /type === "restart"/);
  assert.match(edgeFunction, /actionSeq: hand\.actionSeq/);
  assert.match(edgeFunction, /recentActions: hand\.recentActions\.map/);
  assert.match(multiplayerAudio, /MULTIPLAYER_AUDIO_EVENT_MAX_AGE_MS = 5_000/);
  assert.match(multiplayerAudio, /event\.seq > previous\.actionSeq/);
  assert.match(multiplayerAudio, /sound: "deal"/);
  assert.match(multiplayerAudio, /sound: "win"/);
  assert.match(pokerAudio, /export function isPokerAudioEnabled/);
  assert.match(pokerAudio, /if \(!pokerAudioEnabled\) return/);
  assert.match(page, /useState\(\(\) => isPokerAudioEnabled\(\)\)/);
  assert.match(page, /choosePokerPolicyAction/);
  assert.match(page, /policyPlan\.actionFrequencies/);
  assert.match(page, /resolvePokerDecisionStacks/);
  assert.match(page, /pokerCallClosesContestableLayers/);
  assert.match(page, /pokerContestablePotAtDecision/);
  assert.match(page, /callEndsHand: callClosesPlayerAction/);
  assert.match(page, /这次跟注会让你全下，之后不再有决策/);
  assert.match(page, /按可争夺底池计算的即时筹码 EV/);
  assert.doesNotMatch(page, /fold:\s*0\.72/);
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
  assert.match(policy, /input\.callEndsHand/);
  assert.match(policy, /opponentsCanRespond/);
  assert.match(policy, /export function pokerCallClosesContestableLayers/);
  assert.match(policy, /export function pokerContestablePotAtDecision/);
  assert.match(policy, /export function pokerDecisionStackContext/);
  assert.match(sizing, /跟注后底池/);
  assert.match(sizing, /scorePokerRaiseSize/);
  assert.match(evaluator, /export function estimateEquity/);
  assert.match(selfPlay, /choosePokerPolicyAction/);
  assert.match(selfPlay, /estimateEquity/);
  assert.match(selfPlay, /resolvePokerDecisionStacks/);
  assert.match(selfPlay, /pokerCallClosesContestableLayers/);
  assert.match(selfPlay, /pokerContestablePotAtDecision/);
  assert.match(serviceWorker, /key\.startsWith\("rangecraft-"\)/);
  assert.match(pagesIndex, /https:\/\/phyll1s0\.com\/poker\//);
  assert.match(pagesIndex, /在线多人入口/);
  assert.match(packageJson, /"name": "rangecraft-poker-trainer"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
