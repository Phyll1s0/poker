# RangeCraft 德州扑克训练室

一个兼顾本地训练和私人在线牌桌的德州扑克练习游戏。它提供逐手教学、20 手常规整局与血战鱿鱼整局，并用混合频率电脑对手练习范围、诈唬、阻断牌和桌上形象判断。

在线体验：[https://phyll1s0.com/poker/](https://phyll1s0.com/poker/)

预留独立域名：[https://poker.phyll1s0.com/](https://poker.phyll1s0.com/)（等待 GitHub 签发 HTTPS 证书）

## 当前功能

- 外层模式主页：进入单人训练时才创建牌局，也可免注册进入多人大厅
- 完整的翻牌前、翻牌、转牌和河牌行动流程
- 牌型比较、平分底池、全下与边池结算
- 浅筹 40 BB、标准 100 BB、深筹 200 BB 和血战鱿鱼 200 BB 四种桌型
- 单手训练：每手结束立即解锁决策路径、混合频率参考和对手画像
- 20 手整局：中途隐藏胜率、答案、分数与 AI 类型，第 20 手后统一生成报告
- 血战鱿鱼整局：中途隐藏策略答案，9 条鱿鱼全部发完并结算后统一生成报告
- 五类隐藏 AI 策略画像；每个座位独立随机抽取，同一桌允许出现重复风格，整局结束前不公开类型
- 翻前使用组合加权的 169 手牌基准表，区分位置、RFI、面对 open/3-bet/4-bet、有效筹码和尺度；不再用单一牌力排名代替位置范围
- AI、实时教练与复盘共用同一份连续混合策略；翻后同时考虑行动加权范围权益、直接赔率、权益实现、SPR、牌面纹理、听牌、真实阻断牌与多人行动压力
- 动作频率与“进入加注分支后的条件尺度频率”分层展示；AI 会实际采样同一组合法尺度，而非永远执行一个固定尺寸
- 界面对局与无头自博弈共用牌型、权益特征和决策核心，可用固定种子做数万手强度回归
- AI 会根据你的公开行动形成松紧、侵略性与欺骗性画像，再调整对你的继续范围
- 玩家和 AI 均可在无需摊牌的赢池中选择亮牌或盖牌；正常摊牌强制公开
- 基于公开下注线加权对手范围，并用固定牌局种子稳定估算具体手牌的摊牌权益、可争夺底池赔率和权益实现参考线；短码超额全下与多人边池按层处理
- 以“主频路线 / 可接受混合 / 低频路线”解释动作；尺度只能扣减动作评价，不能把极低频动作抬成正确答案
- 翻牌三张按顺序出现，转牌与河牌单张发出，发牌期间暂停行动
- 本地合成的敲桌、筹码、弃牌、发牌和赢池音效
- 响应式桌面与移动端界面
- 2–10 人私人多人桌：只需设置公开昵称，随后可创建房间、用 8 位邀请码入桌、准备与连续对局
- 服务端权威多人引擎：Web Crypto 洗牌、严格合法动作、全下跑牌、主池/边池、平分和秀牌/盖牌
- 多人亮牌选择使用 8 秒服务端倒计时，下一手使用全桌统一 4 秒倒计时；赢家离线或玩家未逐一准备都不会永久卡桌
- 房主可在当前手完整结算后结束整局；全员会看到同一份最终排名、净盈亏、VPIP/PFR、翻后主动频率、摊牌与超时统计，并可保留邀请码重开
- 多人下注支持精确输入、滑杆、半池/三分之二池/满池/全下快捷尺寸，并分别显示本街下注、整手底池和未跟注退回
- 暂离牌桌会保留座位供重连；永久离开可在任何阶段执行，未全下自动弃牌、全下正常结算，并在安全节点释放座位和转移房主
- 每位玩家只收到自己的暗牌；牌堆、他人暗牌和服务器内部命令记录不会进入客户端响应
- Supabase Postgres 持久化匿名牌手、房间和牌局状态，以 revision + 幂等请求防止重复行动和并发覆盖
- Supabase Edge Function 执行洗牌和全部行动；数据库表拒绝浏览器直接访问，访客令牌只在本机保存
- `PokerTransport` 保留 polling 与未来 WebSocket 实现的统一契约
- 为预计算 GTO 数据库或远程求解器提供 V2 安全节点键、精确/回退 provenance 与同步缓存 / 异步加载 Provider 协议
- RangeCraft Standard v1 固定 100BB、无抽水 cEV、2.5BB 开池和完整离散下注树，并用稳定哈希阻止不同配置误命中
- 通用两人零和 CFR+、DCFR(1.5,0,2) 与论文 PDCFR+(2.3,5) 核心通过手算递推、Kuhn Poker 已知均衡值和精确 exploitability 回归
- 可离线求解带权范围对范围的真实 1v1 河牌子博弈；实时教练按检查点运行 DCFR，用 scalable best response 报告 NashConv / exploitability，并返回历史最低误差策略
- 1v1 河牌已有一项固定 commit、同牌面/范围/底池/树的公开独立交叉验证；公开资源、许可边界和精度声明见 [`PUBLIC_GTO_VALIDATION.md`](PUBLIC_GTO_VALIDATION.md)

> 当前牌桌 AI 与实时教练的大多数节点仍使用本地近似 GTO 混合频率策略，并非完整求解器。仓库已经加入可验证的 CFR+/DCFR/PDCFR+ 与 1v1 河牌求解链，但公开独立交叉验证目前只有一棵 CFR+ 固定河牌小树，尚未覆盖任意完整 6–10 人动态节点；未命中解库前，界面中的评分仍是策略匹配度，不是精确 EV 损失。

## 两种训练模式

- **单手训练**：每手按当前桌型重置为 40、100 或 200 BB，每个 AI 座位重新独立随机抽取类型，可能重复；适合边打边学。
- **20 手整局**：AI 类型在整局内保持一致，筹码跨手保留；低于 1 BB 时自动补充到当前桌型的起始筹码。所有答案在最后统一揭晓，适合检验没有提示时的真实决策。

## 桌型与血战鱿鱼

- **浅筹现金**：40 BB，强牌更常进入低 SPR 和全下决策。
- **标准现金**：100 BB，适合常规六人桌训练。
- **深筹现金**：200 BB，增加转牌、河牌与大底池决策比重。
- **血战鱿鱼**：200 BB，仅使用整局模式；六人桌每轮争夺 9 条鱿鱼，9 条全部发完即结束本局并统一复盘。基础价值 5 BB，同一玩家可以累积；持有 3、5、7 条时分别按 ×2、×3、×4 计价。

鱿鱼模式中，独赢主池获得一条；无人跟注赢池时必须选择亮牌才获得，盖牌会保留信息但放弃本条；平分主池不发。9 条发完后，零条玩家向所有持有者结算。若桌面筹码不足以支付，系统会记录额外投入后完成结算，因此最终报告同时显示桌面筹码、总投入与净结果。

## 技术栈

- TypeScript
- React 19
- Vinext + Vite
- GitHub Pages（公开前端与 PWA）
- Supabase Postgres + Edge Functions（多人后端）
- Sites / Cloudflare Worker 兼容构建（保留原部署）

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。单人训练可直接使用。公开静态版使用：

```bash
npm run build:pages
```

多人前端通过 `github-pages/MultiplayerApp.tsx` 调用 Supabase；数据库迁移和服务端函数源码位于 `supabase/`。

## 验证

```bash
npm run lint
npm run build
npm test
```

## AI 自博弈基准

默认在本地运行 20,000 手六人桌，并按隐藏策略风格统计 VPIP、PFR、侵略系数、摊牌胜率、bb/100 与按牌桌手聚类的近似置信区间：

```bash
npm run ai:benchmark
```

也可以提高样本量、切换筹码深度或权益采样数：

```bash
npm run ai:benchmark -- --hands 100000 --seed my-run --stack-bb 200 --equity-iterations 8
```

发牌、阵容、权益采样和动作混频使用相互独立的固定种子随机流，便于重复运行和对比策略修改。最新基准与解读见 [`SELF_PLAY_BENCHMARK.md`](SELF_PLAY_BENCHMARK.md)。它用于发现策略漏洞和回归强度，不等同于 CFR/GTO 求解或正式的可利用度证明。

## GTO 求解基线

完整设计、商业对标边界、1v1 / 1v2 / 翻前实施顺序和验收门槛见 [`GTO_SOLVER_ROADMAP.md`](GTO_SOLVER_ROADMAP.md)；公开求解器、数据集、商业免费版的用途和许可边界见 [`PUBLIC_GTO_VALIDATION.md`](PUBLIC_GTO_VALIDATION.md)。

仓库内置一个小型真实河牌范围节点。命令默认使用论文参数 `DCFR(1.5,0,2)`；也可传 `--algorithm cfr+` 保留原基线，或用 `--algorithm pdcfr+` 运行 IJCAI 2024 的预测折扣交叉审计通道：

```bash
npm run gto:river -- \
  --input examples/gto-river-node.json \
  --algorithm dcfr \
  --iterations 50000 \
  --output river-solution.json
```

输出会包含覆盖完整牌面/范围/权重/底池/筹码的 `spotId`、规则 `gameSpecId`、河牌树 `treeId`、solver 版本、每个组合在各公开行动线的混合频率，以及通过 best response 计算的树内 exploitability。这个命令用于离线生成和审计策略；完整范围的大规模节点后续应由原生并行求解任务预计算，浏览器只加载策略分片。

PDCFR+ 按作者粗网格搜索后用于全部实验的参数 `α=2.3, γ=5` 折扣早期累计 regret，并只把本轮即时 regret 作为一次性的下一轮预测；它不会被重复写入显式累计 regret。交替更新时，每位玩家在自己的 regret 更新前把当前 `xᵗ` 累入多项式加权平均，与论文公式和作者参考实现的相位一致。默认实时路径仍使用 DCFR：原论文在大型 HUNL 子博弈中只报告 PDCFR+ 与 CFR+/PCFR+ 相当，并没有证明它在扑克上总是更快。无论选择哪种算法，RangeCraft 都以同一棵树上的精确 best response 误差决定是否可用，不以算法名称或频率相似度代替误差证书。

公开独立基线使用 MIT 许可的 [`noambrown/poker_solver`](https://github.com/noambrown/poker_solver) commit `6a10442877ffc8fd28af93e16e279b9bbdd97b2a`。它把同一牌面、具体组合范围、底池、有效后手和下注树交给两套实现，并拒绝不完整或身份不一致的比较：

```bash
npm run gto:benchmark:river
```

这是一项实现一致性检查，不是完整商业策略库，也不能证明其他河牌、翻前、转牌/翻牌或三人节点已经对齐。

## 操作

- `F`：弃牌
- `C`：过牌或跟注
- `R`：加注
- `N`：开始下一手

无需摊牌赢池时，先在底部操作栏选择“亮出手牌”或“盖牌”，再开始下一手。常规整局第 20 手、或鱿鱼整局第 9 条发完后，`N` 只会打开复盘，不会继续发牌。

## 扩展接口

[`lib/poker-transport.ts`](lib/poker-transport.ts) 定义了带身份、幂等键和版本号的牌桌命令、脱敏状态快照与传输层契约。当前多人版通过 Supabase Edge Function 短轮询同步；后续可以在不重写牌桌 UI 的情况下替换为 Realtime / WebSocket 通道。

[`lib/poker-strategy.ts`](lib/poker-strategy.ts) 保留 V1 兼容接口，并新增 V2 完整配置、稳定节点键、合法尺寸、动作 EV、误差/许可来源与精确/回退判别联合。筹码、抽水、树、尺度或行动线只要不同就不会误命中同一解；玩家重连 ID 改变但位置和局面相同则不会产生假 miss。

[`lib/gto-standard.ts`](lib/gto-standard.ts) 锁定首个可复现牌局/下注树规范与策略结果 schema；[`lib/gto-cfr.ts`](lib/gto-cfr.ts) 提供论文相位的 CFR+ 与 `DCFR(α,β,γ)` 核心；[`lib/gto-river.ts`](lib/gto-river.ts) 将它们接到真实德州扑克河牌范围子博弈，并提供带连续误差门和 best-checkpoint 选择的自适应求解。

[`lib/gto-benchmark.ts`](lib/gto-benchmark.ts) 只比较用户合法提供、且 `gameSpecId/treeId` 完全相同的参考结果，报告 reach 覆盖率、频率 total variation、最大单动作误差和参考动作 EV 下的 regret；它不会联网或抓取商业策略数据。仓库内第一项公开 reference 的可信来源、原始输入/输出、SHA-256、生成命令与阈值保存在 [`benchmarks/external/noambrown-river-v1/`](benchmarks/external/noambrown-river-v1/)。
