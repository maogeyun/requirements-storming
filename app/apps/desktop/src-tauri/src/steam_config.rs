//! AppID resolution and the user-facing Steam boot copy.
//! This module does not link Steamworks, so CI can test it without the SDK.
#![cfg_attr(not(feature = "steam"), allow(dead_code))]

/// Spacewar. Valve's sample AppID; fine for local init, not a shipping id.
#[cfg_attr(not(test), allow(dead_code))]
pub const SPACEWAR_APP_ID: u32 = 480;

pub const MISSING_APP_ID_MESSAGE: &str = "\
未配置 Steam AppID。请设置环境变量 STEAM_APP_ID，或在游戏启动目录放置 steam_appid.txt（文件里只有一行数字）。\
本地调试可先写 480（Spacewar 示例）。人机对局仍可开始；联机鉴权需要有效的 AppID。";

pub const CLIENT_NOT_RUNNING_MESSAGE: &str = "\
Steam 客户端未运行。请先启动 Steam 并登录，再重新打开游戏。\
人机对局仍可开始；联机鉴权不可用。";

#[cfg_attr(feature = "steam", allow(dead_code))]
pub const STUB_BUILD_MESSAGE: &str = "\
当前桌面构建未链接 Steamworks。人机对局可以开始。\
要走真实 Steam 初始化，请使用已启用 steam feature 的构建（pnpm --filter @rs/desktop dev:steam），\
并先启动 Steam 客户端、配置 steam_appid。";

pub const OVERLAY_DISABLED_MESSAGE: &str = "\
Steam 浮层当前未开启。请在 Steam 设置中启用游戏内界面。\
关闭浮层后，牌桌点选出牌和强制窗可以继续操作。";

pub const OVERLAY_UNAVAILABLE_MESSAGE: &str =
    "现在不能打开 Steam 浮层。人机对局不需要浮层，点选出牌和强制窗不受影响。";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SteamStatus {
    pub build: &'static str,
    pub ready: bool,
    pub steam_id: Option<String>,
    pub overlay_enabled: bool,
    pub message: Option<String>,
}

impl SteamStatus {
    #[cfg_attr(feature = "steam", allow(dead_code))]
    pub fn stub() -> Self {
        Self {
            build: "stub",
            ready: false,
            steam_id: None,
            overlay_enabled: false,
            message: Some(STUB_BUILD_MESSAGE.to_string()),
        }
    }

    pub fn missing_app_id() -> Self {
        Self {
            build: "steam",
            ready: false,
            steam_id: None,
            overlay_enabled: false,
            message: Some(MISSING_APP_ID_MESSAGE.to_string()),
        }
    }

    pub fn client_not_running(detail: &str) -> Self {
        let detail = detail.trim();
        let message = if detail.is_empty() {
            CLIENT_NOT_RUNNING_MESSAGE.to_string()
        } else {
            format!("{CLIENT_NOT_RUNNING_MESSAGE}（{detail}）")
        };
        Self {
            build: "steam",
            ready: false,
            steam_id: None,
            overlay_enabled: false,
            message: Some(message),
        }
    }

    pub fn ready(steam_id: String, overlay_enabled: bool) -> Self {
        Self {
            build: "steam",
            ready: true,
            steam_id: Some(steam_id),
            overlay_enabled,
            message: None,
        }
    }
}

/// `STEAM_APP_ID` wins, then the current working directory file, then the file
/// next to the executable. `steam_appid.txt` is a single unsigned integer.
pub fn resolve_app_id(env_value: Option<&str>, files: &[Option<&str>]) -> Result<u32, String> {
    if let Some(raw) = env_value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return parse_app_id(trimmed).map_err(|_| MISSING_APP_ID_MESSAGE.to_string());
        }
    }
    for file in files {
        if let Some(raw) = file {
            if let Ok(id) = parse_app_id(raw) {
                return Ok(id);
            }
        }
    }
    Err(MISSING_APP_ID_MESSAGE.to_string())
}

pub fn parse_app_id(raw: &str) -> Result<u32, ()> {
    let line = raw.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return Err(());
    }
    let id: u32 = line.parse().map_err(|_| ())?;
    if id == 0 {
        Err(())
    } else {
        Ok(id)
    }
}

pub fn load_app_id() -> Result<u32, String> {
    let env = std::env::var("STEAM_APP_ID").ok();
    let cwd = std::fs::read_to_string("steam_appid.txt").ok();
    let beside_exe = std::env::current_exe().ok().and_then(|path| {
        let file = path.parent()?.join("steam_appid.txt");
        std::fs::read_to_string(file).ok()
    });
    resolve_app_id(env.as_deref(), &[cwd.as_deref(), beside_exe.as_deref()])
}

/// Assign `window.__RS_STEAM__` before page scripts. Values are JSON-encoded.
pub fn steam_init_script(status: &SteamStatus) -> String {
    let payload = serde_json::json!({
        "build": status.build,
        "ready": status.ready,
        "steamId": status.steam_id,
        "overlayEnabled": status.overlay_enabled,
        "message": status.message,
    });
    let literal = serde_json::to_string(&payload).unwrap_or_else(|_| "null".to_string());
    let literal = literal.replace('<', "\\u003c");
    format!("window.__RS_STEAM__ = {literal};")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_app_id_wins_over_files() {
        let files = [Some("480\n")];
        assert_eq!(resolve_app_id(Some("123456"), &files).unwrap(), 123456);
    }

    #[test]
    fn reads_the_first_usable_appid_file() {
        let files = [None, Some("480\n")];
        assert_eq!(resolve_app_id(None, &files).unwrap(), SPACEWAR_APP_ID);
    }

    #[test]
    fn rejects_blank_and_zero_app_ids() {
        assert!(parse_app_id("").is_err());
        assert!(parse_app_id("0").is_err());
        assert!(parse_app_id("nope").is_err());
        assert!(resolve_app_id(Some("0"), &[Some("480")]).is_err());
        assert!(resolve_app_id(None, &[Some(""), None]).is_err());
    }

    #[test]
    fn client_not_running_copy_is_user_facing() {
        let status = SteamStatus::client_not_running("SteamAPI_Init returned 1");
        let message = status.message.unwrap();
        assert!(message.contains("Steam 客户端未运行"));
        assert!(message.contains("人机对局仍可开始"));
        assert!(message.contains("SteamAPI_Init returned 1"));
        assert!(!status.ready);
        assert_eq!(status.build, "steam");
    }

    #[test]
    fn stub_build_tells_the_player_how_to_enable_steam() {
        let status = SteamStatus::stub();
        assert_eq!(status.build, "stub");
        assert!(status.message.unwrap().contains("dev:steam"));
    }

    #[test]
    fn init_script_is_json_and_does_not_break_out() {
        let status = SteamStatus::client_not_running("a <script>");
        let script = steam_init_script(&status);
        assert!(script.starts_with("window.__RS_STEAM__ = "));
        assert!(script.contains("\\u003cscript"));
        assert!(!script.contains("<script"));
        assert!(script.contains("\"ready\":false"));
    }

    #[test]
    fn ready_status_exposes_steamid_and_no_failure_banner() {
        let status = SteamStatus::ready("76561198000000001".to_string(), true);
        assert!(status.ready);
        assert_eq!(status.steam_id.as_deref(), Some("76561198000000001"));
        assert!(status.overlay_enabled);
        assert!(status.message.is_none());
    }
}
