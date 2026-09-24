//! Steamworks V1 inside the Tauri shell.
//!
//! Default builds (no `steam` feature) stay linkable in CI without the Steam
//! SDK and report that honestly. `--features steam` links `steamworks` and
//! calls `SteamAPI_Init` / `SteamAPI_Shutdown`, reads the SteamID, mints a
//! Web API session ticket, and can open the Steam overlay.
//!
//! The overlay is invoked through the Steam client. This shell does not mount
//! a click shield over `/play` cards or forced windows.

use std::sync::{Arc, Mutex};

use tauri::State;

#[cfg(feature = "steam")]
use crate::steam_config::{load_app_id, OVERLAY_DISABLED_MESSAGE};
use crate::steam_config::{SteamStatus, OVERLAY_UNAVAILABLE_MESSAGE};

pub struct SteamHost {
    inner: Arc<Mutex<SteamInner>>,
}

impl Clone for SteamHost {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

enum SteamInner {
    Idle(SteamStatus),
    #[cfg(feature = "steam")]
    Live(LiveSteam),
}

#[cfg(feature = "steam")]
struct LiveSteam {
    client: steamworks::Client,
    stop: Arc<std::sync::atomic::AtomicBool>,
    pump: Option<std::thread::JoinHandle<()>>,
    tickets: Vec<steamworks::AuthTicket>,
    status: SteamStatus,
}

impl SteamHost {
    pub fn boot() -> Self {
        #[cfg(feature = "steam")]
        {
            Self::boot_live()
        }
        #[cfg(not(feature = "steam"))]
        {
            Self::from_status(SteamStatus::stub())
        }
    }

    fn from_status(status: SteamStatus) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SteamInner::Idle(status))),
        }
    }

    pub fn status(&self) -> SteamStatus {
        let guard = self.inner.lock().expect("steam host lock");
        match &*guard {
            SteamInner::Idle(status) => status.clone(),
            #[cfg(feature = "steam")]
            SteamInner::Live(live) => live.status.clone(),
        }
    }

    pub fn issue_session_ticket(&self) -> Result<String, String> {
        #[cfg(not(feature = "steam"))]
        {
            let guard = self.inner.lock().expect("steam host lock");
            let SteamInner::Idle(status) = &*guard;
            return Err(status
                .message
                .clone()
                .unwrap_or_else(|| OVERLAY_UNAVAILABLE_MESSAGE.to_string()));
        }
        #[cfg(feature = "steam")]
        {
            let client = {
                let guard = self.inner.lock().expect("steam host lock");
                match &*guard {
                    SteamInner::Live(live) if live.status.ready => live.client.clone(),
                    SteamInner::Live(live) => {
                        return Err(live
                            .status
                            .message
                            .clone()
                            .unwrap_or_else(|| OVERLAY_UNAVAILABLE_MESSAGE.to_string()));
                    }
                    SteamInner::Idle(status) => {
                        return Err(status
                            .message
                            .clone()
                            .unwrap_or_else(|| OVERLAY_UNAVAILABLE_MESSAGE.to_string()));
                    }
                }
            };
            let (handle, hex) = request_webapi_ticket(&client)?;
            let mut guard = self.inner.lock().expect("steam host lock");
            if let SteamInner::Live(live) = &mut *guard {
                live.tickets.push(handle);
            } else {
                client.user().cancel_authentication_ticket(handle);
            }
            Ok(hex)
        }
    }

    pub fn activate_overlay(&self) -> Result<(), String> {
        let guard = self.inner.lock().expect("steam host lock");
        match &*guard {
            SteamInner::Idle(status) => Err(status
                .message
                .clone()
                .unwrap_or_else(|| OVERLAY_UNAVAILABLE_MESSAGE.to_string())),
            #[cfg(feature = "steam")]
            SteamInner::Live(live) => live.activate_overlay(),
        }
    }

    /// Drop the Steam client. `steamworks` shuts the API down on the last drop.
    pub fn shutdown(&self) {
        let mut guard = self.inner.lock().expect("steam host lock");
        #[cfg(feature = "steam")]
        {
            if let SteamInner::Live(live) = &mut *guard {
                live.shutdown();
            }
        }
        let status = match &*guard {
            SteamInner::Idle(status) => status.clone(),
            #[cfg(feature = "steam")]
            SteamInner::Live(live) => live.status.clone(),
        };
        *guard = SteamInner::Idle(status);
    }

    #[cfg(feature = "steam")]
    fn boot_live() -> Self {
        let app_id = match load_app_id() {
            Ok(id) => id,
            Err(message) => return Self::from_status(failure_status(&message)),
        };
        match steamworks::Client::init_app(app_id) {
            Ok(client) => Self::from_live(client),
            Err(err) => Self::from_status(SteamStatus::client_not_running(&err.to_string())),
        }
    }

    #[cfg(feature = "steam")]
    fn from_live(client: steamworks::Client) -> Self {
        let steam_id = client.user().steam_id().raw().to_string();
        let overlay_enabled = client.utils().is_overlay_enabled();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let pump_client = client.clone();
        let pump_stop = Arc::clone(&stop);
        let pump = std::thread::Builder::new()
            .name("steam-callbacks".to_string())
            .spawn(move || {
                while !pump_stop.load(std::sync::atomic::Ordering::Relaxed) {
                    pump_client.run_callbacks();
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            })
            .ok();
        Self {
            inner: Arc::new(Mutex::new(SteamInner::Live(LiveSteam {
                client,
                stop,
                pump,
                tickets: Vec::new(),
                status: SteamStatus::ready(steam_id, overlay_enabled),
            }))),
        }
    }
}

#[cfg(feature = "steam")]
fn failure_status(message: &str) -> SteamStatus {
    if message.contains("未配置 Steam AppID") {
        SteamStatus::missing_app_id()
    } else {
        SteamStatus::client_not_running(message)
    }
}

#[cfg(feature = "steam")]
fn request_webapi_ticket(
    client: &steamworks::Client,
) -> Result<(steamworks::AuthTicket, String), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let callback = client.register_callback(move |event: steamworks::TicketForWebApiResponse| {
        let _ = tx.send(event);
    });
    let handle = client
        .user()
        .authentication_session_ticket_for_webapi("requirement-storm");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut matched = None;
    while std::time::Instant::now() < deadline {
        let wait = deadline.saturating_duration_since(std::time::Instant::now());
        match rx.recv_timeout(wait.min(std::time::Duration::from_millis(200))) {
            Ok(event) if event.ticket_handle == handle => {
                matched = Some(event);
                break;
            }
            Ok(_) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(callback);
    let Some(event) = matched else {
        client.user().cancel_authentication_ticket(handle);
        return Err(
            "Steam 会话票据超时。请确认 Steam 客户端已登录后重试。人机对局不需要票据。".to_string(),
        );
    };
    if event.result.is_err() {
        client.user().cancel_authentication_ticket(handle);
        return Err(
            SteamStatus::client_not_running("GetAuthTicketForWebApi failed")
                .message
                .unwrap_or_else(|| "Steam 会话票据失败".to_string()),
        );
    }
    let len = usize::try_from(event.ticket_len).unwrap_or(0);
    let bytes = event.ticket.get(..len).unwrap_or(&[]);
    if bytes.is_empty() {
        client.user().cancel_authentication_ticket(handle);
        return Err("Steam 没有返回会话票据。请确认 Steam 客户端已登录。".to_string());
    }
    Ok((handle, to_hex(bytes)))
}

#[cfg(feature = "steam")]
impl LiveSteam {
    fn activate_overlay(&self) -> Result<(), String> {
        if !self.status.ready {
            return Err(self
                .status
                .message
                .clone()
                .unwrap_or_else(|| OVERLAY_UNAVAILABLE_MESSAGE.to_string()));
        }
        if !self.client.utils().is_overlay_enabled() {
            return Err(OVERLAY_DISABLED_MESSAGE.to_string());
        }
        // Friends is the Shift+Tab landing page. This is not a room invite.
        self.client.friends().activate_game_overlay("Friends");
        Ok(())
    }

    fn shutdown(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(pump) = self.pump.take() {
            let _ = pump.join();
        }
        for ticket in self.tickets.drain(..) {
            self.client.user().cancel_authentication_ticket(ticket);
        }
    }
}

#[cfg(feature = "steam")]
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[tauri::command]
pub fn steam_status(host: State<'_, SteamHost>) -> SteamStatusDto {
    SteamStatusDto::from(host.status())
}

#[tauri::command]
pub async fn steam_session_ticket(host: State<'_, SteamHost>) -> Result<String, String> {
    let host = SteamHost::clone(&host);
    tauri::async_runtime::spawn_blocking(move || host.issue_session_ticket())
        .await
        .map_err(|_| "Steam 会话票据请求失败".to_string())?
}

#[tauri::command]
pub fn steam_activate_overlay(host: State<'_, SteamHost>) -> Result<(), String> {
    host.activate_overlay()
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamStatusDto {
    pub build: String,
    pub ready: bool,
    pub steam_id: Option<String>,
    pub overlay_enabled: bool,
    pub message: Option<String>,
}

impl From<SteamStatus> for SteamStatusDto {
    fn from(status: SteamStatus) -> Self {
        Self {
            build: status.build.to_string(),
            ready: status.ready,
            steam_id: status.steam_id,
            overlay_enabled: status.overlay_enabled,
            message: status.message,
        }
    }
}
