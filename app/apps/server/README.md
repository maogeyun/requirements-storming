# Match-server（RedQueen V1）

权威对局服务：客户端只发 **intent**，服务端用同仓 `@rs/rules-engine` 的 `listLegalActions` → `applyAction` 校验并推进，再广播 **座位作用域 view**（从不下发他座手牌 / OKR 内容）。

## 协议（WS JSON）

| 方向 | `type` | 说明 |
|------|--------|------|
| C→S | `join` | `mode`: `create` \| `join` \| `match`；联机固定满 **4** 开局（不可不足开） |
| C→S | `intent` | `{ action: GameAction }`；非法则 `error` |
| C→S | `resync` | 重拉本座 `view` + 当前 `force` |
| C→S | `leave` | 离开；局内仅标记断线（Bot 接管后续） |
| S→C | `view` | 含 `seatId` / stub `seatToken` / `lobby` 或座位 `view` |
| S→C | `force` | 暗标 / C-13 / C-14 强制窗 |
| S→C | `error` | 含 `ErrorCode`；非法 intent 带 `rejectedAction` |

鉴权 V1：stub `seatToken`（Steam Session Ticket 后补）。主机不可改规则。开局条件：`seated === 4`（不足拒绝）。

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
