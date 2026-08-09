//! Windows half of mpv render backend (ADR-0009), WGL -- libmpv has no D3D11/Vulkan render type, so "GPU render on Windows" means a real GL context via WGL instead of GLX.
//! Shares render-context creation and GL-single-thread dance with linux/mod.rs via gl_surface.rs's GlRenderSurface/DesktopGl; this module is WGL-specific ops only.
//! Same window shape as Linux: plain opaque child HWND, sibling of WebView2's own child HWND, Win32 z-ordering (HWND_BOTTOM) keeps it under the transparent webview.
//! No CPU fallback needed (same reason as Linux): a broken WGL context on real Windows is essentially unheard of, software GL falls back at the driver level anyway.
//! Win32 child-window positioning is already parent-client-area-relative, top-left origin -- no flip needed (unlike mac's bottom-left NSView).

use super::engine::RenderWaker;
use super::gl_surface::{create_render_context, DesktopGl, GlRenderSurface};
use super::surface::{Backend, RenderSurface};
use libmpv_sys::*;
use raw_window_handle::RawWindowHandle;
use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::{Arc, Once};
use windows::core::{PCSTR, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, HDC};
use windows::Win32::Graphics::OpenGL::{
    wglCreateContext, wglDeleteContext, wglGetProcAddress, wglMakeCurrent, ChoosePixelFormat, SetPixelFormat, SwapBuffers,
    HGLRC, PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_SUPPORT_OPENGL, PFD_TYPE_RGBA, PIXELFORMATDESCRIPTOR,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassExW, SetWindowPos, ShowWindow, CS_HREDRAW, CS_OWNDC,
    CS_VREDRAW, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, WINDOW_EX_STYLE, WNDCLASSEXW,
    WS_CHILD, WS_VISIBLE,
};

const CLASS_NAME: PCWSTR = windows::core::w!("PhotonMpvSurface");

static REGISTER_CLASS: Once = Once::new();

pub(crate) fn attach(
    mpv: *mut mpv_handle,
    handle: RawWindowHandle,
    _display_handle: raw_window_handle::RawDisplayHandle, // unused here -- only linux/wayland.rs needs it, see engine.rs's attach
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let RawWindowHandle::Win32(h) = handle else {
        return Err("expected a Win32 window handle on Windows".into());
    };
    let parent = HWND(h.hwnd.get() as *mut c_void);
    let mut platform = WglSurface::new(parent)?;
    // platform's GL context is current here (new()'s last step), required for mpv_render_context_create; released right after either way, see DesktopGl::release_current's doc.
    let result = unsafe { create_render_context(mpv, wgl_get_proc_address, waker) };
    platform.release_current();
    match result {
        Ok(render_ctx) => Ok((Box::new(GlRenderSurface::new(platform, render_ctx)) as Box<dyn RenderSurface>, Backend::Gpu)),
        Err(e) => {
            platform.destroy(); // nothing else owns this window/context now
            Err(e)
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn register_class() {
    REGISTER_CLASS.call_once(|| unsafe {
        let hinstance = GetModuleHandleW(None).unwrap_or_default();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            // CS_OWNDC: without it, GetDC returns a common DC from a small, short-lived per-thread cache
            // whose pixel-format attributes aren't guaranteed to survive recycling -- but WglSurface holds
            // its DC for its entire lifetime. Standard fix every WGL Win32 sample uses for this pattern.
            style: CS_HREDRAW | CS_VREDRAW | CS_OWNDC,
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
}

// render()/reposition_or_hide() run on the render loop's background thread and main thread respectively, never concurrently (engine.rs serializes both via one mutex) -- fields are plain Win32/WGL handles, valid from any thread once created.
unsafe impl Send for WglSurface {}

impl WglSurface {
    fn new(parent: HWND) -> Result<Self, String> {
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
                1, // resized by the first real set_rect
                Some(parent),
                None,
                Some(hinstance.into()),
                None,
            )
            .map_err(|e| format!("CreateWindowExW: {e}"))?;
            // New child windows land at the top of the parent's z-order by default (same as X11's sibling stacking) -- push it under WebView2's own child HWND instead.
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

            Ok(Self { hwnd, hdc, hglrc })
        }
    }
}

/// mpv's OPENGL_INIT_PARAMS callback. wglGetProcAddress only resolves extension entry points per MSDN
/// ("must not be used to retrieve core OpenGL 1.1 functions") -- core functions come from opengl32.dll instead.
unsafe extern "C" fn wgl_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe {
        let cname = std::ffi::CStr::from_ptr(name);
        if let Some(p) = wglGetProcAddress(PCSTR(cname.as_ptr() as *const u8)) {
            return p as *mut c_void;
        }
        // Fall back to the always-loaded opengl32.dll for core entry points
        if let Ok(opengl32) = GetModuleHandleW(windows::core::w!("opengl32.dll")) {
            if let Some(p) = GetProcAddress(opengl32, PCSTR(cname.as_ptr() as *const u8)) {
                return p as *mut c_void;
            }
        }
        std::ptr::null_mut()
    }
}

impl DesktopGl for WglSurface {
    fn make_current(&self) -> bool {
        unsafe { wglMakeCurrent(self.hdc, self.hglrc).is_ok() }
    }

    fn release_current(&self) {
        unsafe {
            let _ = wglMakeCurrent(self.hdc, HGLRC::default());
        }
    }

    fn swap_buffers(&self) {
        unsafe {
            let _ = SwapBuffers(self.hdc);
        }
    }

    fn reposition_or_hide(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        if w <= 0.0 || h <= 0.0 {
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_HIDE);
            }
            return;
        }
        // Rect arrives in the webview's CSS/logical px (mpv.ts's syncRect). Win32 child-window
        // coords are physical px and, unlike GTK's widget allocation, are never auto-scaled by
        // the platform -- without this the child window (and the video in it) ends up sized/
        // positioned at 1/scale on any HiDPI display. GetDpiForWindow's baseline is 96 (USER_DEFAULT_SCREEN_DPI).
        let scale = unsafe { GetDpiForWindow(self.hwnd) } as f64 / 96.0;
        let (xi, yi, wi, hi) = ((x * scale) as i32, (y_top_left * scale) as i32, (w * scale) as i32, (h * scale) as i32);
        unsafe {
            let _ = SetWindowPos(self.hwnd, Some(HWND_BOTTOM), xi, yi, wi, hi, SWP_SHOWWINDOW);
        }
    }

    fn destroy(&mut self) {
        unsafe {
            // Always release before delete -- a WGL context must not be current when deleted (MSDN), on the "render-context creation failed" path exactly as much as the normal teardown() route.
            let _ = wglMakeCurrent(self.hdc, HGLRC::default());
            let _ = wglDeleteContext(self.hglrc);
            ReleaseDC(Some(self.hwnd), self.hdc);
            let _ = DestroyWindow(self.hwnd);
        }
    }
}
