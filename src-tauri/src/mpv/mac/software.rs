//! mpv's *software* render API (`MPV_RENDER_API_TYPE_SW`) into a plain
//! buffer, handed to a `CALayer` (via `layer.contents`) on a layer-backed
//! `NSView` inserted below the window's (transparent) WKWebView -- see
//! ADR-0005/0009 and `super::RenderSurface`. The permanent fallback when
//! `GpuSurface` (checkpoint 3, ADR-0009) can't set up on a given machine, and
//! today's only backend until then.
//!
//! ponytail: NOT the OpenGL render API, on purpose -- see ADR-0009 for why a
//! plain `NSOpenGLView` doesn't work here (transparency/layer-backing), and
//! why the real GPU path (`GpuSurface`) instead goes through an off-screen
//! FBO + IOSurface + `CAMetalLayer`. Slower than GPU rendering (mpv's own
//! docs: "very slow, because everything ... runs on the CPU") and allocates
//! a fresh frame buffer every render -- correct-first; a buffer pool is real
//! upgrade work, not done here.

use super::RenderSurface;
use crate::mpv::engine::{on_render_update, RenderWaker};
use core_graphics::color_space::CGColorSpace;
use core_graphics::data_provider::CGDataProvider;
use core_graphics::image::{CGImage, CGImageAlphaInfo};
use foreign_types::ForeignType;
use libmpv_sys::*;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::CATransaction;
use std::ffi::{c_void, CString};
use std::os::raw::c_char;
use std::sync::Arc;

const MPV_RENDER_PARAM_SW_SIZE: mpv_render_param_type = 17;
const MPV_RENDER_PARAM_SW_FORMAT: mpv_render_param_type = 18;
const MPV_RENDER_PARAM_SW_STRIDE: mpv_render_param_type = 19;
const MPV_RENDER_PARAM_SW_POINTER: mpv_render_param_type = 20;
const MPV_RENDER_API_TYPE_SW: &[u8] = b"sw\0";

pub(crate) struct SoftwareSurface {
    render_ctx: *mut mpv_render_context,
    view: Retained<NSView>,
    // created once -- CGColorSpace is the same for every frame, no reason to
    // recreate it 5x/sec
    colorspace: CGColorSpace,
}

// `view` (an AppKit object) and `render_ctx`/mpv FFI calls aren't
// automatically Send -- `render()` is called from the render loop's own
// background thread (see the module doc + `RenderSurface`'s doc), which
// only ever touches read-only AppKit getters (`bounds`, `isHidden`,
// `layer`); every AppKit *mutation* (`setFrame`, `setHidden`) happens from
// `set_rect` on the main thread (a Tauri command) instead.
unsafe impl Send for SoftwareSurface {}

impl SoftwareSurface {
    pub(crate) fn new(
        mpv: *mut mpv_handle,
        content_view: &NSView,
        waker: &Arc<RenderWaker>,
    ) -> Result<Self, String> {
        // ponytail: `MainThreadMarker::new_unchecked` -- `attach()`'s whole
        // call chain (from the `mpv_attach` Tauri command down) has never
        // checked thread affinity, on cocoa/objc 0.2.x or here; preserving
        // that rather than introducing a new runtime check as a drive-by
        // part of this migration.
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let zero_frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
        let view = NSView::initWithFrame(NSView::alloc(mtm), zero_frame);
        view.setWantsLayer(true);
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewNotSizable); // positioned explicitly on every rect update
        view.setHidden(true); // hidden until the frontend reports a real rect
        content_view.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);

        let api_type_ptr = MPV_RENDER_API_TYPE_SW.as_ptr() as *const c_char;
        let mut params = [
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                data: api_type_ptr as *mut c_void,
            },
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        let mut render_ctx: *mut mpv_render_context = std::ptr::null_mut();
        unsafe {
            let rc = mpv_render_context_create(&mut render_ctx, mpv, params.as_mut_ptr());
            if rc < 0 {
                let msg = std::ffi::CStr::from_ptr(mpv_error_string(rc)).to_string_lossy();
                return Err(format!("mpv_render_context_create (sw): {msg} ({rc})"));
            }
            mpv_render_context_set_update_callback(render_ctx, Some(on_render_update), Arc::as_ptr(waker) as *mut c_void);
        }

        Ok(Self { render_ctx, view, colorspace: CGColorSpace::create_device_rgb() })
    }
}

impl RenderSurface for SoftwareSurface {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        if w <= 0.0 || h <= 0.0 {
            self.view.setHidden(true);
            return;
        }
        // # Safety: not retained internally per objc2-app-kit's own doc, but
        // this view is always still attached (only detached in `teardown`,
        // which also stops any further `set_rect` calls -- see the struct's
        // Drop-ordering contract on `MpvEngine`).
        let superview = unsafe { self.view.superview() }.expect("render surface view detached");
        let parent_bounds = superview.bounds();
        // AppKit's NSView origin is bottom-left; the frontend reports
        // top-left (CSS) coordinates.
        let y = parent_bounds.size.height - y_top_left - h;
self.view.setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(w, h)));
        self.view.setHidden(false);
        self.render();
    }

    /// Renders one frame into an in-memory buffer and hands it to the
    /// view's layer as a `CGImage`. Called from the render loop's own
    /// background thread each time mpv wakes `RenderWaker`, and once
    /// synchronously at the end of `set_rect`.
    fn render(&self) {
        if self.render_ctx.is_null() {
            return; // torn down (MpvEngine dropped) -- see `teardown`
        }
        if self.view.isHidden() {
            return;
        }
        // ponytail: rendering at *point* resolution, not the 2x/HiDPI
        // backing-store resolution `convertRectToBacking:` would give us.
        // Quarters the per-frame buffer/CGImage cost on Retina displays,
        // which is what actually made 30fps possible instead of
        // beachballing (see `spawn_render_loop`'s doc) -- most streamed
        // video isn't native 4K anyway, so this is rarely a visible loss.
        // CALayer's default contentsScale (1.0) matches a point-sized
        // image correctly; no extra config needed.
        let bounds = self.view.bounds();
        let (w, h) = (bounds.size.width as i32, bounds.size.height as i32);
        if w <= 0 || h <= 0 {
            return;
        }

        let stride: usize = (w as usize) * 4;
        let mut frame = vec![0u8; stride * (h as usize)];

        let mut size = [w, h];
        let format = CString::new("rgb0").unwrap(); // opaque RGB + padding byte, no real alpha needed
        let mut stride_val: usize = stride;
        let mut params = [
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_SIZE, data: size.as_mut_ptr() as *mut c_void },
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_FORMAT, data: format.as_ptr() as *mut c_void },
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_STRIDE, data: &mut stride_val as *mut _ as *mut c_void },
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_POINTER, data: frame.as_mut_ptr() as *mut c_void },
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        let rc = unsafe { mpv_render_context_render(self.render_ctx, params.as_mut_ptr()) };
        if rc < 0 {
            return; // no frame ready yet or a transient error -- try again next tick
        }

        let provider = CGDataProvider::from_buffer(Arc::new(frame));
        let image = CGImage::new(
            w as usize,
            h as usize,
            8,
            32,
            stride,
            &self.colorspace,
            CGImageAlphaInfo::CGImageAlphaNoneSkipLast as u32,
            &provider,
            false,
            0, // kCGRenderingIntentDefault
        );
        let Some(layer) = self.view.layer() else { return };
        // # Safety: CGImageRef is a toll-free-bridged CF type -- CALayer's
        // `contents` property accepts it directly (Apple's own documented
        // behavior for that property, not something this cast invents).
        unsafe {
            layer.setContents(Some(&*(image.as_ptr() as *const AnyObject)));
        }
        // Core Animation normally flushes implicit transactions on the next
        // run-loop pass of whichever thread touched the layer -- this
        // render loop runs on a plain std::thread with no run loop at all,
        // so without an explicit flush the contents change just sits
        // pending forever (screen shows the punched-through hole to
        // nothing: solid black) even though mpv genuinely produced a real
        // frame. Forces it to the window server immediately.
        CATransaction::flush();
    }

    /// Frees the render context and removes the view. Called from
    /// `MpvEngine::drop` while holding the surface's own mutex -- see
    /// `RenderSurface`'s doc for why this must happen here (not via `Drop`)
    /// and why nulling `render_ctx` afterward matters.
    fn teardown(&mut self) {
        unsafe {
            // Unregister before freeing the context -- otherwise a callback
            // could fire (mpv's own thread) referencing a `RenderWaker`
            // that `MpvEngine`'s `Drop` is about to free once this returns.
            mpv_render_context_set_update_callback(self.render_ctx, None, std::ptr::null_mut());
            mpv_render_context_free(self.render_ctx);
        }
        self.view.removeFromSuperview();
        self.render_ctx = std::ptr::null_mut();
    }
}
