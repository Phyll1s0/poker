# RangeCraft 德州扑克训练室

一个完全在本地运行的 6 人桌德州扑克训练游戏。你会面对五种不同策略画像的电脑玩家，并在每次决策后获得胜率、底池赔率、推荐线路与评分反馈。

## 当前功能

- 完整的翻牌前、翻牌、转牌和河牌行动流程
- 牌型比较、平分底池、全下与边池结算
- 五类 AI：GTO 平衡、松凶压迫、紧凶价值、动态适应、稳健保守
- 蒙特卡洛胜率估算、底池赔率、SPR 和实时训练建议
- 决策评分、行动记录与快捷键操作
- 本地合成的敲桌、筹码、弃牌、发牌和赢池音效
- 响应式桌面与移动端界面
- 为未来 WebSocket 多人模式预留的 `PokerTransport` 接口

> 当前 AI 是轻量的 GTO 启发式策略，并非完整的商业 GTO 求解器。它结合牌力模拟、赔率、位置和对手风格参数，适合高频基本功训练。

## 技术栈

- TypeScript
- React 19
- Vinext + Vite
- Cloudflare Worker 兼容构建

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 验证

```bash
npm run build
npm test
```

## 操作

- `F`：弃牌
- `C`：过牌或跟注
- `R`：加注
- `N`：开始下一手

## 多人模式扩展

[`lib/poker-transport.ts`](lib/poker-transport.ts) 定义了牌桌命令、状态快照和传输层契约。后续可以在不重写牌桌 UI 的情况下接入 WebSocket 房间、账号系统和服务端权威牌局引擎。
