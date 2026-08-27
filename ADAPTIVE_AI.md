# RangeCraft 动态电脑：论文方法、实现边界与验证

> 当前实现的目标是“均衡基线附近的稳健动态电脑”，不是把短期读牌冒充 GTO，也不声称已经拥有完整商业级 6-max 解库。

## 设计结论

GTO 与动态剥削必须分层：

1. **均衡参考层**：所有电脑共用同一份本地平衡策略核。翻前优先使用 169 类位置/行动节点表；命中受审计的河牌固定树时，教练仍可使用 CFR/DCFR/PDCFR+ 结果。其他实时六人节点明确回退到本地近似策略。
2. **风格层**：LAG、TAG、动态型和保守型不是五套互不相关的“自创 GTO”，而是从同一参考策略作有限偏移。
3. **公开对手模型**：只记录玩家公开行动、位置、面对尺度、单挑/多人和有效筹码档位；未亮底牌不会被当作已知弱牌。
4. **有界剥削层**：匹配情境的响应节点优先决定针对性偏移；细节点稀疏时，全局松紧/侵略性画像只提供低权重泛化。最后仍按完整混合频率抽样。

这个拆分与扑克 AI 论文的边界一致。Pluribus 的强策略来自离线自博弈与实时搜索，并不以“读取当前牌桌玩家的历史”作为 GTO 定义；动态调整属于额外对手建模层。参见 [Pluribus / Science 2019](https://doi.org/10.1126/science.aay2400)。

## 分情境经验画像

当前响应情境包含：

- 翻前面对 open / re-raise；
- flop、turn、river 分别面对 bet / raise；
- 小、中、大、全下四类尺度；
- IP / OOP；
- 单挑 / 多人；
- 短码 / 标准 / 深码。

每个节点保存 `fold / call / raise` 的折扣有效计数与慢速近期轨迹。粗节点和细情境分别用中性先验做经验 Dirichlet-style shrinkage，再以 partial pooling 合并；近期变化由 EWMA 跟踪，避免两三次行动直接把玩家贴死标签，也避免几千手旧数据永久锁死模型。这是工程化的经验估计，不是完整的贝叶斯扑克求解器。它只借鉴 [Bayes' Bluff（UAI 2005）](https://bowlingmh.github.io/papers/05uai.pdf) 中“未知底牌应被边缘化、对手模型应保留不确定性”的思路：普通弃牌只能证明玩家在这个公开情境选择了弃牌，不能证明具体拿了什么牌。

细节点按街道、面对 bet/raise、尺度、位置、单挑/多人和有效筹码匹配；命中证据始终优先。同一街道/行动族但尺度或位置等不匹配时，粗节点的响应证据信号最多只按完整匹配的 25% 计入；未匹配街道不会直接继承细节点读牌。此外，为了在实时决策前选择响应节点，电脑用当前风格策略给出的一个代表性下注尺度做 `representative-size approximation`；最终下注仍从完整条件尺度混合中抽样。这不是对每条尺度分支分别实时求解，复盘时也不应把代表尺度近似解释成精确 solver 节点。

模型用 Jensen-Shannon divergence 衡量当前响应分布与中性先验的偏离，并用节点机会数形成置信度：

```text
confidence = n / (n + k)
evidence   = confidence × clamp(JS(observed || prior) / 0.12, 0, 1)
```

范围推断继续只使用公共状态与公开行动。这个“公共状态 + 私牌可能性的概率分布”方向与 [ReBeL（NeurIPS 2020）](https://proceedings.neurips.cc/paper/2020/file/c61f571dbd2fb949d3fe5ae1608dd48b-Paper.pdf) 的 public belief state 思想相容，但当前浏览器实现不是 ReBeL，也没有其两人零和保证。

## 风格如何不同地适应

| 风格 | 风格表达权重 | 最大动态行动预算 | 主要反制方式 |
| --- | ---: | ---: | --- |
| GTO 平衡 | 0% | 14% | 小幅、稳健地修正，最少追逐短期读牌 |
| 松凶压迫 | 70% | 32% | 对过度弃牌增加带阻断牌的进攻与持续施压 |
| 紧凶价值 | 66% | 24% | 对跟注站减少空气、增加价值攻击 |
| 动态适应 | 38% | 48% | 最大置信加权偏移，并更快响应风格变化 |
| 稳健保守 | 72% | 17% | 仍会反制明显偷池，但保持窄范围身份 |

这里的百分比是项目工程预算，不是论文给出的普适常数。

最终策略按三段混合：

```text
styleBaseline = mix(gtoReference, styleReference, styleExpression)
finalActionMix = mix(styleBaseline, exploitReference, evidenceWeightedBudget)
```

因此每个动作仍是概率抽样，而不是永远选最高频线路。条件下注尺度也按“策略权重 × 加注概率 × 尺度条件频率”合并，避免把很少下注的策略错误地赋予过多尺度权重。

这条线性 trust region 受 [Restricted Nash Response（NeurIPS 2007）](https://proceedings.neurips.cc/paper/2007/file/6e7b33fdea3adc80ebd648fffb665bb8-Paper.pdf)、[Data-Biased Robust Counter Strategies（AISTATS 2009）](https://proceedings.mlr.press/v5/johanson09a/johanson09a.pdf) 和 [Safe Exploitation Search（NeurIPS 2022）](https://proceedings.neurips.cc/paper_files/paper/2022/file/b12a1d1014e952e676f5d6931d03241a-Paper-Conference.pdf) 启发。当前实现只能保证单次决策中：

```text
TV_actionKinds(finalActionMix, styleBaseline) <= exploitWeight
```

这里的 TV 只比较单次决策中 `fold/check/call/raise` 的动作类别边际分布；它不覆盖条件下注尺度的联合分布、跨节点策略或整场 exploitability。上述线性混合只是受论文启发的工程 trust region，并不是 RNR、DBR 或 Safe Exploitation Search 的实现，也没有全局 `ε-safe` 或 exploitability 保证；多人局更不能从两人零和论文直接外推。

## 防止“你一直加注，电脑一直弃牌”

- 所有五种风格都会记录玩家在对应节点的持续开池、再加注、翻后下注与翻后加注机会。
- 快速轨迹已从一次停顿就大幅遗忘，改成更慢的 EWMA；非进攻行动只逐步降低 streak。
- 对持续开池者，电脑最终行动层会提高继续与反加注，而不是只把一个 `aggression` 数字调高。
- 对过度弃牌者增加进攻；对跟注站减少空气诈唬并保留更多价值攻击；对频繁反加注者收紧空气、提高价值比例。
- 未对应的街道不会继承细节点读牌；相同街道的其他尺度只通过粗节点获得有限共享。全局画像仍能作低权重泛化，但不能压过有足够样本的匹配响应节点。

## 可重复验证

完整翻前、翻牌、转牌、河牌的六人桌筹码守恒回归：

```bash
npm run ai:benchmark
```

固定公开画像下的动态行动频率与实际抽样审计：

```bash
npm run ai:benchmark:adaptation
```

第二个命令固定公开证据，对每种风格重复 10,000 次最终动作抽样；它是 benchmark，不会在运行时训练、强化学习或改写电脑参数。该命令直接检查：

- 河牌过度弃牌时，五种风格都增加进攻；
- 跟注站情境中，五种风格都减少空气进攻；
- 成熟的“过弃”画像在玩家连续转为跟注后能够反向，不会被终身计数锁死；
- 持续开池时，五种风格都扩大匹配节点的防守；
- 动态型的最终行动 TV 大于 GTO 型；
- 公布混频与实际抽样在统计误差内一致。

配套单元/集成测试另外检查所有最终频率与下注尺度合法、归一，同一种子结果一致，动作类别 TV 不越过预算，以及长期计数与近期轨迹能在玩家切换风格后逐步反向。换言之，是“命令 + 单元/集成测试”共同覆盖这些性质，不把 benchmark 本身描述成训练器或完整端到端安全证明。

这些是行为和工程安全回归，不是“盈利样本证明 GTO”。更严格的长期强度评估仍需固定座位、duplicate deals、held-out 攻击策略与低方差 EV 估计；后续可参考 [AIVAT（AAAI 2018）](https://ojs.aaai.org/index.php/AAAI/article/view/11481)。

## 后续升级顺序

1. 把受审计的 HU 河牌策略包接入电脑决策；命中时标记 `exact baseline + exploit-adjusted`，未命中明确回退。
2. 在 HU 河牌完整树中实现真正的 RNR 根机会分支，并用 best response 报告安全性。
3. 把固定座位、多手持久画像和 scripted exploit 对手接入 paired A/B arena。
4. 用 external-sampling Linear CFR/MCCFR 扩大离线 blueprint；浏览器只加载版本化策略包。
5. 多人只报告固定抽象内 NashConv / unilateral deviation，不声称一般纳什收敛。

离线求解继续以 [CFR（NeurIPS 2007）](https://proceedings.neurips.cc/paper/2007/file/08d98638c6fcd194a4b1e6992063e944-Paper.pdf)、[MCCFR（NeurIPS 2009）](https://proceedings.neurips.cc/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html) 与 [DCFR（AAAI 2019）](https://ojs.aaai.org/index.php/AAAI/article/view/4007/3885) 为基础。Deep CFR 需要独立训练管线、优势网络和大规模样本内存；当前项目不会把简单前端启发式称作 Deep CFR，参见 [Deep CFR（ICML 2019）](https://proceedings.mlr.press/v97/brown19b/brown19b.pdf)。
