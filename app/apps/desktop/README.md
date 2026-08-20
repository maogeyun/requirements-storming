# Desktop 客户端（S1）

Electron 壳 + Steamworks 绑定，**不在 M0 实现**。

S1 将创建：

- Electron 主进程加载 `apps/web` 静态构建或远程 URL
- `steamworks.js` 集成：登录、Lobby、Rich Presence、成就

联机仍依赖 `apps/server` 权威房间服务。
