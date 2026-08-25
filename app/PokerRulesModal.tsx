"use client";

import { useEffect, useRef, useState } from "react";

type RuleSuit = "♠" | "♥" | "♦" | "♣";
type RuleCardSpec = readonly [rank: string, suit: RuleSuit];

const SUIT_NAMES: Record<RuleSuit, string> = {
  "♠": "黑桃",
  "♥": "红桃",
  "♦": "方块",
  "♣": "梅花",
};

const POKER_HAND_RANKS: ReadonlyArray<{
  index: string;
  name: string;
  cards: readonly RuleCardSpec[];
  description: string;
  detail: string;
}> = [
  {
    index: "01",
    name: "同花顺",
    cards: [["A", "♥"], ["K", "♥"], ["Q", "♥"], ["J", "♥"], ["10", "♥"]],
    description: "同一花色的五张连续牌",
    detail: "A–K–Q–J–10 是最大的同花顺，也叫皇家同花顺；它仍属于同花顺，不是第十种牌型。",
  },
  {
    index: "02",
    name: "四条",
    cards: [["Q", "♠"], ["Q", "♥"], ["Q", "♦"], ["Q", "♣"], ["2", "♦"]],
    description: "四张相同点数的牌",
    detail: "先比四条点数；相同才比较第五张踢脚牌。",
  },
  {
    index: "03",
    name: "葫芦",
    cards: [["J", "♠"], ["J", "♥"], ["J", "♦"], ["8", "♣"], ["8", "♦"]],
    description: "三条加一对",
    detail: "先比较三条：JJJ88 大于 888AA。",
  },
  {
    index: "04",
    name: "同花",
    cards: [["A", "♦"], ["J", "♦"], ["8", "♦"], ["5", "♦"], ["2", "♦"]],
    description: "五张同一花色，但不连续",
    detail: "从最高张开始逐张比较，不把五张点数相加。",
  },
  {
    index: "05",
    name: "顺子",
    cards: [["9", "♠"], ["8", "♥"], ["7", "♦"], ["6", "♣"], ["5", "♠"]],
    description: "五张连续点数，花色不限",
    detail: "A 可在 A–2–3–4–5 中当 1；这是最小顺子。Q–K–A–2–3 不连续，不是顺子。",
  },
  {
    index: "06",
    name: "三条",
    cards: [["7", "♠"], ["7", "♥"], ["7", "♦"], ["K", "♣"], ["3", "♠"]],
    description: "三张相同点数",
    detail: "三条相同时，依次比较两张踢脚牌。",
  },
  {
    index: "07",
    name: "两对",
    cards: [["A", "♣"], ["A", "♦"], ["4", "♥"], ["4", "♠"], ["9", "♣"]],
    description: "两个不同点数的对子",
    detail: "先比大对，再比小对，最后比较踢脚牌。",
  },
  {
    index: "08",
    name: "一对",
    cards: [["K", "♠"], ["K", "♦"], ["J", "♥"], ["7", "♣"], ["2", "♦"]],
    description: "两张相同点数的牌",
    detail: "对子相同时，从最大的踢脚牌开始逐张比较。",
  },
  {
    index: "09",
    name: "高牌",
    cards: [["A", "♠"], ["J", "♦"], ["8", "♣"], ["5", "♥"], ["2", "♣"]],
    description: "没有组成以上任何牌型",
    detail: "先比最高张；相同就继续比较第二、第三高张。",
  },
];

function RuleCard({ card, muted = false }: { card: RuleCardSpec; muted?: boolean }) {
  const [rank, suit] = card;
  const red = suit === "♥" || suit === "♦";
  return (
    <span
      className={`poker-rule-card ${red ? "red" : "black"}${muted ? " is-muted" : ""}`}
      aria-hidden="true"
    >
      <b aria-hidden="true">{rank}</b>
      <i aria-hidden="true">{suit}</i>
    </span>
  );
}

function RuleCardRow({
  cards,
  mutedIndexes = [],
  label,
}: {
  cards: readonly RuleCardSpec[];
  mutedIndexes?: readonly number[];
  label: string;
}) {
  return (
    <span className="poker-rule-card-row" role="img" aria-label={label}>
      {cards.map((card, index) => (
        <RuleCard key={`${card[0]}-${card[1]}-${index}`} card={card} muted={mutedIndexes.includes(index)} />
      ))}
    </span>
  );
}

export type MultiplayerHelpStatus = {
  eyebrow: string;
  title: string;
  summary: string;
  details: readonly string[];
  ruleSummary: string;
  timedTurn: boolean;
  secondsLeft: number | null;
};

function MultiplayerGuide({
  status,
  onShowRules,
}: {
  status?: MultiplayerHelpStatus;
  onShowRules: () => void;
}) {
  return (
    <>
      <section className={`multiplayer-guide-now${status?.timedTurn ? " is-timed-turn" : ""}`} aria-labelledby="multiplayer-guide-now-title">
        <div className="multiplayer-guide-now-copy">
          <span>{status?.eyebrow ?? "QUICK START"}</span>
          <h3 id="multiplayer-guide-now-title">{status?.title ?? "创建一张桌，或用 8 位邀请码加入"}</h3>
          <p>{status?.summary ?? "先完成昵称与房间设置；进入牌桌后全员准备，由房主开局。"}</p>
          {status?.details?.length ? <ul>{status.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
        </div>
        <div className="multiplayer-guide-table-rule">
          <span>本桌规则</span>
          <strong>{status?.ruleSummary ?? "加入房间后，这里会显示当前桌的模式、筹码、读秒与 AI 次数"}</strong>
        </div>
        {status?.timedTurn && (
          <div className="multiplayer-guide-clock" role="alert">
            <span>帮助不会暂停行动计时</span>
            <strong>当前约剩 {status.secondsLeft ?? "—"} 秒</strong>
            <small>需要操作时，请先关闭帮助回到下注台。</small>
          </div>
        )}
      </section>

      <section className="poker-rule-section" aria-labelledby="multiplayer-start-title">
        <div className="poker-rule-section-heading"><span>FROM INVITE TO FIRST HAND</span><h3 id="multiplayer-start-title">朋友局，四步开打</h3></div>
        <div className="multiplayer-guide-steps">
          <article><b>01</b><span>取昵称</span><strong>创建牌桌或粘贴 8 位邀请码</strong><p>房主创建后，顶栏邀请码可以一键复制；朋友在大厅直接粘贴加入。</p></article>
          <article><b>02</b><span>定桌规</span><strong>房主设置人数、模式与资源</strong><p>支持 2–10 人，并可设置起始筹码、每次行动时间、整局时间库与每人 AI 辅助次数。</p></article>
          <article><b>03</b><span>全员准备</span><strong>有筹码的玩家确认“我已准备”</strong><p>至少两人入座后，由房主点击“开始牌局”；庄位与盲注会逐手移动。</p></article>
          <article><b>04</b><span>轮流行动</span><strong>只在轮到你时操作下注台</strong><p>合法按钮、最小加注和最大金额都由服务器同步；行动结果会同时出现在所有人的牌桌上。</p></article>
        </div>
        <div className="multiplayer-guide-modes">
          <article><span>CASH PRACTICE</span><strong>现金练习</strong><p>筹码归零后，下一手按房间起始筹码自动补回，适合持续训练；由房主主动结束整局。</p></article>
          <article><span>SINGLE TABLE</span><strong>单桌淘汰</strong><p>筹码归零后继续观战，不会自动补码；直到只剩最后一位玩家。</p></article>
          <aside><strong>共同桌规</strong><p>盲注固定 5/10，本桌不抽水。浅筹、标准、深筹只改变起始买入深度。</p></aside>
        </div>
      </section>

      <section className="poker-rule-section" aria-labelledby="multiplayer-action-title">
        <div className="poker-rule-section-heading"><span>BETTING · READ THE TOTAL</span><h3 id="multiplayer-action-title">下注台最容易看错的，是“到多少”</h3></div>
        <div className="multiplayer-raise-example" aria-label="你已经投入十，选择加注到九十，本次再投入八十">
          <div><span>你本街已投入</span><strong>10</strong></div><i>→</i>
          <div className="is-highlight"><span>按钮显示</span><strong>加注到 90</strong></div><i>→</i>
          <div><span>这次实际再投入</span><strong>80</strong></div>
        </div>
        <p className="multiplayer-guide-lead">“下注到 / 加注到”表示你在<strong>这一街的累计总投入</strong>，不是在现有金额上再加一次。滑杆、数字框、翻牌前的 BB 倍数和翻牌后的底池比例只是快捷尺寸，最终以按钮显示的合法范围为准。</p>
        <div className="multiplayer-action-legend">
          <div><b>弃牌</b><span>放弃本手，已投入筹码不退。</span></div>
          <div><b>过牌</b><span>无需补码时，零成本继续。</span></div>
          <div><b>跟注</b><span>补齐到当前最高投入。</span></div>
          <div><b>下注 / 加注</b><span>提高本街累计投入。</span></div>
          <div><b>全下</b><span>投入全部剩余筹码。</span></div>
        </div>
      </section>

      <section className="poker-rule-section" aria-labelledby="multiplayer-clock-title">
        <div className="poker-rule-section-heading"><span>ACTION CLOCK · TIME BANK · AI</span><h3 id="multiplayer-clock-title">以 20 / 100s 为例，读秒这样使用</h3></div>
        <div className="multiplayer-resource-flow">
          <article><b>20s</b><span>基础行动时间</span><p>每次轮到你都会重新获得。到 0 时，能过牌就自动过牌，否则自动弃牌。</p></article>
          <i>＋</i>
          <article><b>100s</b><span>整局时间库</span><p>每位玩家整局独立使用。每用一次时间牌，增加不超过一次基础行动时长，并扣掉同样的库存。</p></article>
          <i>＋</i>
          <article><b>AI +10s</b><span>本次决策分析</span><p>房主可设每人 0 / 5 / 10 次。成功分析消耗 1 次，并自动为当前行动增加 10 秒。</p></article>
        </div>
        <div className="multiplayer-guide-note"><strong>同一个决策可以放心重看：</strong><span>关闭分析后再次打开，不会重复扣次数，也不会重复加时间。AI 只读取你的底牌与牌桌公开信息；分析结果不会展示给其他玩家。</span></div>
      </section>

      <section className="poker-rule-section" aria-labelledby="multiplayer-social-title">
        <div className="poker-rule-section-heading"><span>TABLE TALK · BETWEEN HANDS</span><h3 id="multiplayer-social-title">聊天、亮牌和下一手，共用一张牌桌</h3></div>
        <div className="multiplayer-guide-grid">
          <article><span>桌边互动</span><strong>表情与消息</strong><p>下注台旁打开“发表情”或“消息”。快捷表情会在座位边显示约 5 秒；顶栏音效开关同时控制牌桌音效和表情语音。</p></article>
          <article><span>共同结算</span><strong>固定等待 20 秒</strong><p>一手结束后，结算与已公开牌会保留；若已公开且能组成牌型，还会展示赢家最佳五张。全员提前准备也不会跳过这段时间。</p></article>
          <article><span>赢家选择</span><strong>亮牌或盖牌</strong><p>赢家在共同等待的前 12 秒决定；超时自动盖牌。若选择亮牌，手牌至少持续显示到 20 秒结算结束。</p></article>
          <article><span>训练机会</span><strong>每手私密偷看 5 次</strong><p>本手参与者可在结算期查看未公开对手底牌；结果只对自己可见，也不会替对手公开。</p></article>
        </div>
        <div className="multiplayer-settlement-flow" aria-label="一手结束后的流程">
          <b>本手结算</b><i>→</i><b>亮牌 / 盖牌与私密偷看</b><i>→</i><b>已公开手牌 / 最佳五张持续展示</b><i>→</i><b>20 秒后下一手或整局结算</b>
        </div>
      </section>

      <section className="poker-rule-section" aria-labelledby="multiplayer-review-title">
        <div className="poker-rule-section-heading"><span>REPLAY · LEAVE · SESSION REPORT</span><h3 id="multiplayer-review-title">离桌与复盘，不会再混在一起</h3></div>
        <div className="multiplayer-guide-grid is-three">
          <article><span>牌谱</span><strong>最近 30 手牌桌回放</strong><p>按实际牌桌重放行动顺序、下注到多少、底池与剩余筹码；底牌仍按你的查看权限呈现。</p></article>
          <article><span>暂离 / 永久离开</span><strong>两个动作，结果不同</strong><p>左上角“←”只是暂离牌桌视图，座位保留；“更多 → 永久离开”才会退出房间，牌局中未全下的牌会自动弃掉。</p></article>
          <article><span>整局结算</span><strong>只有房主可以结束游戏</strong><p>进行中的手牌会先正常打完，再生成全桌总结；重新开局会重置筹码、时间库、AI 次数与本局统计。</p></article>
        </div>
      </section>

      <div className="multiplayer-guide-rule-link">
        <div><span>还不熟悉牌型？</span><strong>七选五、九种牌型、底池赔率与边池规则都在下一页。</strong></div>
        <button type="button" onClick={onShowRules}>查看德州扑克规则 →</button>
      </div>
    </>
  );
}

export function PokerRulesModal({
  onClose,
  closeLabel = "看懂了，回到牌桌",
  context = "poker",
  multiplayerStatus,
  dialogId = "poker-rules-dialog",
}: {
  onClose: () => void;
  closeLabel?: string;
  context?: "poker" | "multiplayer";
  multiplayerStatus?: MultiplayerHelpStatus;
  dialogId?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [activePanel, setActivePanel] = useState<"multiplayer" | "rules">(context === "multiplayer" ? "multiplayer" : "rules");
  const showMultiplayerGuide = context === "multiplayer" && activePanel === "multiplayer";

  const selectPanel = (panel: "multiplayer" | "rules") => {
    setActivePanel(panel);
    window.requestAnimationFrame(() => dialogRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <section id={dialogId} ref={dialogRef} className={`info-modal poker-rules-modal${context === "multiplayer" ? " is-multiplayer-help" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-intro`}>
        <div className="poker-rules-toolbar">
          <span>{context === "multiplayer" ? "FRIENDS TABLE FIELD GUIDE" : "TEXAS HOLD'EM RULEBOOK"}</span>
          {context === "multiplayer" && (
            <div className="poker-rules-tabs" role="tablist" aria-label="帮助内容">
              <button id={`${dialogId}-multiplayer-tab`} type="button" role="tab" aria-selected={activePanel === "multiplayer"} aria-controls={`${dialogId}-multiplayer-panel`} onClick={() => selectPanel("multiplayer")}>多人牌桌指南</button>
              <button id={`${dialogId}-rules-tab`} type="button" role="tab" aria-selected={activePanel === "rules"} aria-controls={`${dialogId}-rules-panel`} onClick={() => selectPanel("rules")}>德州扑克规则</button>
            </div>
          )}
          <button ref={closeButtonRef} className="modal-close" type="button" onClick={onClose} aria-label={context === "multiplayer" ? "关闭多人牌桌帮助" : "关闭德州扑克规则"}>×</button>
        </div>
        <span className="eyebrow">{showMultiplayerGuide ? "MULTIPLAYER · 60 SECOND ORIENTATION" : "TEXAS HOLD'EM RULEBOOK · ILLUSTRATED"}</span>
        <h2 id={`${dialogId}-title`}>{showMultiplayerGuide ? <>先把朋友叫上桌，<br />再把每个按钮看懂。</> : <>先看懂一手牌，<br />再练好每个决定。</>}</h2>
        <p id={`${dialogId}-intro`}>{showMultiplayerGuide ? <>这里先解释 <strong>RangeCraft 朋友局实际怎么操作</strong>：从邀请码、准备和下注，到读秒、AI 辅助、亮牌、偷看与整局复盘。想查牌型大小时，切到“德州扑克规则”。</> : <>德州扑克的目标很简单：<strong>赢下底池</strong>。你可以让所有对手在摊牌前弃牌——此时通常无需亮牌；也可以坚持到最后，用自己的两张底牌和桌上的五张公共牌，从七张牌里组成最强的五张牌。</>}</p>

        {context === "multiplayer" && (
          <div id={`${dialogId}-multiplayer-panel`} role="tabpanel" aria-labelledby={`${dialogId}-multiplayer-tab`} hidden={!showMultiplayerGuide}>
            <MultiplayerGuide status={multiplayerStatus} onShowRules={() => selectPanel("rules")} />
          </div>
        )}
        <div id={context === "multiplayer" ? `${dialogId}-rules-panel` : undefined} role={context === "multiplayer" ? "tabpanel" : undefined} aria-labelledby={context === "multiplayer" ? `${dialogId}-rules-tab` : undefined} hidden={context === "multiplayer" && showMultiplayerGuide}>

        <div className="poker-seven-to-five" aria-label="七张牌选出最佳五张示例">
          <div className="poker-seven-to-five-copy">
            <span>THE ONE RULE TO REMEMBER</span>
            <h3>不是比“两张底牌”，而是比最佳五张</h3>
            <p>你可以使用两张、一张，甚至完全不用自己的底牌。这个例子里，你拿到 A♠ K♠，公共牌是 Q♠ J♠ 10♠ 4♦ 2♣；最佳五张就是 A♠ K♠ Q♠ J♠ 10♠，组成最大的同花顺。灰掉的两张没有进入最终牌型。</p>
          </div>
          <div className="poker-seven-to-five-visual">
            <div><span>你的底牌</span><RuleCardRow cards={[["A", "♠"], ["K", "♠"]]} label="你的底牌：黑桃A、黑桃K" /></div>
            <b className="poker-card-plus">＋</b>
            <div><span>公共牌</span><RuleCardRow cards={[["Q", "♠"], ["J", "♠"], ["10", "♠"], ["4", "♦"], ["2", "♣"]]} mutedIndexes={[3, 4]} label="公共牌：黑桃Q、黑桃J、黑桃10、方块4、梅花2；后两张未使用" /></div>
            <b className="poker-card-equals">＝ 皇家同花顺</b>
          </div>
        </div>

        <section className="poker-rule-section" aria-labelledby="street-rules-title">
          <div className="poker-rule-section-heading"><span>ONE HAND · FOUR STREETS</span><h3 id="street-rules-title">一手牌是怎样进行的</h3></div>
          <div className="poker-street-flow">
            <div>
              <span>01 · 翻牌前</span>
              <RuleCardRow cards={[["A", "♣"], ["10", "♣"]]} label="两张底牌示例：梅花A、梅花10" />
              <strong>每人先拿 2 张底牌</strong>
              <small>从大盲左侧第一位开始行动；大盲若无人加注，可以过牌看翻牌。</small>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>02 · 翻牌</span>
              <RuleCardRow cards={[["K", "♥"], ["7", "♠"], ["2", "♦"]]} label="翻牌示例：红桃K、黑桃7、方块2" />
              <strong>发出前 3 张公共牌</strong>
              <small>剩余玩家进行第二轮下注；从庄位左侧仍在牌局的人开始。</small>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>03 · 转牌</span>
              <RuleCardRow cards={[["9", "♣"]]} label="转牌示例：梅花9" />
              <strong>再发第 4 张公共牌</strong>
              <small>第三轮下注。牌面更完整，听牌的赔率和剩余筹码更重要。</small>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>04 · 河牌</span>
              <RuleCardRow cards={[["Q", "♦"]]} label="河牌示例：方块Q" />
              <strong>发出最后 1 张公共牌</strong>
              <small>最后一轮下注；若仍有两人以上未弃牌，就摊牌比较最佳五张。</small>
            </div>
          </div>
          <div className="poker-position-note">
            <b>D</b><span>庄位</span><i>→</i><b>SB</b><span>小盲</span><i>→</i><b>BB</b><span>大盲</span><p>庄位每手顺时针移动。翻牌后，越晚行动通常信息越多，所以“位置”本身就是优势。单挑时庄家兼任小盲：翻牌前先行动，翻牌后后行动。</p>
          </div>
        </section>

        <section className="poker-rule-section" aria-labelledby="action-rules-title">
          <div className="poker-rule-section-heading"><span>ACTIONS · WHAT THE NUMBER MEANS</span><h3 id="action-rules-title">轮到你时，可以做什么</h3></div>
          <div className="poker-bet-example">
            <span>金额例子</span>
            <p>盲注 5/10，前面玩家<strong>加注至 30</strong>。如果你在大盲已经投入 10：跟注只需再放 20；若界面写“加注至 90”，你的这一轮总投入会变成 90，而不是再额外加 90。第一次最小加注至 20；若有人从 10 加到 30（增量 20），下一次完整最小加注就是至 50。</p>
          </div>
          <div className="poker-action-rules">
            <div><b>弃牌</b><span>放弃本手，不再争夺底池；已经投入的筹码不会退回。</span><kbd>F</kbd></div>
            <div><b>过牌</b><span>当前不需要补筹码时，零成本把行动交给下一位玩家。</span><kbd>C</kbd></div>
            <div><b>跟注</b><span>补齐当前最高投入。上例中，大盲跟注 30 只需再投入 20。</span><kbd>C</kbd></div>
            <div><b>下注 / 加注</b><span>无人下注时叫下注；已经有人下注时叫加注。界面统一显示“到多少”。</span><kbd>R</kbd></div>
            <div><b>全下</b><span>投入全部剩余筹码；你只能赢取每位对手与你等额匹配的部分。</span><em>ALL-IN</em></div>
          </div>
        </section>

        <section className="poker-rule-section" aria-labelledby="hand-ranks-title">
          <div className="poker-rule-section-heading"><span>HAND RANKINGS · STRONG TO WEAK</span><h3 id="hand-ranks-title">九种牌型，从大到小</h3></div>
          <p className="poker-section-lead">只比较最终选出的五张牌。先比较牌型；牌型相同，再按对应点数逐级比较。</p>
          <ol className="poker-hand-ranks">
            {POKER_HAND_RANKS.map(({ index, name, cards, description, detail }) => (
              <li key={index}>
                <span>{index}</span>
                <div>
                  <strong>{name}</strong>
                  <small>{description}</small>
                </div>
                <RuleCardRow cards={cards} label={`${name}示例：${cards.map(([rank, suit]) => `${rank}${SUIT_NAMES[suit]}`).join("、")}`} />
                <p>{detail}</p>
              </li>
            ))}
          </ol>
          <p className="poker-tie-rule"><strong>重要：</strong>花色不分大小，黑桃不会天然大于红桃。若双方最好的五张牌完全相同，就平分相应底池。</p>
        </section>

        <section className="poker-rule-section" aria-labelledby="compare-rules-title">
          <div className="poker-rule-section-heading"><span>TIE BREAKERS · THREE QUICK EXAMPLES</span><h3 id="compare-rules-title">同样的牌型，怎么分胜负</h3></div>
          <div className="poker-compare-grid">
            <article>
              <span>对子相同，看踢脚牌</span>
              <div><RuleCardRow cards={[["A", "♠"], ["A", "♦"], ["Q", "♣"], ["8", "♥"], ["4", "♣"]]} label="一对A，Q踢脚" /><b>胜</b></div>
              <div><RuleCardRow cards={[["A", "♥"], ["A", "♣"], ["J", "♠"], ["9", "♦"], ["7", "♠"]]} label="一对A，J踢脚" /><em>负</em></div>
              <p>两边都是一对 A，先比最大踢脚牌：Q 大于 J。8 与 9 无需再比。</p>
            </article>
            <article>
              <span>顺子只看最高端</span>
              <div><RuleCardRow cards={[["6", "♠"], ["5", "♥"], ["4", "♦"], ["3", "♣"], ["2", "♠"]]} label="六高顺子" /><b>胜</b></div>
              <div><RuleCardRow cards={[["5", "♣"], ["4", "♠"], ["3", "♥"], ["2", "♦"], ["A", "♣"]]} label="五高顺子" /><em>负</em></div>
              <p>6 高顺子大于 5 高顺子。A–2–3–4–5 中，A 只算作 1。</p>
            </article>
            <article>
              <span>公共牌也可能让大家平局</span>
              <RuleCardRow cards={[["A", "♠"], ["K", "♥"], ["Q", "♦"], ["J", "♣"], ["10", "♠"]]} label="公共牌为A、K、Q、J、10组成的顺子" />
              <p>如果桌面本身就是 A–K–Q–J–10，且没人能组成更高牌型，所有未弃牌玩家都“打公共牌”，平分底池。</p>
            </article>
          </div>
        </section>

        <section className="poker-rule-section" aria-labelledby="pot-rules-title">
          <div className="poker-rule-section-heading"><span>POT ODDS · SIDE POTS</span><h3 id="pot-rules-title">两个最常用的底池例子</h3></div>
          <div className="poker-pot-examples">
            <article>
              <span>例 1 · 跟注需要多少胜率？</span>
              <div className="poker-pot-odds-diagram" aria-label="底池100，对手下注50，你跟注50，所需胜率25%">
                <b>原底池<br /><strong>100</strong></b><i>＋</i><b>对手下注<br /><strong>50</strong></b><i>＋</i><b>你的跟注<br /><strong>50</strong></b><i>＝</i><b className="is-result">最终底池<br /><strong>200</strong></b>
              </div>
              <p>你付 50 去争夺最终 200，纯底池赔率门槛是 <strong>50 ÷ 200 = 25%</strong>。若估计自己的胜率高于 25%，且暂不考虑后续行动，跟注才有直接价格。</p>
            </article>
            <article>
              <span>例 2 · 三人全下怎样分池？</span>
              <div className="poker-side-pot-diagram" aria-label="A投入100，B与C各投入300，主池300，边池400">
                <div><b>A</b><span>全下 100</span></div><div><b>B</b><span>投入 300</span></div><div><b>C</b><span>投入 300</span></div>
                <i aria-hidden="true">↓</i>
                <strong>主池 300 · A / B / C 可争</strong>
                <strong>边池 400 · 只有 B / C 可争</strong>
              </div>
              <p>A 就算牌最大，也只能赢主池；边池由 B、C 单独比较。没人能够跟上的超额筹码会原样退回。</p>
            </article>
          </div>
        </section>

        <div className="poker-rule-details">
          <div><span>主池、边池与退回</span><strong>全下金额不同，会按可匹配额度分层。</strong><p>每个边池只有投入到该层且没有弃牌的玩家有资格争夺；弃牌前投入仍是死钱。没人能够跟上的超额筹码会原样退回，不算奖金。</p></div>
          <div><span>加注权</span><strong>完整加注会重新开放行动，不足额全下不一定会。</strong><p>短码全下若没有达到一个完整最小加注量，已经行动过的玩家通常只能跟注或弃牌；多个不足额加注累计达到完整增量后才重新开放。</p></div>
          <div><span>RangeCraft 牌桌</span><strong>单人 6-MAX；多人 2–10 人，支持现金练习与单桌淘汰</strong><p>浅筹 / 标准 / 深筹只是初始买入深度；“血战鱿鱼”是单人附加训练玩法，不是标准德州扑克规则。</p></div>
        </div>

        <div className="poker-rule-memory"><span>30 秒记忆法</span><strong>先认牌型 → 再看最佳五张 → 算清要跟多少 → 最后考虑位置、范围与剩余筹码。</strong></div>
        </div>
        <button className="modal-primary" type="button" onClick={onClose}>{closeLabel}</button>
      </section>
    </div>
  );
}
