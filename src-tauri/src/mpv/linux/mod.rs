//! Linux mpv render backend (ADR-0010). mpv renders into a `GtkGLArea` composited *under* the
//! transparent WebKitWebView, letting GTK do the compositing -- one path for X11, Wayland and
//! XWayland. Replaces the old raw X11 child-window (x11.rs) and wl_subsurface (wayland.rs) backends,
//! both of which "stepped around the toolkit" and failed (video buried the controls / escaped into
//! its own window). See ADR-0010 for the full rationale and primary sources.
//!
//! Threading: GTK is main-thread-only. mpv's render context is created and rendered *only* on the GTK
//! main thread, inside the GLArea `render` signal (the same model gtkglsink uses). Everything that
//! reaches this backend from another thread does so as a `Msg` on a glib channel; the receiver runs on
//! the main thread and is the sole toucher of the (!Send) GTK widgets. The one value that legitimately
//! crosses threads is the `glib::Sender<Msg>` in `SENDER`.

use super::engine::{on_render_update, RenderWaker};
use super::surface::{Backend, RenderSurface};
use gtk::glib;
use gtk::prelude::*;
use libmpv_sys::*;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use std::cell::RefCell;
use std::ffi::{c_char, c_void, CStr};
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};

// GL constant we need for the FBO query; avoids pulling a whole GL bindings crate for one enum.
const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

const MPV_RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";

/// Resolves a GL entry point through libepoxy's `epoxy_<name>` dispatch pointer. GTK links libepoxy, so
/// its symbols are already in the process's global namespace (found via `RTLD_DEFAULT`). Each
/// `epoxy_glFoo` is a function-pointer *variable* that self-resolves against the current context on first
/// call -- so this works uniformly for GtkGLArea's EGL (Wayland) and GLX (X11) contexts, and returns a
/// pointer mpv can cache. Returns null for names libepoxy doesn't know (mpv treats that as "unavailable").
unsafe fn resolve_gl(name: &CStr) -> *mut c_void {
    let mut sym = Vec::with_capacity(6 + name.to_bytes().len() + 1);
    sym.extend_from_slice(b"epoxy_");
    sym.extend_from_slice(name.to_bytes());
    sym.push(0);
    let pp = unsafe { libc::dlsym(libc::RTLD_DEFAULT, sym.as_ptr() as *const c_char) } as *const *mut c_void;
    if pp.is_null() {
        return std::ptr::null_mut();
    }
    unsafe { *pp }
}

/// Messages from other threads to the GTK main thread. Every variant is `Send`.
enum Msg {
    /// A newly-attached engine hands over its mpv handle + waker; the render context is created lazily
    /// on the next GLArea paint (GL context must be current, which only happens inside `render`).
    SetMpv { mpv: usize, waker: Arc<RenderWaker> },
    /// Ask the GLArea to repaint (posted by the render loop when mpv reports a new frame).
    Render,
    /// Move/resize the video surface within the Fixed, in window-local top-left px. w/h <= 0 hides it.
    Rect { x: f64, y: f64, w: f64, h: f64 },
    /// Free the render context on the main thread (GL current) *before* mpv_terminate_destroy, then reply.
    Teardown { reply: mpsc::Sender<()> },
}

// Set once in `setup` (main thread), read by `attach` (a Tauri async worker thread). Mutex only for
// interior mutability across threads; contention is nil (attach is rare, setup runs once at startup).
static SENDER: OnceLock<Mutex<Option<glib::Sender<Msg>>>> = OnceLock::new();

fn sender_slot() -> &'static Mutex<Option<glib::Sender<Msg>>> {
    SENDER.get_or_init(|| Mutex::new(None))
}

/// Per-window render state, lives on the main thread only, shared between the `render` signal closure
/// and the `Msg` receiver via `Rc<RefCell<..>>`.
#[derive(Default)]
struct RenderState {
    mpv: *mut mpv_handle,
    render_ctx: *mut mpv_render_context,
    waker: Option<Arc<RenderWaker>>,
}

/// Builds the GtkGLArea-under-webview overlay and wires up the message pump. MUST run on the GTK main
/// thread with `webview` being Tauri's live WebKitWebView (call from `with_webview`). Idempotent-ish:
/// only ever called once, from lib.rs's setup.
pub fn setup(webview: &impl IsA<gtk::Widget>) {
    let webview: &gtk::Widget = webview.upcast_ref();
    // --- build the widget tree: overlay { fixed { gl_area }, <overlay> webview } ---
    let gl_area = gtk::GLArea::new();
    gl_area.set_has_depth_buffer(false);
    gl_area.set_has_stencil_buffer(false);
    // We drive repaints ourselves (queue_render on each new mpv frame); no continuous redraw.
    gl_area.set_auto_render(false);
    gl_area.set_size_request(1, 1);

    let fixed = gtk::Fixed::new();
    fixed.put(&gl_area, 0, 0);

    let overlay = gtk::Overlay::new();
    overlay.add(&fixed); // main child -> bottom layer

    // Reparent the live webview so it sits above the GLArea, WITHOUT changing its depth under the
    // window. Tauri's undecorated-resize handler (tauri-runtime-wry undecorated_resizing.rs) hard-codes
    // `webview.parent().parent() == the GtkWindow` and `.downcast::<Window>().unwrap()`s it -- so the
    // webview must stay exactly two levels below the window. We therefore make our Overlay the window's
    // *single direct child* (replacing Tauri's vbox), with the webview as an overlay child:
    //   window -> overlay -> webview   (parent=overlay, grandparent=window: handler still happy)
    // The vbox Tauri created only held the webview (no GTK menu bar on Linux), so dropping it is safe.
    if let Some(vbox) = webview.parent().and_then(|p| p.downcast::<gtk::Container>().ok()) {
        vbox.remove(webview);
        if let Some(window) = vbox.parent().and_then(|p| p.downcast::<gtk::Container>().ok()) {
            window.remove(&vbox);
            // Make the webview fill the whole overlay (GtkOverlay would otherwise give an overlay child
            // only its natural size in a corner).
            webview.set_halign(gtk::Align::Fill);
            webview.set_valign(gtk::Align::Fill);
            webview.set_hexpand(true);
            webview.set_vexpand(true);
            overlay.add_overlay(webview); // top layer, transparent, receives input
            window.add(&overlay);
        } else {
            // Couldn't find the window -- put the webview back so the app still works, skip video overlay.
            vbox.add(webview);
            eprintln!("mpv: could not locate GtkWindow to install video overlay; video disabled");
            return;
        }
    } else {
        eprintln!("mpv: webview has no container parent; video disabled");
        return;
    }

    let state = Rc::new(RefCell::new(RenderState::default()));

    // --- GLArea render signal: create the mpv render context lazily, then render into the bound FBO ---
    {
        let state = state.clone();
        gl_area.connect_render(move |area, _ctx| {
            let mut st = state.borrow_mut();
            if st.mpv.is_null() {
                return glib::Propagation::Proceed; // nothing attached yet
            }
            if st.render_ctx.is_null() {
                match create_render_context(st.mpv, st.waker.clone()) {
                    Ok(ctx) => st.render_ctx = ctx,
                    Err(e) => {
                        eprintln!("mpv: GtkGLArea render-context creation failed: {e}");
                        return glib::Propagation::Proceed;
                    }
                }
            }
            let scale = area.scale_factor();
            let w = area.allocated_width() * scale;
            let h = area.allocated_height() * scale;
            if w <= 0 || h <= 0 {
                return glib::Propagation::Proceed;
            }
            unsafe { render_into_current_fbo(st.render_ctx, w, h) };
            glib::Propagation::Stop
        });
    }

    overlay.show_all();

    // --- message pump on the default main context (main thread) ---
    // ponytail: glib's MainContext::channel is deprecated in favour of async-channel + spawn_future_local,
    // but it's exactly the Send-sender / main-thread-receiver primitive we need and still ships in glib
    // 0.18 (Tauri's version). Not worth pulling an async runtime in for one channel; revisit if it's removed.
    #[allow(deprecated)]
    let (tx, rx) = glib::MainContext::channel::<Msg>(glib::Priority::DEFAULT);
    {
        let gl_area = gl_area.clone();
        let fixed = fixed.clone();
        let state = state.clone();
        rx.attach(None, move |msg| {
            match msg {
                Msg::SetMpv { mpv, waker } => {
                    let mut st = state.borrow_mut();
                    st.mpv = mpv as *mut mpv_handle;
                    st.waker = Some(waker);
                    gl_area.queue_render(); // triggers lazy render-context creation + first frame
                }
                Msg::Render => gl_area.queue_render(),
                Msg::Rect { x, y, w, h } => {
                    if w <= 0.0 || h <= 0.0 {
                        gl_area.hide();
                    } else {
                        fixed.move_(&gl_area, x as i32, y as i32);
                        gl_area.set_size_request(w as i32, h as i32);
                        gl_area.show();
                        gl_area.queue_render();
                    }
                }
                Msg::Teardown { reply } => {
                    let mut st = state.borrow_mut();
                    if !st.render_ctx.is_null() {
                        gl_area.make_current();
                        unsafe {
                            mpv_render_context_set_update_callback(st.render_ctx, None, std::ptr::null_mut());
                            mpv_render_context_free(st.render_ctx);
                        }
                        st.render_ctx = std::ptr::null_mut();
                    }
                    st.mpv = std::ptr::null_mut();
                    let _ = reply.send(());
                }
            }
            glib::ControlFlow::Continue
        });
    }

    *sender_slot().lock().unwrap() = Some(tx);
}

/// mpv render-context creation, run on the main thread with the GLArea's GL context current.
fn create_render_context(mpv: *mut mpv_handle, waker: Option<Arc<RenderWaker>>) -> Result<*mut mpv_render_context, String> {
    let api = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *mut c_void;
    let mut init = mpv_opengl_init_params {
        get_proc_address: Some(gl_get_proc_address),
        get_proc_address_ctx: std::ptr::null_mut(),
        extra_exts: std::ptr::null(),
    };
    let mut params = [
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE, data: api },
        mpv_render_param {
            type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
            data: &mut init as *mut _ as *mut c_void,
        },
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
    ];
    let mut ctx: *mut mpv_render_context = std::ptr::null_mut();
    unsafe {
        let rc = mpv_render_context_create(&mut ctx, mpv, params.as_mut_ptr());
        if rc < 0 {
            let msg = CStr::from_ptr(mpv_error_string(rc)).to_string_lossy().into_owned();
            return Err(format!("mpv_render_context_create (opengl): {msg} ({rc})"));
        }
        // Wake the render loop on each new frame -> Msg::Render -> queue_render. Ctx is the waker's addr.
        if let Some(waker) = waker {
            mpv_render_context_set_update_callback(ctx, Some(on_render_update), Arc::as_ptr(&waker) as *mut c_void);
            // Leak one Arc ref so the waker outlives the callback registration; reclaimed at teardown
            // implicitly (process teardown). ponytail: the engine's own Arc keeps it alive in practice;
            // this forget is belt-and-suspenders so the callback ctx never dangles.
            std::mem::forget(waker);
        }
    }
    Ok(ctx)
}

/// Renders one mpv frame into the FBO GtkGLArea currently has bound. Called on the main thread inside
/// the render signal, context already current.
unsafe fn render_into_current_fbo(ctx: *mut mpv_render_context, w: i32, h: i32) {
    // GtkGLArea binds its own FBO before emitting `render`; render to *that*, not the default framebuffer.
    let get_integerv_ptr = unsafe { resolve_gl(CStr::from_bytes_with_nul_unchecked(b"glGetIntegerv\0")) };
    if get_integerv_ptr.is_null() {
        return; // can't find the FBO to render into; skip this frame rather than render to the wrong one
    }
    let get_integerv: unsafe extern "C" fn(u32, *mut i32) = unsafe { std::mem::transmute(get_integerv_ptr) };
    let mut fbo: i32 = 0;
    unsafe { get_integerv(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo) };

    let mut fbo_param = mpv_opengl_fbo { fbo, w, h, internal_format: 0 };
    let mut flip_y: i32 = 1; // GL bottom-left origin; GtkGLArea presents top-left. Flip to match.
    let mut params = [
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo_param as *mut _ as *mut c_void },
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y, data: &mut flip_y as *mut _ as *mut c_void },
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
    ];
    unsafe { mpv_render_context_render(ctx, params.as_mut_ptr()) };
}

/// mpv's get_proc_address callback -- libepoxy resolves for whichever GL/GLES context GtkGLArea made.
unsafe extern "C" fn gl_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { resolve_gl(CStr::from_ptr(name)) }
}

/// The `RenderSurface` seam, kept identical in shape to mac/windows. On Linux everything is a message
/// to the main-thread pump; this struct holds no GL/GTK state itself (so it's trivially `Send`).
struct GtkSurface {
    tx: glib::Sender<Msg>,
}

// tx is glib::Sender<Msg> (Send). No !Send field. The unsafe impl mirrors the other backends' seam.
unsafe impl Send for GtkSurface {}

impl RenderSurface for GtkSurface {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        let _ = self.tx.send(Msg::Rect { x, y: y_top_left, w, h });
    }

    fn render(&self) {
        // Posted from the background render loop when mpv signals a new frame; the real render happens
        // on the main thread in the GLArea render signal.
        let _ = self.tx.send(Msg::Render);
    }

    fn teardown(&mut self) {
        let (reply_tx, reply_rx) = mpsc::channel();
        if self.tx.send(Msg::Teardown { reply: reply_tx }).is_ok() {
            // Block until the main thread has freed the render context -- must happen strictly before
            // mpv_terminate_destroy (MpvEngine::drop calls this then destroys mpv).
            let _ = reply_rx.recv();
        }
    }
}

/// `RenderSurface` factory, called by engine.rs's platform-agnostic attach. The window/display handles
/// are unused on Linux (GTK owns the surfaces); we just hand mpv to the main-thread pump.
pub(crate) fn attach(
    mpv: *mut mpv_handle,
    _handle: RawWindowHandle,
    _display_handle: RawDisplayHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    let tx = sender_slot()
        .lock()
        .unwrap()
        .clone()
        .ok_or("Linux GTK video surface not set up (lib.rs setup did not run)")?;
    tx.send(Msg::SetMpv { mpv: mpv as usize, waker: Arc::clone(waker) })
        .map_err(|e| format!("failed to hand mpv to the GTK main thread: {e}"))?;
    Ok((Box::new(GtkSurface { tx }) as Box<dyn RenderSurface>, Backend::Gpu))
}
