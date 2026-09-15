# Match-server（RedQueen V1）

权威对局服务：客户端只发 **intent**，服务端用同仓 `@rs/rules-engine` 的 `listLegalActions` → `applyAction` 校验并推进，再广播 **座位作用域 view**（从不下发他座手牌 / OKR 内容）。

## 协议（WS JSON）

| 方向 | `type` | 说明 |
|------|--------|------|
| C→S | `join` | `mode`: `create` \| `join` \| `match`；联机固定满 **4** 开局（不可不足开） |
| C→S | `intent` | `{ action: GameAction }`；非法则 `error` |
| C→S | `resync` | 重拉本座 `view` + 当前 `force` |
| C→S | `leave` | 离开；局内走断线 grace → Bot 托管（与 WS close 相同） |
| S→C | `view` | 含 `seatId` / stub `seatToken` / `lobby` 或座位 `view`；可带 `presence` / `reclaimed` |
| S→C | `force` | 暗标 / C-13 / C-14 强制窗 |
| S→C | `error` | 含 `ErrorCode`；非法 intent 带 `rejectedAction` |

鉴权 V1：stub `seatToken`（Steam Session Ticket 后补）。主机不可改规则。开局条件：`seated === 4`（不足拒绝）。

### 断线 / 重连 / 超时托管（i-pple）

- 默认 grace **`DISCONNECT_GRACE_MS = 45_000`**（可在 `MatchRoom` 构造时覆盖）。
- 局内断线：座位保留；`presence` 下发 `graceRemainingSec`；客户端顶条「连接中断 · N 秒内可回」。
- Grace 到期：该真人座 `disconnectHosted` → 启发式 Bot 代打（复用 `@rs/rules-engine`）；客户端弱提示「本座已托管」。
- `seatToken` 重连收回座位：清 grace / hosted；`reclaimed: true` 触发一行 toast + 焦点回手牌/强制窗。
- `presence.hosted` **仅**用于断线托管；自由匹配静默补位 Bot **永不**标 hosted。

### 自由匹配（i-pple 不泄锁）

- `mode: "match"`：真人优先凑满 4；不足时 **60s** 后静默用启发式 Bot 补位并开局。
- 客户端 Ambient 文案仅「正在匹配玩家 · Ns / 预计不久开局」——**不下发**超时倒计时、Bot、补位、「匹配失败」。
- Bot 座位用假人名；`LobbyPlayer` / `PlayerView` **永不**带 `isBot`。

## 本地启动

```bash
cd app
pnpm install
pnpm dev:server
# → ws://localhost:8787
```

端口可用 `MATCH_SERVER_PORT` 覆盖。

### 冒烟（4 客户端）

1. 客户端 A：`{ "type":"join","mode":"create","displayName":"A" }` → 记下 `roomCode` / `seatToken`（仍 lobby）
2. B/C/D：`{ "type":"join","mode":"join","roomCode":"<code>","displayName":"…" }` → 第 4 人入座后自动开局，四方收到 `view`
3. 非当前座位发 `{ "type":"intent","action":{ "type":"FLIP_EVENT" } }` → `error`（非法拒绝）
4. 当前座位发同样 `FLIP_EVENT` → 各方 `view`，状态推进

不足 4 人时主机 `tryStartGame` / 任何提前开局路径 → `INSUFFICIENT_PLAYERS`。

```bash
pnpm --filter @rs/server test
```
