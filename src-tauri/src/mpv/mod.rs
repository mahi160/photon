pub mod commands;
pub mod engine;
pub(crate) mod profile;
pub(crate) mod surface;

// Shared GL-onto-plain-window backend for `windows` (WGL) -- see its own doc. `mac` renders into its
// own off-screen FBO; `linux` (ADR-0010) renders into a GtkGLArea, neither uses this.
// Also compiled under `test` on every platform: everything platform-specific in it sits behind the
// `DesktopGl` trait, so its unit tests are the only Windows-surface coverage that runs outside a
// Windows box (CI never runs tests on the Windows runner).
#[cfg(any(target_os = "windows", test))]
pub(crate) mod gl_surface;

// `backend` aliases the compiled-in platform module -- engine.rs only calls `backend::attach` (ADR-0009's RenderSurface seam). mac: OpenGL->IOSurface->Metal with CPU fallback (mac/software.rs); windows/linux: WGL/GLX onto a plain child window, no fallback.
#[cfg(target_os = "macos")]
pub(crate) mod mac;
#[cfg(target_os = "macos")]
pub(crate) use mac as backend;

#[cfg(target_os = "windows")]
pub(crate) mod windows;
#[cfg(target_os = "windows")]
pub(crate) use windows as backend;

#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "linux")]
pub(crate) use linux as backend;
