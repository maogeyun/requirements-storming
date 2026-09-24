# Steam 轨道（S0–S5）

桌面壳在 [`apps/desktop`](../apps/desktop)（Tauri 2）。Steamworks V1 已接在壳上：`SteamAPI_Init` / `Shutdown`、读取 SteamID、Web API 会话票据、可打开的 Steam 浮层。AppID 的配置方式见 [`apps/desktop/README.md`](../apps/desktop/README.md)（`STEAM_APP_ID` 或启动目录的 `steam_appid.txt`）。

本目录仍不放成就、Depot 或商店素材。后续才填：

- `app_build.vdf` / depot VDF — SteamPipe 构建
- `achievements.json` — Steam 成就定义

联机身份交换在 match-server（`STEAM_WEB_API_KEY` + `STEAM_APP_ID`），不在这个目录放密钥。
