pub mod commands;
pub mod engine;
pub(crate) mod profile;
pub(crate) mod surface;

// `backend` aliases whichever platform module is compiled in -- `engine.rs`
// only ever calls `backend::attach`, never `mac`/`windows`/`linux` directly
// (ADR-0009's `RenderSurface` seam, shared bits in `surface.rs`). Only `mac`
// has a real GPU/CPU render surface today; `windows`/`linux` are stubs that
// compile and link but always return a "not implemented" error from
// `attach()` -- see their own module docs.
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
