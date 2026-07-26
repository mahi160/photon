//! Windows half of the mpv render backend (ADR-0009's `RenderSurface` seam,
//! `mpv/surface.rs`). WGL (desktop OpenGL) -- libmpv's public render API
//! only ever exposes `MPV_RENDER_API_TYPE_OPENGL` (no D3D11/Vulkan render
//! API type exists in libmpv itself, on any platform, see ADR-0009's own
//! note) -- so "GPU render on Windows" means the same thing it means on
//! Linux: a real GL context, just via WGL instead of GLX.
//!
//! Same shape as `mpv/linux/mod.rs`'s GLX backend: creates a plain opaque
//! **child** HWND, sized/positioned to the placeholder rect, as a sibling of
//! the WebView2 control's own child HWND -- ordinary Win32 z-ordering (see
//! `SetWindowPos`'s `HWND_BOTTOM` in `new`/`set_rect`) keeps it under the
//! (transparent, `tauri.conf.json`'s `transparent: true`) webview instead of
//! needing IOSurface/Metal-style layer compositing (mac) or a compositing
//! manager (X11). No CPU fallback for the same reason Linux has none: a
//! missing/broken WGL context on any real Windows desktop is essentially
//! unheard of (unlike mac's specific `NSOpenGLView` transparency bug), and
//! software GL (if it ever came to that) already falls back at the driver
//! level.
//!
//! Coordinates: Win32 child-window positioning (`SetWindowPos`/`MoveWindow`)
//! is already parent-client-area-relative, top-left origin -- same
//! convention `set_rect` receives, no flip needed (same as X11, unlike
//! mac's bottom-left `NSView`).

use super::engine::{on_render_update, RenderWaker};
use super::surface::{Backend, RenderSurface};
use libmpv_sys::*;
use raw_window_handle::RawWindowHandle;
use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::{Arc, Mutex, Once};
use windows::core::{PCSTR, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, HDC};
use windows::Win32::Graphics::OpenGL::{
    wglCreateContext, wglDeleteContext, wglGetProcAddress, wglMakeCurrent, ChoosePixelFormat, SetPixelFormat, SwapBuffers,
    HGLRC, PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_SUPPORT_OPENGL, PFD_TYPE_RGBA, PIXELFORMATDESCRIPTOR,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassExW, SetWindowPos, CS_HREDRAW, CS_VREDRAW, HWND_BOTTOM,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WINDOW_EX_STYLE, WNDCLASSEXW, WS_CHILD, WS_VISIBLE,
};

const MPV_RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";
const CLASS_NAME: PCWSTR = windows::core::w!("PhotonMpvSurface");

static REGISTER_CLASS: Once = Once::new();

pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let RawWindowHandle::Win32(h) = handle else {
        return Err("expected a Win32 window handle on Windows".into());
    };
    let parent = HWND(h.hwnd.get() as *mut c_void);
    WglSurface::new(mpv, parent, waker).map(|s| (Box::new(s) as Box<dyn RenderSurface>, Backend::Gpu))
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn register_class() {
    REGISTER_CLASS.call_once(|| unsafe {
        let hinstance = GetModuleHandleW(None).unwrap_or_default();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: hinstance.into(),
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        RegisterClassExW(&class);
    });
}

struct WglSurface {
    hwnd: HWND,
    hdc: HDC,
    hglrc: HGLRC,
    render_ctx: *mut mpv_render_context,
    // interior mutability only -- `render`/`set_rect` take `&self` (the
    // `RenderSurface` trait's shape) but are never called concurrently, see
    // `mpv/linux/mod.rs`'s identical `size` field doc.
    size: Mutex<(i32, i32)>,
}

// `render()` runs on the render loop's own background thread, `set_rect()`
// on the main thread (a Tauri command) -- never concurrently (`engine.rs`
// serializes both through the one `Arc<Mutex<Box<dyn RenderSurface>>>` it
// holds this behind), and every field here is a plain Win32/WGL handle,
// valid from any thread once created.
unsafe impl Send for WglSurface {}

impl WglSurface {
    fn new(mpv: *mut mpv_handle, parent: HWND, waker: &Arc<RenderWaker>) -> Result<Self, String> {
        register_class();
        unsafe {
            let hinstance = GetModuleHandleW(None).map_err(|e| format!("GetModuleHandleW: {e}"))?;
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                CLASS_NAME,
                windows::core::w!(""),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                1,
                1, // resized by the first real `set_rect`
                Some(parent),
                None,
                Some(hinstance.into()),
                None,
            )
            .map_err(|e| format!("CreateWindowExW: {e}"))?;
            // New child windows land at the *top* of the parent's z-order by
            // default (same default as X11's sibling stacking, see
            // `mpv/linux/mod.rs`'s identical note) -- push it under the
            // WebView2 control's own child HWND instead.
            let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

            let hdc = GetDC(Some(hwnd));
            if hdc.is_invalid() {
                let _ = DestroyWindow(hwnd);
                return Err("GetDC returned null".into());
            }

            let pfd = PIXELFORMATDESCRIPTOR {
                nSize: std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16,
                nVersion: 1,
                dwFlags: PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER,
                iPixelType: PFD_TYPE_RGBA,
                cColorBits: 32,
                cDepthBits: 0, // 2D video only -- no depth buffer needed
                iLayerType: 0,
                ..Default::default()
            };
            let format = ChoosePixelFormat(hdc, &pfd);
            if format == 0 || SetPixelFormat(hdc, format, &pfd).is_err() {
                ReleaseDC(Some(hwnd), hdc);
                let _ = DestroyWindow(hwnd);
                return Err("ChoosePixelFormat/SetPixelFormat failed (no suitable WGL pixel format)".into());
            }

            let hglrc = wglCreateContext(hdc).map_err(|e| format!("wglCreateContext: {e}"))?;
            if wglMakeCurrent(hdc, hglrc).is_err() {
                let _ = wglDeleteContext(hglrc);
                ReleaseDC(Some(hwnd), hdc);
                let _ = DestroyWindow(hwnd);
                return Err("wglMakeCurrent failed".into());
            }

            let api_type_ptr = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *const c_char;
            let mut init_params = mpv_opengl_init_params {
                get_proc_address: Some(wgl_get_proc_address),
                get_proc_address_ctx: std::ptr::null_mut(),
                extra_exts: std::ptr::null(),
            };
            let mut params = [
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE, data: api_type_ptr as *mut c_void },
                mpv_render_param {
                    type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    data: &mut init_params as *mut _ as *mut c_void,
                },
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
            ];
            let mut render_ctx: *mut mpv_render_context = std::ptr::null_mut();
            let rc = mpv_render_context_create(&mut render_ctx, mpv, params.as_mut_ptr());
            if rc < 0 {
                let msg = std::ffi::CStr::from_ptr(mpv_error_string(rc)).to_string_lossy().into_owned();
                let _ = wglDeleteContext(hglrc);
                ReleaseDC(Some(hwnd), hdc);
                let _ = DestroyWindow(hwnd);
                return Err(format!("mpv_render_context_create (opengl): {msg} ({rc})"));
            }
            mpv_render_context_set_update_callback(render_ctx, Some(on_render_update), Arc::as_ptr(waker) as *mut c_void);
            // Released immediately -- see `render()`'s doc on why a WGL
            // context can't be left current on this (creation) thread if
            // the first real `render()` call ends up on a different one.
            let _ = wglMakeCurrent(hdc, HGLRC::default());

            Ok(Self { hwnd, hdc, hglrc, render_ctx, size: Mutex::new((0, 0)) })
        }
    }
}

/// mpv's `MPV_RENDER_PARAM_OPENGL_INIT_PARAMS` callback. `wglGetProcAddress`
/// only resolves *extension* entry points per its own documented contract
/// (MSDN: "must not be used to retrieve... core OpenGL 1.1 functions") --
/// core functions instead come straight from `opengl32.dll` (always loaded
/// once a WGL context exists), resolved via `GetProcAddress` against that
/// module instead.
unsafe extern "C" fn wgl_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe {
        let cname = std::ffi::CStr::from_ptr(name);
        if let Some(p) = wglGetProcAddress(PCSTR(cname.as_ptr() as *const u8)) {
            return p as *mut c_void;
        }
        // Fall back to the always-loaded opengl32.dll for core entry points.
        if let Ok(opengl32) = windows::Win32::System::LibraryLoader::GetModuleHandleW(windows::core::w!("opengl32.dll")) {
            if let Some(p) = windows::Win32::System::LibraryLoader::GetProcAddress(opengl32, PCSTR(cname.as_ptr() as *const u8)) {
                return p as *mut c_void;
            }
        }
        std::ptr::null_mut()
    }
}

impl RenderSurface for WglSurface {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        if w <= 0.0 || h <= 0.0 {
            unsafe {
                let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                    self.hwnd,
                    windows::Win32::UI::WindowsAndMessaging::SW_HIDE,
                );
            }
            *self.size.lock().unwrap() = (0, 0);
            return;
        }
        let (xi, yi, wi, hi) = (x as i32, y_top_left as i32, w as i32, h as i32);
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                Some(HWND_BOTTOM),
                xi,
                yi,
                wi,
                hi,
                windows::Win32::UI::WindowsAndMessaging::SWP_SHOWWINDOW,
            );
        }
        *self.size.lock().unwrap() = (wi, hi);
        self.render();
    }

    fn render(&self) {
        if self.render_ctx.is_null() {
            return; // torn down -- see `teardown`
        }
        let (w, h) = *self.size.lock().unwrap();
        if w <= 0 || h <= 0 {
            return;
        }
        unsafe {
            // A WGL context can only ever be current on *one* thread at a
            // time (MSDN: "a rendering context can be current for only one
            // thread at a time") -- `render()` here is called from both the
            // main thread (via `set_rect`, synchronously) and the render
            // loop's own background thread (`spawn_render_loop`,
            // commands.rs), never concurrently (both serialized through
            // `engine.rs`'s own `Arc<Mutex<Box<dyn RenderSurface>>>`) but at
            // *different* times from *different* threads. Without releasing
            // it here, the next `wglMakeCurrent` from the other thread
            // fails outright (still marked current on the previous thread)
            // and every WGL/GL call after that silently operates with no
            // current context -- reliably a hard crash on Windows, and (per
            // the same root cause, GLX has the identical one-thread-at-a-time
            // rule) the likely explanation for the analogous black-video
            // symptom seen on Linux.
            if wglMakeCurrent(self.hdc, self.hglrc).is_err() {
                return; // couldn't acquire the context this tick -- try again next
            }
            let mut fbo_param = mpv_opengl_fbo { fbo: 0, w, h, internal_format: 0 };
            // mpv's own render.h doc for MPV_RENDER_PARAM_FLIP_Y: needed
            // "e.g. when rendering to an OpenGL default framebuffer (which
            // has a flipped coordinate system)" -- exactly this fbo=0 case
            // (unlike mac's `gpu.rs`, which renders into its own off-screen
            // FBO/IOSurface, not the window's default one). Without this the
            // picture decodes and displays fine but upside-down.
            let mut flip_y: i32 = 1;
            let mut params = [
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo_param as *mut _ as *mut c_void },
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y, data: &mut flip_y as *mut _ as *mut c_void },
                mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
            ];
            let rc = mpv_render_context_render(self.render_ctx, params.as_mut_ptr());
            if rc >= 0 {
                let _ = SwapBuffers(self.hdc);
            }
            // release -- see the comment above; must happen even on the
            // `rc < 0` ("no frame ready") path, not just the success path.
            let _ = wglMakeCurrent(self.hdc, HGLRC::default());
        }
    }

    fn teardown(&mut self) {
        unsafe {
            mpv_render_context_set_update_callback(self.render_ctx, None, std::ptr::null_mut());
            mpv_render_context_free(self.render_ctx);
            let _ = wglMakeCurrent(self.hdc, HGLRC::default());
            let _ = wglDeleteContext(self.hglrc);
            ReleaseDC(Some(self.hwnd), self.hdc);
            let _ = DestroyWindow(self.hwnd);
        }
        self.render_ctx = std::ptr::null_mut();
    }
}
