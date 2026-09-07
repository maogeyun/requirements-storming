# 《需求风暴》Requirement Storm

Web / Steam 联机卡牌游戏 monorepo（策划案 v1.2）。

## 结构

```
app/
├── packages/
│   ├── game-data/      # 卡表 JSON（42+9+6+6）+ 常量
│   ├── shared/         # 共用类型、WS 协议、错误码
│   └── rules-engine/   # 规则引擎（纯逻辑）
├── apps/
│   ├── server/         # PartyKit 联机房间服务
│   ├── web/            # Next.js 15 前端
│   └── desktop/        # Electron 壳（S1 占位）
├── steam/              # Steamworks 配置（S1 占位）
├── tests/
│   └── integration/    # 联机集成测试（M4 占位）
├── .env.example
├── eslint.config.js
└── pnpm-workspace.yaml
```

## 架构数据流

```
Web 客户端 ──WS──▶ apps/server (PartyKit)
                      │
                      ▼
                 rules-engine (validate + apply)
                      │
                      ▼
              broadcast PlayerView（按玩家过滤手牌/OKR/暗标）
```

## 快速开始

```bash
cd app
cp .env.example .env.local   # 可选
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm validate:data
```

workspace 包（`@rs/shared` / `@rs/game-data` / `@rs/rules-engine`）以 **TS 源** 导出，供 Next `transpilePackages` 与 Vitest 直接消费；相对导入不使用 `.js` 后缀（`moduleResolution: Bundler`）。安装后无需先 `pnpm -r build` 即可跑 web。

启动开发服务（两个终端）：

```bash
pnpm dev:server   # PartyKit @ localhost:1999
pnpm dev:web      # Next.js @ localhost:3000
```

## 当前进度

### M0 仓库和架构（已完成）

- [x] monorepo 结构符合 §3.1
- [x] 卡表 v1.2 JSON + 校验脚本
- [x] `@rs/shared` 类型 / 协议 / 错误码
- [x] PartyKit server 骨架 + player-view 过滤
- [x] Next.js 最小可运行前端
- [x] ESLint + pnpm workspace + `.env.example`

### M1 引擎（进行中）

- [x] `createGame()` + FIX-01 暗标检测/结算
- [x] 单元测试：TC-610、TC-701、TC-703、TC-705、TC-706
- [x] Turn 四阶段完整流程（draw → plan → execute → end）
- [x] 跨线补开可中断状态 `pendingDarkBid` + `pendingProgressSettlement`
- [x] Web 最小可玩壳 `/play`（本机多座位）
- [ ] 事件牌 / 互动链 / Season / Sprint / OKR

### M2+（待做）

- [ ] 联机完整 action 校验链
- [ ] 大厅 / 牌桌 UI
- [ ] 暗标 reveal 时序、断线重连

## M1 可玩壳

```bash
cd app
pnpm install
pnpm --filter @rs/web dev
# 打开 http://localhost:3000/play
```

手动验收：开局确认规则 v1.2 → 推进四阶段 →「演示：跨线补开」验证强制暗标不可跳过。

## 设计文档

- [Notion 主策划页](https://app.notion.com/p/389cb94e2e75800ea77ad4933df7915a)
- [策划案 v1.2](https://app.notion.com/p/00cef5bf58cf4f3a906a216b88cb60f9)
- [卡表 v1.2](https://app.notion.com/p/7d4b5e221ba84f63b6d44968acecf1e1)
