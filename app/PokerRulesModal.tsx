const POKER_HAND_RANKS = [
  ["01", "同花顺", "同一花色的五张连续牌；A-K-Q-J-10 是最大的同花顺"],
  ["02", "四条", "四张相同点数的牌，再比较第五张踢脚牌"],
  ["03", "葫芦", "三张相同点数加一对；先比较三条的点数"],
  ["04", "同花", "五张同一花色但不连续，从最高张依次比较"],
  ["05", "顺子", "五张连续点数、花色不限；A-2-3-4-5 是最小顺子"],
  ["06", "三条", "三张相同点数，再依次比较两张踢脚牌"],
  ["07", "两对", "先比较较大的一对，再比较较小的一对和踢脚牌"],
  ["08", "一对", "一组对子，再依次比较三张踢脚牌"],
  ["09", "高牌", "没有组成以上牌型时，从最高张开始依次比较"],
] as const;

export function PokerRulesModal({
  onClose,
  closeLabel = "看懂了，回到牌桌",
}: {
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="modal-backdrop">
      <section className="info-modal poker-rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭德州扑克规则">×</button>
        <span className="eyebrow">TEXAS HOLD&apos;EM RULEBOOK</span>
        <h2 id="rules-title">先看懂一手牌，<br />再练好每个决定。</h2>
        <p>每位玩家拿两张只有自己可见的底牌，桌面最多发出五张公共牌。你可以使用两张、一张或完全不用自己的底牌，从七张牌里组成最强的五张牌；也可以在摊牌前让所有对手弃牌，直接赢下底池。</p>

        <div className="poker-rule-basics">
          <div><span>牌桌位置</span><strong>D 庄位 → SB 小盲 → BB 大盲</strong><small>庄位每手顺时针移动；盲注是发牌前必须投入的筹码。</small></div>
          <div><span>翻牌前</span><strong>每人 2 张底牌</strong><small>从大盲左侧开始行动；大盲在无人加注时拥有最后过牌选择。</small></div>
          <div><span>翻牌</span><strong>一次发出 3 张公共牌</strong><small>仍在牌局中的玩家进入第二轮下注。</small></div>
          <div><span>转牌</span><strong>再发 1 张公共牌</strong><small>第三轮下注，底池通常开始明显变大。</small></div>
          <div><span>河牌与摊牌</span><strong>最后 1 张 · 比较最佳五张</strong><small>最后一轮下注结束后，未弃牌玩家公开手牌决定赢家。</small></div>
        </div>

        <section className="poker-rule-section" aria-labelledby="action-rules-title">
          <div className="poker-rule-section-heading"><span>ACTIONS</span><h3 id="action-rules-title">轮到你时可以做什么</h3></div>
          <div className="poker-action-rules">
            <div><b>弃牌</b><span>放弃本手；已经投入底池的筹码不会退回。</span><kbd>F</kbd></div>
            <div><b>过牌</b><span>当前无需补筹码时把行动交给下一位玩家。</span><kbd>C</kbd></div>
            <div><b>跟注</b><span>补齐当前最高投入；筹码不足时可以用剩余筹码全下跟注。</span><kbd>C</kbd></div>
            <div><b>下注 / 加注</b><span>没人下注时建立价格；已有下注时提高到新的总额。界面显示的是“加注至”。</span><kbd>R</kbd></div>
            <div><b>全下</b><span>投入全部剩余筹码；只能赢取每位对手与你等额匹配的部分。</span><em>ALL-IN</em></div>
          </div>
        </section>

        <section className="poker-rule-section" aria-labelledby="hand-ranks-title">
          <div className="poker-rule-section-heading"><span>HAND RANKINGS · STRONG TO WEAK</span><h3 id="hand-ranks-title">牌型从大到小</h3></div>
          <div className="poker-hand-ranks">
            {POKER_HAND_RANKS.map(([index, name, description]) => (
              <div key={index}><span>{index}</span><strong>{name}</strong><small>{description}</small></div>
            ))}
          </div>
          <p className="poker-tie-rule">同牌型按组成牌型的点数和踢脚牌逐级比较；花色不分大小。若双方最好的五张牌完全相同，则平分相应底池。</p>
        </section>

        <div className="poker-rule-details">
          <div><span>主池、边池与退回</span><strong>全下金额不同，会按可匹配额度分层。</strong><p>每个边池只有投入到该层且没有弃牌的玩家有资格争夺；弃牌前投入仍是死钱。没人能够跟上的超额筹码会原样退回，不算奖金。</p></div>
          <div><span>加注权</span><strong>完整加注会重新开放行动，不足额全下不一定会。</strong><p>短码全下若没有达到一个完整最小加注量，已经行动过的玩家通常只能跟注或弃牌；多个不足额加注累计达到完整增量后才重新开放。</p></div>
          <div><span>RangeCraft 牌桌</span><strong>单人 6-MAX；多人 2–6 人，支持现金练习与单桌淘汰</strong><p>浅筹 / 标准 / 深筹只是初始买入深度；“血战鱿鱼”是单人附加训练玩法，不是标准德州扑克规则。</p></div>
        </div>

        <button className="modal-primary" type="button" onClick={onClose}>{closeLabel}</button>
      </section>
    </div>
  );
}
