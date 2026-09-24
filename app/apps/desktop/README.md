# 桌面壳（Tauri 2）

《需求风暴》的桌面窗口。壳只做一件事：用系统 WebView 打开现有 `apps/web`。

- 窗口初始地址是 `/play?mode=vs_bot`（人机预选）。首页、大厅、联机牌桌随同一次静态导出带上，路由仍是 web 里原来的那些。
- 人机走 web 里已有的本地规则引擎（`createGame` / `listLegalActions` / `applyAction`），与浏览器人机同一条路径。
- 联机仍连接独立的 match-server。壳里不启动、不内嵌权威进程。
- 本目录没有第二套 UI，也不改规则引擎。成就、自动更新、安装器皮肤不在这里。Steamworks V1（初始化、SteamID、会话票据、浮层）见下文。

## 前端怎么接进壳

| 模式 | WebView 加载什么 |
| --- | --- |
| `tauri dev` | `http://localhost:3000`（`beforeDevCommand` 拉起 `pnpm --filter @rs/web dev`） |
| `tauri build` | `apps/web/out`，打进二进制 |

发布不能用 `next start`。Tauri 2 只嵌入静态资源。当前 Next 15 应用没有 API Route / Server Action，所以桌面发布走官方静态导出：`pnpm --filter @rs/web build:desktop` 让 `next build` 使用 `output: 'export'`，产物在 `apps/web/out`。普通 `pnpm --filter @rs/web build` 和 `next start` 仍是给网站用的 Node 服务，不受这次导出影响。

Tauri 会把 `/play` 解析到 `play.html`（Next 默认导出文件名）。`/`、`/lobby`、`/play/online`、`/rules` 同样落在这次导出里。

## 环境

开发与发布分开，仓库里只有示例，没有密钥。

- Web / 导出：`app/.env.local` 里的 `NEXT_PUBLIC_WS_URL`（示例见 `app/.env.example`）。未设置时客户端默认 `ws://localhost:8787`。
- 桌面进程：启动壳之前设置 `WS_URL`（`ws://` 或 `wss://`）。壳在页面脚本之前写入 `window.__RS_WS_URL`，覆盖上面的构建期地址。留空则沿用 web 的值。示例见本目录 `.env.example`。

联机对局另开一个终端跑 `pnpm dev:server`。人机不需要 match-server。

## 开发

需要 Node 20+、pnpm、Rust stable（1.88+），以及本机 WebView（Windows 为 WebView2；Linux 为 WebKitGTK 4.1）。

```bash
cd app
pnpm install
pnpm dev:desktop
# 等价：pnpm --filter @rs/desktop dev
```

窗口标题为「需求风暴」，约 1280×800，可放大，最小约 1100×720，给牌桌留出周围座位。

冒烟：窗口打开 `/play` 且「人机」已选中 → 点「开始」→ 点「翻开事件」，本座完成一手。

## Windows 安装包

在 **Windows** 上构建（本仓库的 Linux CI / Cloud VM 打不出 `.msi` / NSIS `.exe`）：

```bash
cd app
pnpm install
pnpm --filter @rs/desktop build:win
```

`build:win` 即 `tauri build --bundles msi,nsis`。产物：

- `apps/desktop/src-tauri/target/release/bundle/msi/*.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe`

可执行文件名来自 `productName`：`RequirementStorm`。窗口标题仍是「需求风暴」。

Windows 机器还需要 Visual Studio C++ 生成工具和 WebView2 运行时（安装包会带上 WebView2 bootstrapper）。发布机构建时若要写死网关，先设 `NEXT_PUBLIC_WS_URL` 再执行 `build:win`；玩家机器上也可以只设 `WS_URL`，不必重编。

在当前平台打本机包（Linux 上是 `.deb`，不是 Windows 安装包）：

```bash
pnpm --filter @rs/desktop build:linux
```

## CSP 与出站

生产 CSP 写在 `src-tauri/tauri.conf.json`，注入到导出的 HTML：

- `connect-src` 允许 `ws:`、`wss:`、`https:`，这样可配置的 match-server 网关不会被 CSP 拦住。同时也放行 Tauri IPC（`ipc:` / `http://ipc.localhost`）。
- `style-src` / `font-src` 放行现有 UI 使用的 Google Fonts。
- 开发态 `devCsp` 额外放行 `localhost:3000` 的脚本、`unsafe-eval` 和 HMR WebSocket。桌面 dev 直接打开 Next，这条策略只在 Tauri 往 HTML 注入 CSP 时生效。

壳不携带 Steam Web API 密钥或网关密码。会话票据只在联机 join 时向 match-server 提交，不写进页面全局变量。

## Steamworks V1

社区绑定是 [`steamworks`](https://crates.io/crates/steamworks)（steamworks-rs），用 Cargo feature `steam` 打开。默认构建**不链接** Steamworks，CI 不需要安装 Steam SDK。带 Steam 的桌面构建走真实 `SteamAPI_Init` / `SteamAPI_Shutdown`。

```bash
# 真实路径（需要本机 Steam 客户端，以及 AppID）
pnpm --filter @rs/desktop dev:steam
pnpm --filter @rs/desktop build:steam
pnpm --filter @rs/desktop build:steam:win
pnpm --filter @rs/desktop build:steam:linux
```

### AppID

启动时按这个顺序读取，用 `Client::init_app`：

1. 环境变量 `STEAM_APP_ID`
2. 当前工作目录的 `steam_appid.txt`（`tauri dev` 的 cwd 是 `src-tauri`）
3. 可执行文件旁边的 `steam_appid.txt`

文件里只有一行数字。示例见 `src-tauri/steam_appid.txt.example`（`480`，Valve 的 Spacewar，只适合本地把 Steam 初始化跑通）。复制为 `src-tauri/steam_appid.txt`（已 gitignore）。正式 AppID 不要提交。

没配 AppID，或 **Steam 客户端没开 / 没登录**，窗口仍然打开，`/play` 人机可以点「开始」。页面顶部会显示失败原因（「未配置 Steam AppID」或「Steam 客户端未运行」）。未启用 `steam` feature 的构建会说明要改用 `dev:steam`。

### 浮层

「打开 Steam 浮层」调用 `ISteamFriends::ActivateGameOverlay("Friends")`，只打开 Steam 自己的浮层，不是邀请进房。壳保持现有窗口模式，不铺一层挡住点击的罩子。状态条是普通文档流（`position: static`，`pointer-events: none`），不覆盖 `/play` 的点选出牌（`.hand-card`）和强制窗（`.forced-window`）。人机不依赖浮层。

### 联机票据

Steam 初始化成功后，建房 / 加入 / 自由匹配会取 `GetAuthTicketForWebApi`（identity `requirement-storm`）的 hex 票据，放进 `join.sessionTicket`。match-server 用 Publisher Key 向 `ISteamUserAuth/AuthenticateUserTicket` 交换 SteamID，再签发 `seatToken`。断线重连只交 `seatToken`。人机对局不取票据。

运行时还要把 Steam 再分发包放在可执行文件旁边（Windows `steam_api64.dll`，Linux `libsteam_api.so`），否则真实构建能编过、启动时仍会失败。见 steamworks-rs 关于 redistributable 的说明。

不做：P2P/UDP、成就、排行榜、云存档、Workshop、好友邀请进房、Rich Presence、Deck、商店素材。
