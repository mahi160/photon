//! Keeping the screen awake during playback.
//!
//! The renderer's `useWakeLock` hook uses the Screen Wake Lock API, which covers WKWebView (macOS) and
//! WebView2 (Windows) -- but **not** WebKitGTK: `'wakeLock' in navigator` is false there (verified on
//! WebKitGTK 2.52.3), so the hook silently no-op'd and Linux screens blanked/locked mid-film. mpv can't
//! cover for it either: with `vo=libmpv` there is no mpv window, so `stop-screensaver` has nothing to
//! inhibit.
//!
//! So on Linux we hold `org.freedesktop.ScreenSaver.Inhibit` for as long as playback runs (implemented
//! by GNOME, KDE, Xfce, Cinnamon, MATE...). Everything else is a no-op command the frontend can call
//! unconditionally.

#[cfg(target_os = "linux")]
mod imp {
    use gio::prelude::*;
    use glib::variant::Variant;
    use std::sync::Mutex;

    const NAME: &str = "org.freedesktop.ScreenSaver";
    const PATH: &str = "/org/freedesktop/ScreenSaver";
    const TIMEOUT_MS: i32 = 1000;

    /// The live inhibit cookie, if any. GDBus (already linked via GTK -- no libdbus build dependency,
    /// unlike the `dbus` crate) rather than a second D-Bus client stack.
    #[derive(Default)]
    pub struct IdleState(Mutex<Option<u32>>);

    impl IdleState {
        pub fn set(&self, active: bool, reason: &str) -> Result<(), String> {
            let mut slot = self.0.lock().unwrap();
            if active == slot.is_some() {
                return Ok(()); // already in the requested state
            }
            match slot.take() {
                Some(cookie) => {
                    call("UnInhibit", &(cookie,).to_variant())?;
                    Ok(())
                }
                None => {
                    let reply = call("Inhibit", &("Photon", reason).to_variant())?;
                    let (cookie,): (u32,) =
                        reply.get().ok_or_else(|| format!("ScreenSaver.Inhibit returned {reply:?}, expected (u)"))?;
                    *slot = Some(cookie);
                    Ok(())
                }
            }
        }
    }

    fn call(method: &str, args: &Variant) -> Result<Variant, String> {
        // The session bus connection is process-wide and outlives the call, so the cookie stays valid
        // until we explicitly UnInhibit it.
        let conn = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
            .map_err(|e| format!("session bus: {e}"))?;
        conn.call_sync(
            Some(NAME),
            PATH,
            NAME,
            method,
            Some(args),
            None,
            gio::DBusCallFlags::NONE,
            TIMEOUT_MS,
            gio::Cancellable::NONE,
        )
        .map_err(|e| format!("ScreenSaver.{method}: {e}"))
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    /// macOS/Windows get this from the renderer's Screen Wake Lock API; nothing to hold here.
    #[derive(Default)]
    pub struct IdleState;

    impl IdleState {
        pub fn set(&self, _active: bool, _reason: &str) -> Result<(), String> {
            Ok(())
        }
    }
}

pub use imp::IdleState;

/// Called from the player whenever playback starts/stops. Failure is reported (so a missing/refusing
/// screensaver service shows up in the console) but never blocks playback -- the caller logs and moves on.
#[tauri::command]
pub fn app_set_idle_inhibited(state: tauri::State<'_, IdleState>, inhibited: bool) -> Result<(), String> {
    state.set(inhibited, "Playing video")
}
