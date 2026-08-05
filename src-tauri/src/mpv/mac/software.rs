//! mpv's software render API into a plain buffer, handed to a CALayer on a layer-backed NSView below the window's transparent WKWebView (ADR-0005/0009) -- permanent fallback when GpuSurface can't set up.
//! ponytail: not OpenGL on purpose, plain NSOpenGLView doesn't work here (transparency/layer-backing) -- slower (CPU-bound, mpv docs call it "very slow"), buffers pooled since CoreGraphics's release callback decides when one's free.

use super::super::surface::skip_frame;
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
use std::sync::{Arc, Mutex};

const MPV_RENDER_PARAM_SW_SIZE: mpv_render_param_type = 17;
const MPV_RENDER_PARAM_SW_FORMAT: mpv_render_param_type = 18;
const MPV_RENDER_PARAM_SW_STRIDE: mpv_render_param_type = 19;
const MPV_RENDER_PARAM_SW_POINTER: mpv_render_param_type = 20;
const MPV_RENDER_API_TYPE_SW: &[u8] = b"sw\0";

// double/triple buffering headroom -- CALayer/window server can still be compositing previous frame(s)
// when we look for a free buffer; cap just bounds live allocations, not a correctness requirement.
const BUFFER_POOL_CAP: usize = 4;

// Handed to CGDataProvider via an Arc instead of a plain Vec<u8> so we get a callback for exactly when
// CoreGraphics is done reading it (release callback runs on Drop) -- buffer rejoins `pool` only then.
struct PooledBuffer {
    data: Vec<u8>,
    pool: Arc<Mutex<Vec<Vec<u8>>>>,
}

impl AsRef<[u8]> for PooledBuffer {
    fn as_ref(&self) -> &[u8] {
        &self.data
    }
}

impl Drop for PooledBuffer {
    fn drop(&mut self) {
        let buf = std::mem::take(&mut self.data);
        if let Ok(mut pool) = self.pool.lock() {
            if pool.len() < BUFFER_POOL_CAP {
                pool.push(buf);
            }
        }
    }
}

pub(crate) struct SoftwareSurface {
    render_ctx: *mut mpv_render_context,
    view: Retained<NSView>,
    colorspace: CGColorSpace, // created once, same for every frame
    buffer_pool: Arc<Mutex<Vec<Vec<u8>>>>, // recycled Vec<u8>s -- render() grabs whichever's free, resize is a no-op once grown to steady-state size
}

// view/render_ctx/mpv FFI aren't auto-Send -- render() (background thread) only touches read-only
// AppKit getters (bounds, isHidden, layer); every mutation happens from set_rect on the main thread.
unsafe impl Send for SoftwareSurface {}

impl SoftwareSurface {
    pub(crate) fn new(
        mpv: *mut mpv_handle,
        content_view: &NSView,
        waker: &Arc<RenderWaker>,
    ) -> Result<Self, String> {
        // ponytail: MainThreadMarker::new_unchecked -- attach()'s whole call chain never checked thread affinity, preserved as-is rather than adding a new runtime check.
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

        Ok(Self {
            render_ctx,
            view,
            colorspace: CGColorSpace::create_device_rgb(),
            buffer_pool: Arc::new(Mutex::new(Vec::with_capacity(BUFFER_POOL_CAP)))
        })
    }
}

impl RenderSurface for SoftwareSurface {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        if w <= 0.0 || h <= 0.0 {
            self.view.setHidden(true);
            return;
        }
        // SAFETY: not retained internally per objc2-app-kit's doc, but this view stays attached until teardown (which also stops further set_rect calls, see MpvEngine's Drop-ordering contract).
        let superview = unsafe { self.view.superview() }.expect("render surface view detached");
        let parent_bounds = superview.bounds();
        let y = parent_bounds.size.height - y_top_left - h; // AppKit's NSView origin is bottom-left, frontend reports top-left (CSS)
self.view.setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(w, h)));
        self.view.setHidden(false);
        self.render();
    }

    /// Renders one frame into an in-memory buffer, hands it to the view's layer as a CGImage. Called
    /// from the render loop's background thread on each RenderWaker wake, and once at end of set_rect.
    fn render(&self) {
        if self.render_ctx.is_null() {
            return; // torn down (MpvEngine dropped)
        }
        if self.view.isHidden() {
            unsafe { skip_frame(self.render_ctx) }; // consume it anyway, see skip_frame (SW backend: no GL context to make current)
            return;
        }
        // ponytail: point resolution, not 2x/HiDPI backing-store -- quarters per-frame cost on Retina,
        // what actually made 30fps possible instead of beachballing. CALayer's default contentsScale (1.0) matches a point-sized image, no extra config needed.
        let bounds = self.view.bounds();
        let (w, h) = (bounds.size.width as i32, bounds.size.height as i32);
        if w <= 0 || h <= 0 {
            unsafe { skip_frame(self.render_ctx) };
            return;
        }

        let stride: usize = (w as usize) * 4;
        let len = stride * (h as usize);
        // reuse a pooled allocation when free -- resize is a no-op once already grown to len
        let mut data = self.buffer_pool.lock().map(|mut p| p.pop()).unwrap_or_default().unwrap_or_default();
        data.resize(len, 0);

        let mut size = [w, h];
        let format = CString::new("rgb0").unwrap(); // opaque RGB + padding byte, no real alpha needed
        let mut stride_val: usize = stride;
        let mut params = [
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_SIZE, data: size.as_mut_ptr() as *mut c_void },
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_FORMAT, data: format.as_ptr() as *mut c_void },
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_STRIDE, data: &mut stride_val as *mut _ as *mut c_void },
            mpv_render_param { type_: MPV_RENDER_PARAM_SW_POINTER, data: data.as_mut_ptr() as *mut c_void },
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        let rc = unsafe { mpv_render_context_render(self.render_ctx, params.as_mut_ptr()) };
        if rc < 0 {
            // no frame ready or a transient error -- return the buffer to the pool instead of dropping it
            if let Ok(mut pool) = self.buffer_pool.lock() {
                if pool.len() < BUFFER_POOL_CAP {
                    pool.push(data);
                }
            }
            return;
        }

        let provider =
            CGDataProvider::from_buffer(Arc::new(PooledBuffer { data, pool: self.buffer_pool.clone() }));
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
        // SAFETY: CGImageRef is a toll-free-bridged CF type, CALayer's contents accepts it directly (Apple's documented behavior).
        unsafe {
            layer.setContents(Some(&*(image.as_ptr() as *const AnyObject)));
        }
        // Core Animation flushes implicit transactions on the next run-loop pass, but this render loop has
        // no run loop -- without an explicit flush the change sits pending forever (shows solid black).
        CATransaction::flush();
    }

    /// Frees the render context and removes the view. Called from MpvEngine::drop while holding the
    /// surface's own mutex -- see RenderSurface's doc for why not via Drop, and why nulling render_ctx matters.
    fn teardown(&mut self) {
        unsafe {
            // Unregister before freeing the context -- else a callback could fire referencing a RenderWaker MpvEngine's Drop is about to free.
            mpv_render_context_set_update_callback(self.render_ctx, None, std::ptr::null_mut());
            mpv_render_context_free(self.render_ctx);
        }
        self.view.removeFromSuperview();
        self.render_ctx = std::ptr::null_mut();
    }
}

#[cfg(test)]
mod pool_tests {
    use super::*;

    #[test]
    fn dropping_a_pooled_buffer_returns_it_to_the_pool() {
        let pool = Arc::new(Mutex::new(Vec::new()));
        let buf = PooledBuffer { data: vec![1, 2, 3], pool: pool.clone() };
        assert!(pool.lock().unwrap().is_empty());
        drop(buf);
        assert_eq!(pool.lock().unwrap().len(), 1);
    }

    #[test]
    fn pool_never_grows_past_its_cap() {
        let pool = Arc::new(Mutex::new(Vec::new()));
        for _ in 0..BUFFER_POOL_CAP + 3 {
            drop(PooledBuffer { data: vec![0; 4], pool: pool.clone() });
        }
        assert_eq!(pool.lock().unwrap().len(), BUFFER_POOL_CAP);
    }
}
