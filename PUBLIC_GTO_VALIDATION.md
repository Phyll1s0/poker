# RangeCraft 公开 GTO 校验说明

## 结论

市面上并非“没有公开资料”。公开的内容包括 CFR/CFR+/DCFR 方法、可运行的开源求解器、简化扑克的已知均衡，以及少量带 solver 标签的数据集；商业产品还提供受限制的免费查看或试用。真正通常不公开、也不能直接搬进本项目的，是覆盖大量筹码、范围、抽水和下注树的完整商业策略库。

因此，RangeCraft 不用“看起来像大众 GTO”作为验收标准，而使用下面四级证据：

1. **规则和恒等式自检**：零和、筹码守恒、合法动作、牌型、阻断牌与 chance 权重正确。
2. **已知小博弈复核**：Kuhn Poker 均衡值、best response 与 exploitability 可由独立实现核对。
3. **同题开源交叉验证**：牌面、双方范围和权重、底池、有效后手与下注树全部相同，记录双方停止条件，再用共同的 exploitability 与 EV 门槛验收。
4. **商业同题抽样**：只有在许可允许、全部输入完全一致时才做少量人工比较；不抓取、不复制、不用商业 API 校准本项目。

第 1、2 级能证明求解链的数学与工程基础；第 3 级能证明某个锁定子博弈与另一份实现相符；它们都不能自动证明任意六人局节点已经达到商业 GTO。

## 当前已经完成的公开独立基线

当前唯一完成的公开独立河牌交叉验证来自 MIT 许可的 [`noambrown/poker_solver`](https://github.com/noambrown/poker_solver)，固定到 commit [`6a10442877ffc8fd28af93e16e279b9bbdd97b2a`](https://github.com/noambrown/poker_solver/tree/6a10442877ffc8fd28af93e16e279b9bbdd97b2a)。固定 commit 很重要：上游以后改变牌型、树语义或平均策略实现时，旧基准不会悄悄变成另一道题。

这次同题基线锁定为：

- 两人、无抽水、河牌子博弈；
- 公共牌 `A♣ K♦ 7♠ 4♥ 2♣`；
- OOP 与 IP 都使用 `AA / KK / QJs` 三个等权具体组合；
- 底池 10 BB、有效后手 10 BB；
- 只允许过牌，以及首次下注 100% pot；不允许再加注或额外全下分支；
- 上游使用 double precision CFR+ 运行 5,000 次，并保存原始动作 token、手牌顺序、生成命令、commit、许可与 SHA-256。

RangeCraft 会先用可信清单锁定仓库、完整 commit、许可、局面身份与 fixture 内容哈希，再逐字节验证保存的 `input.json` 和原始策略输出 SHA-256；之后才检查完整节点/动作覆盖，把上游的筹码单位、手牌顺序及 `c` 的过牌/跟注意义转换成自己的规范，并独立求解同一道题。运行：

```bash
npm run gto:benchmark:river
```

该命令使用仓库内带来源记录的上游输入与原始输出，不联网、不抓商业页面，也不把第三方求解器代码打包进网站。它先核对上游原生 best-response exploitability，再把外部与内部 profile 放入同一个严格审计模型，检查身份、范围权重、100% 节点/动作覆盖、profile value、重新计算的 exploitability、参考动作 EV regret 与动作频率误差；确切阈值以 [`benchmarks/external/noambrown-river-v1/reference.json`](benchmarks/external/noambrown-river-v1/reference.json) 为准。

这个结果的声明范围只能写成：**RangeCraft 的两人河牌实现，在这一棵锁定小树上通过了一项公开、独立、可复现的实现一致性检查。** 它不代表所有河牌、翻牌/转牌、翻前、不同尺度树或多人节点都已对齐，更不是商业策略数据库。

## 公开资源能怎样使用

| 资源 | 许可或访问边界 | 对 RangeCraft 的合法用途 | 不能据此声称什么 |
| --- | --- | --- | --- |
| [`noambrown/poker_solver`](https://github.com/noambrown/poker_solver) | [MIT](https://github.com/noambrown/poker_solver/blob/6a10442877ffc8fd28af93e16e279b9bbdd97b2a/LICENSE)；使用、修改和分发时保留版权与许可 | 当前实际采用的两人河牌同题基线；固定 commit、保存原始输出哈希和生成命令 | 一项小树通过不等于所有 HUNL 或六人局通过 |
| [OpenSpiel](https://github.com/google-deepmind/open_spiel) | Apache-2.0 | 核对 CFR/CFR+、best response、exploitability，以及 Kuhn/Leduc 等小博弈；也可作为 Universal Poker 的研究框架 | 它不是可直接下载的完整现金桌 GTO 策略库；把引擎接上 NLHE 规则也不等于已把巨大游戏求完 |
| [PokerBench](https://huggingface.co/datasets/RZ412/PokerBench) | 数据集页面标记 Apache-2.0 | 用大量 solver 标注的单点动作做宽泛的决策常识、解析和 UI 回归 | 数据主要给出场景与“最佳动作”，缺少完整混合频率、所有动作 EV、严格树身份与 exploitability，不能作为同题数值证明 |
| [PioSOLVER Free](https://piosolver.com/docs/product_comparison/) | 专有免费评估版，只能求两个示例翻牌；[官方条款](https://piosolver.com/docs/licensing/)禁止分发二进制和把结果做成按需服务 | 在其允许的示例牌面和条款内做人工、同配置抽样比较 | 不是开源代码或可再分发的数据集，也不能覆盖任意牌面 |
| [`b-inary/postflop-solver`](https://github.com/b-inary/postflop-solver) | AGPL-3.0-or-later；项目自 2023 年 10 月起暂停维护 | 作为独立进程离线生成自己有权使用的两人翻后对照结果，记录 commit 和完整配置 | 当前不把其代码链接、复制或打包进 RangeCraft；使用输出不能替代同题身份与误差审计 |
| [`TexasSolver`](https://github.com/bupticybee/TexasSolver) | AGPL-3.0；README 另说明代码集成或网络服务需联系商业许可 | 作为独立桌面/命令行工具人工求同题并导出 JSON，适合第二独立引擎抽查 | 不直接嵌入网站、不分发其二进制，也不把作者自己的 Pio 对比当成 RangeCraft 已通过 |
| [GTO Wizard](https://gtowizard.com/) | 商业专有服务；[Benchmark API 条款](https://gtowizard.com/benchmark/terms)禁止提取底层策略，亦禁止用 benchmark 数据训练、微调或校准第三方 AI/solver | 在用户自己的合法账户和产品条款内做少量人工学习与最终市场抽样 | 不抓取频率库、不批量保存页面数据、不把 API 当训练集或 solver oracle |

上表是本项目的工程使用边界，不构成法律意见。任何新引擎或数据进入仓库前，都要重新核对其当时的许可证和服务条款。

## 为什么没有一张“固定、大家都知道”的 GTO 表

GTO 是一套**指定博弈的均衡策略**，不是只由两张手牌决定的公式。下面任意一项变化，都可能改变混合频率与 EV：

- 参与人数、位置和各自 reach range；
- 有效筹码、底池、盲注、前注、抽水与封顶；
- 之前的行动和尺度；
- 当前及未来允许的下注/加注尺寸与次数；
- 牌面、阻断牌、ICM 或其他效用函数；
- 求解误差和牌/行动抽象。

即使输入完全相同，也可能存在多组 EV 几乎相同的均衡近似，所以不能只看某一手“下注 37% 还是 42%”。更可靠的比较是：配置身份一致、策略覆盖完整，并同时检查动作 EV regret 和 best-response exploitability。GTO Wizard 自己的[同题比较说明](https://blog.gtowizard.com/why-doesnt-my-solution-match-gto-wizard/)也强调范围、尺度、抽水、SPR 和收敛精度必须一致。

## 当前精度声明

- **两人通用 CFR+ / DCFR 核心**：CFR+ 已改为修正论文证明的交替错位平均；`DCFR(1.5,0,2)` 分别衰减正负 regret、保留负 regret 并按 `t²` 平均。两者均通过非对称矩阵逐轮手算、Kuhn 已知值，以及与 CFR 更新逻辑分离的穷举 best response 测试。
- **两人河牌**：实时单挑河牌默认分段运行 DCFR，并保存各检查点的 best-response exploitability，最终返回历史最低误差检查点。实验级结果不接管原提示；训练级结果只接管提示；只有较低误差级别才用于局部 solver EV 评分。公开独立同题交叉验证仍只有上面这一项 CFR+ fixture；它提高了对共同河牌模型与 CFR+ 实现正确性的信心，但样本数仍是 1，不能自动替 DCFR 的所有扑克节点完成外部验证。
- **三人河牌**：仍是实验功能。`10% pot` 是 3 个代表组合求解、5 个代表组合跨分辨率重算时的准入门槛；`3% pot` 只是更高稳定性的经验评分门槛。三人博弈也不享有两人零和 CFR 的同等收敛保证。市场没有统一的“商业阈值”；作为量级参照，GTO Wizard 的[三人局公开基准](https://blog.gtowizard.com/gto_wizard_ai_3_way_benchmarks/)报告其测试河牌低于 `0.1% pot` Nash distance。数字阈值表面上相差约 100/30 倍，但双方测试树和 `3%` 的稳定性指标并不相同，不能把它解释成精度倍数；RangeCraft 尚未计入全部范围抽象误差，不能称为精确 GTO。
- **牌桌大多数实时决策**：未命中解库时仍由本地范围/权益/阻断牌近似模型提供提示，必须显示为“近似”，不能展示伪造的 solver EV loss。

换句话说，当前计算在已锁定并通过测试的范围内是可解释、可复现的；项目不会把“一项基准通过”扩张成“整个训练器已经符合商业 GTO”。

## 下一步公开验证计划

1. 增加更多不同牌面、范围不对称、价值/诈唬结构和尺度树的 `noambrown` 固定基线，并用其 `--algo dcfr` 生成带明确 update-order 元数据的第二类 oracle。
2. 用 OpenSpiel 的小博弈与另一套 best-response 实现持续做算法回归；OpenSpiel 的 DCFR 文件本身注明尚未验证能复现论文结果，因此只作交叉参考，不作为唯一正确性来源。
3. 用 `postflop-solver` 或 TexasSolver 作为第二个独立翻后引擎，只导入许可清晰、同题生成且带 provenance 的结果。
4. 把 PokerBench 限定为动作常识回归，不混入 solver 精度指标。
5. 只有积累足够的同题覆盖后，才把某一类节点从“内部已求解”提升为“外部复核”；三人节点在有独立多方基准前继续标“实验”。
