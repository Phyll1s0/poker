# RangeCraft GTO 求解路线

## 结论先行

RangeCraft 不再把“手写范围表 + 启发式频率”称作精确 GTO。后续策略统一分成三种来源：

1. **内部已求解**：由 RangeCraft 自己的 CFR+ / DCFR 求解器生成，附带内容寻址、哈希锁定的牌局规格、下注树、算法参数、迭代次数和 exploitability/NashConv。
2. **合法参考数据**：只接受许可允许用于本项目的数据，并记录来源、许可和校验和；不会抓取或复制商业训练器的策略库。
3. **本地近似**：现有 169 手牌表、范围权益和连续混频模型。节点未命中时仍可训练，但必须明确标为“近似”，评分也不能冒充精确 EV loss。

“GTO”不是一张所有牌局通用的固定答案表。人数、位置、有效筹码、盲注、前注、抽水、开池尺度、可选下注尺寸和后续行动树只要有一项改变，均衡策略就可能改变。因此第一步不是继续手调 `AT` 的百分比，而是先锁定可复现的游戏。

## RangeCraft Standard v1

首个标准节点定义在 [`lib/gto-standard.ts`](lib/gto-standard.ts)：

- 6-max 无限注德州扑克现金桌；
- 100 BB，盲注 0.5 / 1 BB，无前注；
- chip EV，无抽水；
- RFI 固定开到 2.5 BB；
- IP/OOP 3-bet、4-bet、5-bet 与翻后可选尺寸均固定；
- 完整规格和下注树分别使用 canonical JSON + SHA-256 生成 `gameSpecId` 与 `treeId`；
- 改动任何规则或尺寸都会得到另一个 ID，旧策略不会被错误命中新牌局。

这套配置是 RangeCraft 的可复现基准，不声称是所有商业产品唯一采用的配置。商业结果只有在输入完全一致时才有比较意义。

## 已完成的第一条真实求解链

### 通用 CFR+ / DCFR 核心

[`lib/gto-cfr.ts`](lib/gto-cfr.ts) 是独立于扑克规则的两人零和、有限树求解引擎，支持：

- chance node；
- 私有信息集；
- 外部终局效用；
- CFR+ 的交替 regret matching+，以及修正证明要求的错位线性平均：玩家 0 累积更新后策略、玩家 1 累积更新前策略；
- 论文默认 `DCFR(α=1.5, β=0, γ=2)`：正/负累计 regret 分别衰减，负 regret 不截断，平均策略按 `t²` 加权；
- 确定性重复运行和分段续算；
- 小博弈的精确 deterministic best-response 枚举。

两条算法都通过了非对称 `2×2` 零和矩阵的逐轮手算测试、分段与一次性求解逐位一致测试，以及 Kuhn Poker 回归：均衡值收敛到 `-1/18`，并独立计算低 exploitability。CFR+ 的平均相位依据 [Revisiting CFR+ and Alternating Updates](https://arxiv.org/abs/1810.11542)；DCFR 更新依据 [Solving Imperfect-Information Games via Discounted Regret Minimization](https://arxiv.org/abs/1809.04040)。自博弈胜率或 bb/100 只用于回归，不再被当作均衡证明。

### 真实 1v1 河牌子博弈

[`lib/gto-river.ts`](lib/gto-river.ts) 已把 CFR+ 与 DCFR 接入真正的德州扑克牌型比较：

- 输入五张公共牌、OOP/IP 两个带权组合范围、底池、有效后手和固定下注树；
- 删除公共牌冲突、重复组合和双方暗牌碰撞；
- chance 概率按 `OOP 范围权重 × IP 范围权重` 条件归一化；
- 信息集只包含自己的暗牌与公开行动，不会读取对手暗牌；
- 支持过牌、多个下注尺度、弃牌、跟注、多个加注尺度与全下；
- 终局使用真实七选五牌型，未跟注筹码正确退回；
- 用针对公共下注树的 scalable best response 计算 NashConv/exploitability，而不是只看训练残差；
- 单挑实时教练默认按 100 轮检查点运行 `DCFR(1.5,0,2)`，要求连续检查点通过内部误差线，并返回所有已审计检查点中 exploitability 最低的策略；“连续通过”是工程稳定门，单个检查点的精确 best-response 才是固定树内的数学误差证书；
- 固定树误差高于训练线时只展示实验结果、不接管原提示；达到训练线但未达到较低误差评分线时可接管提示但不计算 solver EV 失误分；
- 小范围测试同时与指数级精确 best response 结果逐值核对。

这是“真实求解器的第一块”，但它仍只是**固定范围、固定河牌、固定离散下注树的 heads-up 子博弈**，不能被包装成完整 6 人无限注 GTO。

### 第一项公开独立交叉验证

两人河牌链目前已有一项真正的同题外部基线：MIT 许可的 [`noambrown/poker_solver`](https://github.com/noambrown/poker_solver)，固定 commit `6a10442877ffc8fd28af93e16e279b9bbdd97b2a`。基准锁定公共牌 `A♣ K♦ 7♠ 4♥ 2♣`、双方三个等权具体组合、10 BB 底池、10 BB 有效后手、100% pot 首次下注且不允许再加注；上游以 double precision CFR+ 运行 5,000 次。

```bash
npm run gto:benchmark:river
```

比较前必须通过可信来源清单、fixture 内容哈希、原始输入/输出 SHA-256、`spotId/gameSpecId/treeId`、范围权重、手牌、节点与动作的完整覆盖检查；随后核对上游原生 best-response exploitability，并把外部与内部 profile 放入同一个严格审计模型，比较 profile value、重新计算的 exploitability、参考动作 EV regret 和频率误差。原始输入、原始策略字节、来源、生成命令和阈值都保存在 [`benchmarks/external/noambrown-river-v1/`](benchmarks/external/noambrown-river-v1/)。这只能证明一棵锁定小树上的实现一致性，不能外推到全部两人局或多人局。

## 1v1、1v2 与翻前标准的实施顺序

### P1：1v1 河牌（已完成核心）

目标：先让范围、阻断牌、价值下注、诈唬和抓诈唬频率由均衡自动产生。

验收门槛：

- 牌局规格与输出带稳定 ID；
- 频率严格归一化；
- 同输入可确定性重现；
- exploitability 以底池比例报告；
- 训练级节点要求不高于 1% pot，内部高精度工程目标不高于 0.3% pot。

这里的阈值只描述**给定范围和固定离散树内部**的求解误差。输出会另带 `accuracyScope: within-fixed-tree` 与 `externalBenchmarkStatus`；即使上面的单项公开同题基准通过，也只覆盖那个固定子博弈，达到 0.3% 仍不等于已经证明完整 NLHE 抽象与商业解一致。

下一步是增加多棵不对称范围、多尺寸和加注树的公开 DCFR/CFR+ 对照 fixture，再离线批量生成典型 BTN vs BB、CO vs BB 河牌节点并分片存成策略包。浏览器只读取大型预计算结果，不在主线程现场跑几十万次迭代。

### P2：标准 RFI 与翻前响应

不能只求“UTG 第一手开哪些牌”，因为开池 EV 取决于后面五个人的防守与完整翻后 continuation value。实施方式：

1. 先锁定 Standard v1 的完整翻前动作树；
2. 用可复现的翻后价值抽象训练六人翻前；
3. 导出 169 类组合频率、各位置组合加权范围和动作 EV；
4. 对相同配置的商业 solver 只做抽样对比，不复制其策略库；
5. 当前手写表继续作为 fallback，并明确标为近似。

标准节点优先覆盖 RFI、面对 RFI、面对 3-bet 和面对 4-bet。`ATs/ATo` 会根据位置、对手位置、尺寸和有效筹码落入不同节点，不再用一条全局规则决定。

### P3：完整 1v1 翻后

按河牌 → 转牌 → 翻牌的顺序逆向扩展：

- 先覆盖 BTN vs BB 单加注底池；
- 再覆盖 CO/UTG vs BB 与 3-bet pot；
- 使用牌面同构减少节点数量；
- 策略包按场景和牌面分片懒加载；
- 逐节点保存 reach range、动作频率、尺寸、动作 EV 与 exploitability。

### P4：1v2 三人底池

这里的“1v2”指三个各自追求自身 EV 的玩家，不是两名对手串通。三人局不再是两人零和博弈，不能复用 heads-up exploitability 口径：

- 首批只做固定 BTN/SB/BB 单加注底池；
- 使用三人 CFR/DCFR 近似；
- 报告各玩家 unilateral deviation gain 和 NashConv/Nash distance；
- 所有 UI 标签都写“多人均衡近似”，不写“精确 GTO”；
- 商业级目标先限定河牌，再扩展转牌；翻牌需要更强的抽象与算力验证。

已完成的浏览器训练第一阶段：

- 三人河牌固定单次下注树已接入单人训练；
- 现场计算迁入 Web Worker，切换决策会取消旧任务，不再用 `setTimeout` 假装异步；
- 使用每家 3 个代表组合快速求解，再以每家 5 个代表组合做跨分辨率稳定性复核；
- 两档范围都必须达到 `NashConv ≤ 10% pot`，且各动作的相对 EV regret 跨分辨率漂移不高于 `10% pot`，才允许接管实验提示；
- 频率 Total Variation 只作诊断，因为多个近似无差异动作可能在不同均衡近似中出现很大的频率变化；
- 较高稳定性的实验 EV 评分另要求两档 NashConv 与当前手牌跨分辨率动作 regret 漂移都不高于 `3% pot`；全范围 NashConv 只作准入，不冒充逐手牌误差上界，评分死区仅使用当前动作 regret 漂移并明确标为经验校准；
- 用户下注尺寸与最近固定树尺寸相差超过 `0.05 BB` 时，明确按树外动作处理，不会强行映射出伪精确 EV 分数。

这里的 `10%` 是**实验提示门槛**，`3%` 也只是更高稳定性的经验评分门槛，不是 RangeCraft Standard 的正式训练级或商业精度声明。市场并无统一的“商业阈值”；作为量级参照，GTO Wizard 的[三人局公开基准](https://blog.gtowizard.com/gto_wizard_ai_3_way_benchmarks/)报告其测试河牌低于 `0.1% pot` Nash distance。数字阈值表面上相差约 100/30 倍，但测试树与 `3%` 稳定性指标并不相同，不能把它解释成精度倍数；当前三人功能也还没有公开独立同题基准。下一步是在 Worker 基础上增加一次河牌再加注树；三人转牌和翻牌仍应走离线解库、牌面同构和 continuation value 路线。

## 商业 GTO 如何对齐

公开资料并非不存在，但应按用途区分：Apache-2.0 的 OpenSpiel 适合算法和小博弈复核；MIT 的 `noambrown/poker_solver` 可做当前河牌同题基线；Apache-2.0 的 PokerBench 是单点动作数据集，不含证明完整均衡所需的混频、动作 EV 和 exploitability；PioSOLVER Free 是只支持两个示例翻牌的专有评估版；`postflop-solver` 与 TexasSolver 使用 AGPL，后者还要求代码集成或网络服务联系商业许可；GTO Wizard 是受服务条款保护的商业策略服务。详细许可、链接和本项目使用边界见 [`PUBLIC_GTO_VALIDATION.md`](PUBLIC_GTO_VALIDATION.md)。

对齐流程不是“看起来频率差不多”，而是同题考试：

1. 在商业 solver 中建立与 `gameSpecId/treeId` 完全相同的配置；
2. 选取许可允许人工核对的少量节点；
3. 比较范围 reach、每组合动作频率、各动作 EV 和整节点 EV；
4. 计算频率 L1/L2 差异、最大动作 EV regret 和策略的 best-response exploitability；
5. 差异必须先解释为树、抽水、范围或收敛门槛差异，不能靠手调频率“抄成一样”。

[`lib/gto-benchmark.ts`](lib/gto-benchmark.ts) 已把这套比较固化成离线工具：只有 `gameSpecId`、`treeId`、求解类型和位置顺序全部一致才允许比较，并输出参考 reach 覆盖率、频率 total variation、最大单动作误差；参考数据带完整动作 EV 时，还会计算候选混合相对参考最佳动作的加权 EV regret。

商业数据只能用于用户有权进行的人工验证或许可导入。GTO Wizard 的 Benchmark API 条款明确限制抽取策略或用其数据训练/校准第三方 solver；PioSOLVER 的结果分享和服务用途也受许可证约束。RangeCraft 因此采用自己的算法与自己生成的解库，只把许可兼容的公开实现用于独立工程复核，不会把商业网页当数据库抓取。

相关原始资料：

- [CFR 原始论文（NeurIPS 2007）](https://proceedings.neurips.cc/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html)
- [OpenSpiel（Apache-2.0）](https://github.com/google-deepmind/open_spiel)
- [PokerBench 数据集（Apache-2.0）](https://huggingface.co/datasets/RZ412/PokerBench)
- [PioSOLVER Free 产品限制](https://piosolver.com/docs/product_comparison/)
- [postflop-solver（AGPL-3.0-or-later）](https://github.com/b-inary/postflop-solver)
- [TexasSolver（AGPL-3.0）](https://github.com/bupticybee/TexasSolver)
- [GTO Wizard：为什么两个解不同](https://blog.gtowizard.com/why-doesnt-my-solution-match-gto-wizard/)
- [GTO Wizard：三人局求解基准](https://blog.gtowizard.com/gto_wizard_ai_3_way_benchmarks/)
- [GTO Wizard Benchmark API 条款](https://gtowizard.com/benchmark/terms)
- [PioSOLVER Licensing](https://piosolver.com/docs/licensing/)

## 训练器接入协议

[`lib/poker-strategy.ts`](lib/poker-strategy.ts) 的 V2 协议已经完成：完整规则、筹码、合法尺寸和行动线都会进入稳定节点键；输出强制区分 `exact` 与 `fallback`，并保存 pack、solver、误差和许可来源。当前单人 AI、单人教练和多人 AI 辅助仍直接调用 `evaluatePokerPolicy()`；下一轮会让三处统一经过 resolver：

```text
公开牌局状态
  → canonical node key（规则、树、筹码、位置、行动线、牌面）
  → 已求解策略包精确命中
      → 频率、尺寸、动作 EV、来源、误差
  → 未命中
      → 整体回退现有近似模型，并给出明确原因
```

不能把 3BB 节点夹成 2.5BB 后仍标“精确”，也不能把 40BB 决策套用 100BB 解。

精确节点的复盘评分应为：

```text
EV loss = 最佳合法动作 EV − 玩家实际动作 EV
```

低频均衡动作如果 EV 几乎相同，不应仅因频率低而被判错。没有动作 EV 的 fallback 节点继续显示“频率匹配度”，不得写成 solver EV loss。牌谱还要保存当时的策略包版本与策略快照，避免未来升级后重算出另一份答案。

## 完成定义

一个策略节点只有同时满足以下条件，才能在 UI 显示“内部已求解”：

- 完整配置能够精确命中；
- 来源、solver 版本、迭代次数和内容哈希存在；
- 动作和尺寸在当前节点全部合法；
- 频率归一化，动作 EV 单位明确；
- heads-up 有 best-response exploitability；三人局有明确的近似 Nash 指标；
- 达到对应训练误差门槛。

其余节点仍然可以提供帮助，但会诚实显示为“近似模型”。
