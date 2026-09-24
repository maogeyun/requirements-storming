mod steam_config;
mod steam_host;

use tauri::Manager;

use steam_config::{steam_init_script, SteamStatus};
use steam_host::{steam_activate_overlay, steam_session_ticket, steam_status, SteamHost};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let host = SteamHost::boot();
    tauri::Builder::default()
        .manage(host)
        .invoke_handler(tauri::generate_handler![
            steam_status,
            steam_session_ticket,
            steam_activate_overlay
        ])
        .setup(|app| {
            open_main_window(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running the Requirement Storm desktop shell")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<SteamHost>().shutdown();
            }
        });
}

fn open_main_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or_else(|| std::io::Error::other("tauri.conf.json is missing the main window"))?;

    let mut builder = tauri::WebviewWindowBuilder::from_config(app, &window_config)?;
    let steam = app.state::<SteamHost>().status();
    builder = builder.initialization_script(page_init_script(&steam));
    builder.build()?;
    Ok(())
}

fn page_init_script(status: &SteamStatus) -> String {
    let steam = steam_init_script(status);
    match ws_url_init_script() {
        Some(ws) => format!("{steam}\n{ws}"),
        None => steam,
    }
}

/// `WS_URL` overrides the gateway inside the webview.
/// Unset or blank keeps `NEXT_PUBLIC_WS_URL`, which defaults to `ws://localhost:8787`.
fn ws_url_init_script() -> Option<String> {
    let raw = std::env::var("WS_URL").ok()?;
    let url = raw.trim();
    if url.is_empty() {
        return None;
    }
    script_for_ws_url(url)
}

fn script_for_ws_url(url: &str) -> Option<String> {
    if !(url.starts_with("ws://") || url.starts_with("wss://")) {
        eprintln!("WS_URL must start with ws:// or wss://");
        return None;
    }
    if url.chars().any(|c| c.is_whitespace()) {
        eprintln!("WS_URL must not contain whitespace");
        return None;
    }
    let literal = serde_json::to_string(url).ok()?;
    Some(format!("window.__RS_WS_URL = {literal};"))
}

#[cfg(test)]
mod tests {
    use super::script_for_ws_url;

    #[test]
    fn accepts_ws_and_wss() {
        assert_eq!(
            script_for_ws_url("ws://localhost:8787").as_deref(),
            Some("window.__RS_WS_URL = \"ws://localhost:8787\";")
        );
        assert_eq!(
            script_for_ws_url("wss://gateway.example/match").as_deref(),
            Some("window.__RS_WS_URL = \"wss://gateway.example/match\";")
        );
    }

    #[test]
    fn rejects_non_websocket_urls() {
        assert!(script_for_ws_url("http://localhost:8787").is_none());
        assert!(script_for_ws_url("https://gateway.example").is_none());
        assert!(script_for_ws_url("javascript:alert(1)").is_none());
        assert!(script_for_ws_url("ws://localhost:8787\n").is_none());
    }
}
