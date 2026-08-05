//! Linux mpv render backend (ADR-0010). mpv renders into a `GtkGLArea` composited *under* the
//! transparent WebKitWebView, letting GTK do the compositing -- one path for X11, Wayland and
//! XWayland. Replaces the old raw X11 child-window (x11.rs) and wl_subsurface (wayland.rs) backends,
//! both of which "stepped around the toolkit" and failed (video buried the controls / escaped into
//! its own window). See ADR-0010 for the full rationale and primary sources.
//!
//! Threading: GTK is main-thread-only. mpv's render context is created and rendered *only* on the GTK
//! main thread, inside the GLArea `render` signal (the same model gtkglsink/Celluloid use). Everything that
//! reaches this backend from another thread does so as a `Msg` on a glib channel; the receiver runs on
//! the main thread and is the sole toucher of the (!Send) GTK widgets. The one value that legitimately
//! crosses threads is the `glib::Sender<Msg>` in `SENDER`.
//!
//! Sizing: the GLArea keeps a permanent 1x1 size *request* and is positioned by allocating it directly
//! (`size_allocate`). In GTK3 a size request is a *minimum* that propagates Fixed -> Overlay -> Window ->
//! geometry hints, so requesting the video's size (what this file used to do) made the toplevel
//! un-shrinkable during playback -- measured: a 1600x900 video rect pushed the window minimum to
//! 1652x989, i.e. bigger than the window itself. Re-applied from the `Fixed`'s own `size-allocate` so a
//! window resize (which re-allocates children to their 1x1 request) doesn't lose the rect.
//!
//! GL entry points come from the platform resolver (`eglGetProcAddress` on Wayland,
//! `glXGetProcAddressARB` on X11), the route render_gl.h documents and Celluloid uses. They must be able
//! to return NULL: that is how libmpv detects a function/extension is unavailable. libepoxy's
//! `epoxy_gl*` dispatch pointers (used here before) are *never* NULL -- verified on this machine, even
//! `epoxy_glDrawMeshTasksNV` on a non-NVIDIA GPU -- so mpv saw every function as present and a call into
//! an unsupported one hit epoxy's resolver-failure handler, which `abort()`s the process.

use super::engine::{on_render_update, RenderWaker};
use super::profile::RenderProfiler;
use super::surface::{skip_frame, Backend, RenderSurface};
use gtk::glib;
use gtk::prelude::*;
use libmpv_sys::*;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use std::cell::{Cell, RefCell};
use std::ffi::{c_char, c_void, CStr};
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

// GL constant we need for the FBO query; avoids pulling a whole GL bindings crate for one enum.
// (GL_DRAW_FRAMEBUFFER_BINDING == GL_FRAMEBUFFER_BINDING, so this is also correct on GLES2.)
const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

const MPV_RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";

/// If GTK hasn't painted the GLArea for this long while mpv keeps reporting new frames (window
/// minimised/occluded, or the video rect hidden), one frame is consumed with `SKIP_RENDERING` so the
/// core doesn't stall -- mpv's documented failure mode is "mpv_render_context_render() not being called
/// or stuck", followed by degraded playback, not just a frozen picture.
const PAINT_STALL: Duration = Duration::from_millis(250);

/// Timing profiler around the *real* render call. On Linux `RenderSurface::render` only posts a message,
/// so the profiler in commands.rs would otherwise time a channel send. Opt-in (`PHOTON_PROFILE_RENDER=1`).
static PROFILER: OnceLock<Option<RenderProfiler>> = OnceLock::new();

/// Native display resource for hwdec interop, extracted from Tauri's `RawDisplayHandle` (a plain
/// pointer, hence the `usize`, so it can ride the glib channel to the main thread).
#[derive(Clone, Copy, Default)]
enum NativeDisplay {
    Wayland(usize),
    X11(usize),
    #[default]
    Unknown,
}

impl NativeDisplay {
    fn from_handle(handle: RawDisplayHandle) -> Self {
        match handle {
            RawDisplayHandle::Wayland(h) => Self::Wayland(h.display.as_ptr() as usize),
            RawDisplayHandle::Xlib(h) => h.display.map(|d| Self::X11(d.as_ptr() as usize)).unwrap_or_default(),
            _ => Self::Unknown,
        }
    }

    /// The `mpv_render_context_create` parameter mpv needs to open a VADisplay/vdpau device itself, i.e.
    /// what makes *direct* (zero-copy) hwdec interop possible instead of a GPU->RAM->GPU round trip per
    /// frame. render_gl.h: "Intel/Linux: EGL is required, and also the native display resource needs to
    /// be provided (e.g. MPV_RENDER_PARAM_X11_DISPLAY for X11 and MPV_RENDER_PARAM_WL_DISPLAY for
    /// Wayland)". Celluloid passes both from GDK; ADR-0010 wrongly claimed this wasn't reachable here.
    fn render_param(self) -> Option<mpv_render_param> {
        let (type_, ptr) = match self {
            Self::Wayland(p) => (mpv_render_param_type_MPV_RENDER_PARAM_WL_DISPLAY, p),
            Self::X11(p) => (mpv_render_param_type_MPV_RENDER_PARAM_X11_DISPLAY, p),
            Self::Unknown => return None,
        };
        if ptr == 0 {
            return None;
        }
        Some(mpv_render_param { type_, data: ptr as *mut c_void })
    }
}

/// GL function resolver: the display server's own `get_proc_address` plus a direct-`dlsym` fallback for
/// the core functions some EGL versions won't hand out. Returns NULL for anything genuinely missing.
struct GlResolver {
    get_proc: Option<unsafe extern "C" fn(*const c_char) -> *mut c_void>,
    /// libEGL/libGL (whichever hosts `get_proc`) and libGL, for the dlsym fallback. Raw handles.
    libs: [*mut c_void; 2],
}

// Handles/fn pointers only; every use is on the GTK main thread, the statics just need to be shareable.
unsafe impl Send for GlResolver {}
unsafe impl Sync for GlResolver {}

static RESOLVER: OnceLock<GlResolver> = OnceLock::new();

unsafe fn dlopen(name: &[u8]) -> *mut c_void {
    unsafe { libc::dlopen(name.as_ptr() as *const c_char, libc::RTLD_LAZY | libc::RTLD_LOCAL) }
}

/// Picks `eglGetProcAddress` (Wayland) or `glXGetProcAddressARB` (X11/unknown) once, on the main thread,
/// before the render context is created. Idempotent -- later calls keep the first resolver (and don't
/// dlopen anything, so no handle can be built and then dropped on the floor).
fn init_resolver(display: NativeDisplay) {
    RESOLVER.get_or_init(|| build_resolver(display));
}

fn build_resolver(display: NativeDisplay) -> GlResolver {
    let (lib_name, sym): (&[u8], &[u8]) = match display {
        NativeDisplay::Wayland(_) => (b"libEGL.so.1\0", b"eglGetProcAddress\0"),
        // GLX also covers a GDK_GL=egl context: libGL exports the core functions either way, and the
        // dlsym fallback below picks up anything glXGetProcAddressARB declines.
        _ => (b"libGL.so.1\0", b"glXGetProcAddressARB\0"),
    };
    let primary = unsafe { dlopen(lib_name) };
    let get_proc = if primary.is_null() {
        None
    } else {
        let p = unsafe { libc::dlsym(primary, sym.as_ptr() as *const c_char) };
        if p.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute::<*mut c_void, unsafe extern "C" fn(*const c_char) -> *mut c_void>(p) })
        }
    };
    if get_proc.is_none() {
        eprintln!(
            "mpv: {} not found in {} -- falling back to plain dlsym for GL entry points",
            String::from_utf8_lossy(&sym[..sym.len() - 1]),
            String::from_utf8_lossy(&lib_name[..lib_name.len() - 1]),
        );
    }
    let gl = unsafe { dlopen(b"libGL.so.1\0") };
    GlResolver { get_proc, libs: [primary, gl] }
}

/// Resolves one GL entry point, or NULL if this driver/context genuinely doesn't have it.
unsafe fn resolve_gl(name: &CStr) -> *mut c_void {
    let Some(resolver) = RESOLVER.get() else {
        return std::ptr::null_mut();
    };
    if let Some(get_proc) = resolver.get_proc {
        let p = unsafe { get_proc(name.as_ptr()) };
        if !p.is_null() {
            return p;
        }
    }
    for lib in resolver.libs {
        if !lib.is_null() {
            let p = unsafe { libc::dlsym(lib, name.as_ptr()) };
            if !p.is_null() {
                return p;
            }
        }
    }
    std::ptr::null_mut()
}

/// mpv's get_proc_address callback.
unsafe extern "C" fn gl_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { resolve_gl(CStr::from_ptr(name)) }
}

/// Video rect as the renderer sees it: (x, y, w, h) in CSS px, `None` while hidden.
type CssRect = Option<(f64, f64, f64, f64)>;

type GetIntegerv = unsafe extern "C" fn(u32, *mut i32);
type GetError = unsafe extern "C" fn() -> u32;

/// The two GL entry points this file itself needs, resolved once per render context.
#[derive(Clone, Copy)]
struct GlFns {
    get_integerv: GetIntegerv,
    get_error: Option<GetError>,
}

/// Messages from other threads to the GTK main thread. Every variant is `Send`.
enum Msg {
    /// A newly-attached engine hands over its mpv handle + waker; the render context is created lazily
    /// on the next GLArea paint (GL context must be current, which only happens inside `render`).
    SetMpv { mpv: usize, waker: Arc<RenderWaker>, display: NativeDisplay },
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
/// Why there is no video surface, if there isn't one -- surfaced through `attach` so `mpv_attach` fails
/// loudly instead of leaving the user with a black rectangle and a line on a stderr nobody reads.
static SETUP_ERROR: OnceLock<String> = OnceLock::new();
/// The GTK main thread, so `teardown` can tell whether blocking on it would deadlock.
static MAIN_THREAD: OnceLock<std::thread::ThreadId> = OnceLock::new();

fn sender_slot() -> &'static Mutex<Option<glib::Sender<Msg>>> {
    SENDER.get_or_init(|| Mutex::new(None))
}

fn fail_setup(reason: impl Into<String>) {
    let reason = reason.into();
    eprintln!("mpv: {reason}");
    let _ = SETUP_ERROR.set(reason);
}

/// Per-window render state, lives on the main thread only, shared between the signal closures and the
/// `Msg` receiver via `Rc<RefCell<..>>`.
struct RenderState {
    mpv: *mut mpv_handle,
    render_ctx: *mut mpv_render_context,
    waker: Option<Arc<RenderWaker>>,
    display: NativeDisplay,
    /// Cached once per render context -- this used to be a `dlsym` (plus a `Vec` allocation) per frame.
    gl: Option<GlFns>,
    /// Set by `render`, consumed by the frame clock's `after-paint` to report exactly the frames that
    /// were actually drawn: render.h warns that reporting swaps *inconsistently* is worse than not at all.
    rendered_frame: bool,
    /// When GTK last painted us, for the `PAINT_STALL` drain.
    last_paint: Instant,
}

impl Default for RenderState {
    fn default() -> Self {
        Self {
            mpv: std::ptr::null_mut(),
            render_ctx: std::ptr::null_mut(),
            waker: None,
            display: NativeDisplay::default(),
            gl: None,
            rendered_frame: false,
            last_paint: Instant::now(),
        }
    }
}

/// Builds the GtkGLArea-under-webview overlay and wires up the message pump. MUST run on the GTK main
/// thread with `webview` being Tauri's live WebKitWebView (call from `with_webview`). Idempotent-ish:
/// only ever called once, from lib.rs's setup.
pub fn setup(webview: &impl IsA<gtk::Widget>) {
    let _ = MAIN_THREAD.set(std::thread::current().id());
    let webview: &gtk::Widget = webview.upcast_ref();
    // --- build the widget tree: overlay { fixed { gl_area }, <overlay> webview } ---
    let gl_area = gtk::GLArea::new();
    gl_area.set_has_depth_buffer(false);
    gl_area.set_has_stencil_buffer(false);
    // We drive repaints ourselves (queue_render on each new mpv frame); no continuous redraw.
    gl_area.set_auto_render(false);
    // Permanent 1x1 *minimum*; the real geometry comes from `size_allocate` (see this module's docs).
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
    // NOTE: tao still owns that vbox (`Window::default_vbox`) and tauri-runtime-wry builds *additional*
    // webviews into it, so a second webview in this window would render into an orphaned container.
    // Photon has exactly one webview; keep it that way or revisit this reparent.
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
            fail_setup("could not locate the GtkWindow to install the video overlay");
            return;
        }
    } else {
        fail_setup("the webview has no container parent; cannot install the video overlay");
        return;
    }

    let state = Rc::new(RefCell::new(RenderState::default()));
    // Video rect as the renderer sent it (CSS px), or None while hidden. Kept in CSS space, not as a
    // ready-made allocation, so it is re-translated on every relayout -- the CSD origin it's translated
    // through can change (maximise, fullscreen, un-decorate).
    let rect: Rc<Cell<CssRect>> = Rc::new(Cell::new(None));

    // --- keep the manual allocation across relayouts: GtkFixed re-allocates children to their (1x1)
    // request whenever the window resizes, so re-apply ours right after it does. ---
    {
        let rect = rect.clone();
        let gl_area = gl_area.clone();
        fixed.connect_size_allocate(move |_, _| {
            if let Some(css) = rect.get() {
                apply_rect(&gl_area, css);
            }
        });
    }

    // --- GLArea render signal: create the mpv render context lazily, then render into the bound FBO ---
    {
        let state = state.clone();
        gl_area.connect_render(move |area, _ctx| {
            let (ctx, gl, w, h) = {
                let mut st = state.borrow_mut();
                if st.mpv.is_null() {
                    return glib::Propagation::Proceed; // nothing attached yet
                }
                if st.render_ctx.is_null() {
                    match create_render_context(st.mpv, st.waker.clone(), st.display) {
                        Ok(ctx) => {
                            st.render_ctx = ctx;
                            st.gl = unsafe { resolve_gl_fns() };
                            if st.gl.is_none() {
                                fail_setup("no glGetIntegerv in this GL context; cannot find GtkGLArea's FBO");
                            }
                        }
                        Err(e) => {
                            fail_setup(format!("GtkGLArea render-context creation failed: {e}"));
                            return glib::Propagation::Proceed;
                        }
                    }
                }
                let scale = area.scale_factor();
                let (w, h) = (area.allocated_width() * scale, area.allocated_height() * scale);
                let Some(gl) = st.gl else {
                    return glib::Propagation::Proceed;
                };
                if w <= 0 || h <= 0 {
                    return glib::Propagation::Proceed;
                }
                (st.render_ctx, gl, w, h)
            }; // borrow released: mpv_render_context_render can call back into us (after-paint borrows too)

            let render = || unsafe { render_into_current_fbo(ctx, gl, w, h) };
            match PROFILER.get_or_init(RenderProfiler::new) {
                Some(profiler) => profiler.time(render),
                None => render(),
            }

            let mut st = state.borrow_mut();
            st.rendered_frame = true;
            st.last_paint = Instant::now();
            glib::Propagation::Stop
        });
    }

    overlay.show_all();

    // Realize now so a broken GL setup (llvmpipe-less VM, nested/remote X, driver mismatch) is known
    // *before* the first attach, and reported through `mpv_attach` instead of showing a black rectangle.
    gl_area.realize();
    if let Some(e) = gl_area.error() {
        fail_setup(format!("GtkGLArea has no usable GL context: {e}"));
    }

    // --- report every drawn frame back to mpv so it can estimate vsync (render.h: optional, "can help
    // the player to achieve better timing"). Frame-clock after-paint is the closest hook GTK gives us to
    // the actual flip; gated on `rendered_frame` so UI-only frames don't report phantom swaps. ---
    if let Some(clock) = gl_area.frame_clock() {
        let state = state.clone();
        let gl_area = gl_area.clone();
        clock.connect_after_paint(move |_| {
            let mut st = state.borrow_mut();
            if !std::mem::take(&mut st.rendered_frame) || st.render_ctx.is_null() || !gl_area.is_realized() {
                return;
            }
            // Every mpv_render_* call needs *this* GL context current (render_gl.h), and outside the
            // render signal GTK has neither made it current nor bound the area's framebuffer -- without
            // attach_buffers mpv's calls land on an incomplete default framebuffer and it logs
            // "OpenGL error INVALID_FRAMEBUFFER_OPERATION" (seen for real on Wayland/Mesa).
            gl_area.make_current();
            gl_area.attach_buffers();
            unsafe { mpv_render_context_report_swap(st.render_ctx) };
        });
    }

    // --- message pump on the default main context (main thread) ---
    // ponytail: glib's MainContext::channel is deprecated in favour of async-channel + spawn_future_local,
    // but it's exactly the Send-sender / main-thread-receiver primitive we need and still ships in glib
    // 0.18 (Tauri's version). Not worth pulling an async runtime in for one channel; revisit if it's removed.
    #[allow(deprecated)]
    let (tx, rx) = glib::MainContext::channel::<Msg>(glib::Priority::DEFAULT);
    {
        let gl_area = gl_area.clone();
        let state = state.clone();
        rx.attach(None, move |msg| {
            match msg {
                Msg::SetMpv { mpv, waker, display } => {
                    init_resolver(display);
                    let mut st = state.borrow_mut();
                    st.mpv = mpv as *mut mpv_handle;
                    st.waker = Some(waker);
                    st.display = display;
                    st.last_paint = Instant::now();
                    gl_area.queue_render(); // triggers lazy render-context creation + first frame
                }
                Msg::Render => {
                    // If GTK isn't painting us (hidden rect, minimised, occluded), nobody would ever call
                    // mpv_render_context_render and the core degrades. Consume the frame without drawing.
                    let stalled = {
                        let st = state.borrow();
                        !st.render_ctx.is_null() && st.last_paint.elapsed() > PAINT_STALL
                    };
                    if stalled && gl_area.is_realized() {
                        let mut st = state.borrow_mut();
                        gl_area.make_current();
                        gl_area.attach_buffers(); // see the after-paint handler: mpv needs a complete FBO bound
                        unsafe { skip_frame(st.render_ctx) };
                        st.last_paint = Instant::now();
                        st.rendered_frame = false; // not drawn -> not a swap to report
                    }
                    gl_area.queue_render();
                }
                Msg::Rect { x, y, w, h } => {
                    if w <= 0.0 || h <= 0.0 {
                        rect.set(None);
                        gl_area.hide();
                    } else {
                        // The rect arrives in the webview's own (CSS px) coordinates, whose origin is the
                        // top-left of the web content. A GTK allocation is in the *toplevel widget's*
                        // space, which on a client-side-decorated window starts above/left of that --
                        // measured on GTK 3.24: a 1280x800 client area sits at (26, 60) inside a 1332x889
                        // toplevel window (shadow + headerbar), and the webview's own
                        // translate_coordinates(toplevel) is exactly that (26, 60). Server-side
                        // decorations give (0, 0). So translate by the container origin -- precisely what
                        // GtkFixed would have added itself if we weren't allocating the child by hand.
                        rect.set(Some((x, y, w, h)));
                        gl_area.show();
                        let alloc = apply_rect(&gl_area, (x, y, w, h));
                        if std::env::var_os("PHOTON_DEBUG_RECT").is_some() {
                            eprintln!(
                                "mpv: rect css=({x},{y},{w},{h}) origin={:?} alloc={:?} scale={}",
                                video_origin(&gl_area),
                                (alloc.x(), alloc.y(), alloc.width(), alloc.height()),
                                gl_area.scale_factor(),
                            );
                        }
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
                    st.gl = None;
                    let _ = reply.send(());
                }
            }
            glib::ControlFlow::Continue
        });
    }

    *sender_slot().lock().unwrap() = Some(tx);
}

/// mpv render-context creation, run on the main thread with the GLArea's GL context current.
fn create_render_context(
    mpv: *mut mpv_handle,
    waker: Option<Arc<RenderWaker>>,
    display: NativeDisplay,
) -> Result<*mut mpv_render_context, String> {
    let api = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *mut c_void;
    let mut init = mpv_opengl_init_params {
        get_proc_address: Some(gl_get_proc_address),
        get_proc_address_ctx: std::ptr::null_mut(),
        extra_exts: std::ptr::null(),
    };
    let mut params = vec![
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE, data: api },
        mpv_render_param {
            type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
            data: &mut init as *mut _ as *mut c_void,
        },
    ];
    // Only present when Tauri handed us a Wayland/X11 display -- without it mpv can't open its own
    // VADisplay and every hwdec falls back to a GPU->RAM->GPU copy per frame.
    params.extend(display.render_param());
    // ponytail: MPV_RENDER_PARAM_ADVANCED_CONTROL is deliberately *not* set here. It would buy direct
    // rendering (vd-lavc-dr) and GPU screenshots, but it also promises libmpv that the render thread
    // never waits for the core -- and on Linux the render thread *is* the GTK main thread, which runs
    // arbitrary app/webview work. render.h is explicit that breaking that promise turns non-fatal
    // timeouts into "a real deadlock will freeze the mpv core thread forever".
    params.push(mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() });
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

/// Places the GLArea at a CSS-pixel rect from the renderer, translated into the toplevel widget's
/// coordinate space. Returns the allocation actually used (for the `PHOTON_DEBUG_RECT` line).
fn apply_rect(gl_area: &gtk::GLArea, (x, y, w, h): (f64, f64, f64, f64)) -> gtk::Allocation {
    let (ox, oy) = video_origin(gl_area);
    let alloc = gtk::Allocation::new(ox + x as i32, oy + y as i32, w as i32, h as i32);
    gl_area.size_allocate(&alloc);
    alloc
}

/// Origin (in toplevel-widget coordinates) that the renderer's CSS pixel rect is relative to: the
/// containing `Fixed`'s own allocation, which GTK keeps equal to the web content's top-left. Read from
/// the live widget tree rather than assumed, so it can't drift out of sync with the window's decoration
/// mode (0,0 with server-side decorations, the CSD inset otherwise) or with what Tauri does to the window.
fn video_origin(gl_area: &gtk::GLArea) -> (i32, i32) {
    match gl_area.parent() {
        Some(fixed) => {
            let alloc = fixed.allocation();
            (alloc.x(), alloc.y())
        }
        None => (0, 0),
    }
}

/// One-time lookup of the entry points this file calls itself, once per render context.
unsafe fn resolve_gl_fns() -> Option<GlFns> {
    let integerv = unsafe { resolve_gl(c"glGetIntegerv") };
    if integerv.is_null() {
        return None;
    }
    let error = unsafe { resolve_gl(c"glGetError") };
    Some(GlFns {
        get_integerv: unsafe { std::mem::transmute::<*mut c_void, GetIntegerv>(integerv) },
        get_error: (!error.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, GetError>(error) }),
    })
}

/// Renders one mpv frame into the FBO GtkGLArea currently has bound. Called on the main thread inside
/// the render signal, context already current.
unsafe fn render_into_current_fbo(ctx: *mut mpv_render_context, gl: GlFns, w: i32, h: i32) {
    // GTK/GDK never calls glGetError, so whatever error flag its own attach_buffers/blit left behind is
    // still queued when mpv looks -- and mpv reports it as its own ("after creating texture: OpenGL error
    // INVALID_FRAMEBUFFER_OPERATION", seen on Mesa). Drain first so mpv's diagnostics mean something.
    if let Some(get_error) = gl.get_error {
        for _ in 0..8 {
            if unsafe { get_error() } == 0 {
                break;
            }
        }
    }
    // GtkGLArea binds its own FBO before emitting `render`; render to *that*, not the default framebuffer.
    let mut fbo: i32 = 0;
    unsafe { (gl.get_integerv)(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo) };

    let mut fbo_param = mpv_opengl_fbo { fbo, w, h, internal_format: 0 };
    let mut flip_y: i32 = 1; // GL bottom-left origin; GtkGLArea presents top-left. Flip to match.
    // Rendering happens on the GTK main thread here, and mpv_render_context_render *blocks until the
    // frame's target display time* by default (render.h: up to "video-timing-offset", 50ms) -- which
    // would stall the webview's compositing and input handling, not just this thread. engine.rs pairs
    // this with video-timing-offset=0 on Linux so mpv doesn't render ahead in the first place, which
    // render.h names as the way to keep A/V sync while not blocking.
    let mut block_for_target_time: i32 = 0;
    let mut params = [
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo_param as *mut _ as *mut c_void },
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y, data: &mut flip_y as *mut _ as *mut c_void },
        mpv_render_param {
            type_: mpv_render_param_type_MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME,
            data: &mut block_for_target_time as *mut _ as *mut c_void,
        },
        mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
    ];
    unsafe { mpv_render_context_render(ctx, params.as_mut_ptr()) };
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
        if self.tx.send(Msg::Teardown { reply: reply_tx }).is_err() {
            return;
        }
        // Normally the GTK main loop picks the message up and we block until the render context is freed
        // -- that must happen strictly before mpv_terminate_destroy (MpvEngine::drop calls this, then
        // destroys mpv). But drop can also run *on* the main thread (managed-state teardown at app exit,
        // after the loop has stopped dispatching): blocking there waits for ourselves. Pump the context
        // by hand in that case, and keep a timeout so a wedged loop costs a pause, not a hung process.
        if MAIN_THREAD.get() == Some(&std::thread::current().id()) {
            let ctx = glib::MainContext::default();
            // Only iterate if this thread actually owns the context -- dispatching sources from a
            // context owned elsewhere is exactly the kind of off-thread GTK call this file exists to
            // avoid. If ownership can't be had, fall through to the timeout below.
            let _guard = ctx.acquire().ok(); // recursive for the owning thread, so cheap either way
            if ctx.is_owner() {
                while ctx.pending() {
                    ctx.iteration(false);
                }
            }
        }
        let _ = reply_rx.recv_timeout(Duration::from_secs(2));
    }
}

/// `RenderSurface` factory, called by engine.rs's platform-agnostic attach. The window handle is unused
/// on Linux (GTK owns the surfaces); the display handle is what mpv needs for hwdec interop.
pub(crate) fn attach(
    mpv: *mut mpv_handle,
    _handle: RawWindowHandle,
    display_handle: RawDisplayHandle,
    waker: &Arc<RenderWaker>,
) -> Result<(Box<dyn RenderSurface>, Backend), String> {
    if let Some(reason) = SETUP_ERROR.get() {
        return Err(format!("no video surface on this display: {reason}"));
    }
    let tx = sender_slot()
        .lock()
        .unwrap()
        .clone()
        .ok_or("Linux GTK video surface not set up (lib.rs setup did not run)")?;
    tx.send(Msg::SetMpv {
        mpv: mpv as usize,
        waker: Arc::clone(waker),
        display: NativeDisplay::from_handle(display_handle),
    })
    .map_err(|e| format!("failed to hand mpv to the GTK main thread: {e}"))?;
    Ok((Box::new(GtkSurface { tx }) as Box<dyn RenderSurface>, Backend::Gpu))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_display_contributes_no_render_param() {
        // No X11/Wayland pointer -> mpv gets no display param and keeps its copy-back hwdec fallback,
        // instead of us passing a null pointer it would try to open a VADisplay on.
        assert!(NativeDisplay::Unknown.render_param().is_none());
        assert!(NativeDisplay::X11(0).render_param().is_none());
        assert!(NativeDisplay::Wayland(0).render_param().is_none());
    }

    #[test]
    fn wayland_and_x11_map_to_their_own_render_param_types() {
        let wl = NativeDisplay::Wayland(0xdead).render_param().expect("wayland param");
        assert_eq!(wl.type_, mpv_render_param_type_MPV_RENDER_PARAM_WL_DISPLAY);
        assert_eq!(wl.data as usize, 0xdead);
        let x11 = NativeDisplay::X11(0xbeef).render_param().expect("x11 param");
        assert_eq!(x11.type_, mpv_render_param_type_MPV_RENDER_PARAM_X11_DISPLAY);
        assert_eq!(x11.data as usize, 0xbeef);
    }
}
