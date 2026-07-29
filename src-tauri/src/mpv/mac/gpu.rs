//! GPU render surface (ADR-0009): mpv's GL render API draws into an off-screen FBO bound directly to an IOSurface (zero-copy), wrapped as a Metal texture and blitted onto a CAMetalLayer via Core Animation.
//! GpuSurface::new is the only place this backend can fail -- setup failure bubbles up as Err so mac::attach falls back to SoftwareSurface instead of a black player (issue #12); a mid-session resize failure just skips a tick and retries.

// mpv has no Metal render API -- NSOpenGLContext/NSOpenGLPixelFormat is the only way to a real GL context on macOS, deprecated or not (ADR-0009). Silenced, not worked around.
#![allow(deprecated)]

use super::RenderSurface;
use crate::mpv::engine::{on_render_update, RenderWaker};
use libmpv_sys::*;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSOpenGLContext, NSOpenGLPixelFormat, NSOpenGLPixelFormatAttribute, NSView, NSWindowOrderingMode,
    NSOpenGLPFAAccelerated, NSOpenGLPFAColorSize, NSOpenGLPFADoubleBuffer, NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersionLegacy,
};
use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFString};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_io_surface::IOSurfaceRef;
use objc2_metal::{
    MTLBlitCommandEncoder, MTLCommandBuffer, MTLCommandEncoder, MTLCommandQueue, MTLCreateSystemDefaultDevice, MTLDevice,
    MTLPixelFormat, MTLStorageMode, MTLTexture, MTLTextureDescriptor, MTLTextureUsage,
};
use objc2_quartz_core::{CAMetalDrawable, CAMetalLayer};
use std::ffi::c_void;
use std::os::raw::{c_char, c_int, c_uint};
use std::sync::{Arc, Mutex};

// ---- hand-declared GL/CGL FFI (ADR-0009) --------------------------------
// Small, permanently-frozen surface (deprecated since 2018, signatures unchanged) -- not worth a gl/glow dependency for ~10 calls, same precedent as software.rs's MPV_RENDER_PARAM_SW_*.
type GLenum = c_uint;
type GLuint = c_uint;
type GLint = c_int;
type GLsizei = c_int;
type CGLContextObj = *mut c_void;
type CGLError = c_int;

const GL_TEXTURE_RECTANGLE: GLenum = 0x84F5;
const GL_RGBA: GLenum = 0x1908;
const GL_BGRA: GLenum = 0x80E1;
const GL_UNSIGNED_INT_8_8_8_8_REV: GLenum = 0x8367;
const GL_FRAMEBUFFER: GLenum = 0x8D40;
const GL_COLOR_ATTACHMENT0: GLenum = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: GLenum = 0x8CD5;
const GL_TEXTURE_MIN_FILTER: GLenum = 0x2801;
const GL_TEXTURE_MAG_FILTER: GLenum = 0x2800;
const GL_LINEAR: GLenum = 0x2601;

extern "C" {
    fn CGLGetCurrentContext() -> CGLContextObj;
    fn CGLTexImageIOSurface2D(
        ctx: CGLContextObj,
        target: GLenum,
        internal_format: GLenum,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        type_: GLenum,
        io_surface: *mut c_void,
        plane: GLuint,
    ) -> CGLError;

    fn glGenTextures(n: GLsizei, textures: *mut GLuint);
    fn glDeleteTextures(n: GLsizei, textures: *const GLuint);
    fn glBindTexture(target: GLenum, texture: GLuint);
    fn glTexParameteri(target: GLenum, pname: GLenum, param: GLint);
    fn glGenFramebuffers(n: GLsizei, framebuffers: *mut GLuint);
    fn glDeleteFramebuffers(n: GLsizei, framebuffers: *const GLuint);
    fn glBindFramebuffer(target: GLenum, framebuffer: GLuint);
    fn glFramebufferTexture2D(target: GLenum, attachment: GLenum, textarget: GLenum, texture: GLuint, level: GLint);
    fn glCheckFramebufferStatus(target: GLenum) -> GLenum;
    fn glViewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei);
    fn glFlush();
}

// FBO param IS in libmpv-sys's bindings (GL API predates the software one); only the type tag string (a
// C macro bindgen never captures) needs declaring here, same as software.rs's MPV_RENDER_API_TYPE_SW.
const MPV_RENDER_API_TYPE_OPENGL: &[u8] = b"opengl\0";

/// GL/IOSurface/Metal resources sized to the current on-screen rect -- rebuilt in render() when size changes (construction doesn't know it yet, first set_rect does).
struct Sized {
    w: i32,
    h: i32,
    fbo: GLuint,
    gl_texture: GLuint,
    _io_surface: CFRetained<IOSurfaceRef>, // kept alive only, referenced via metal_texture/gl_texture
    metal_texture: Retained<ProtocolObject<dyn MTLTexture>>,
}

impl Drop for Sized {
    fn drop(&mut self) {
        unsafe {
            glDeleteFramebuffers(1, &self.fbo);
            glDeleteTextures(1, &self.gl_texture);
        }
    }
}

pub(crate) struct GpuSurface {
    render_ctx: *mut mpv_render_context,
    view: Retained<NSView>,
    gl_context: Retained<NSOpenGLContext>,
    device: Retained<ProtocolObject<dyn MTLDevice>>,
    queue: Retained<ProtocolObject<dyn MTLCommandQueue>>,
    metal_layer: Retained<CAMetalLayer>,
    sized: Mutex<Option<Sized>>, // None until first real set_rect; rebuilt when size changes
}

// See SoftwareSurface's identical doc -- render() (background thread) only touches read-only AppKit
// getters plus GL/Metal calls; every AppKit mutation happens from set_rect on the main thread.
unsafe impl Send for GpuSurface {}

impl GpuSurface {
    pub(crate) fn new(mpv: *mut mpv_handle, content_view: &NSView, waker: &Arc<RenderWaker>) -> Result<Self, String> {
        let mtm = unsafe { MainThreadMarker::new_unchecked() }; // see software.rs's note
        let zero_frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
        let view = NSView::initWithFrame(NSView::alloc(mtm), zero_frame);
        view.setWantsLayer(true);
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewNotSizable);
        view.setHidden(true);

        let device = MTLCreateSystemDefaultDevice().ok_or("MTLCreateSystemDefaultDevice returned nil")?;
        let queue = device.newCommandQueue().ok_or("MTLDevice.newCommandQueue returned nil")?;

        let metal_layer = CAMetalLayer::new();
        metal_layer.setDevice(Some(&device));
        metal_layer.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
        metal_layer.setFramebufferOnly(false); // we blit into the drawable's texture, not render into it
        view.setLayer(Some(&metal_layer)); // coerces &CAMetalLayer -> &CALayer via objc2's extern_class! super() chain

        // Off-screen GL context, no drawable/view attached -- mpv renders into our own FBO below.
        let attrs: &[NSOpenGLPixelFormatAttribute] = &[
            NSOpenGLPFAAccelerated,
            NSOpenGLPFAOpenGLProfile,
            NSOpenGLProfileVersionLegacy,
            NSOpenGLPFAColorSize,
            32,
            NSOpenGLPFADoubleBuffer,
            0, // NSOpenGLPixelFormatAttribute array is 0-terminated
        ];
        // Neither NSOpenGLPixelFormat nor NSOpenGLContext is MainThreadOnly (unlike NSView/NSWindow) -- plain AnyThread::alloc(), no marker needed.
        let attrs_ptr = std::ptr::NonNull::new(attrs.as_ptr() as *mut NSOpenGLPixelFormatAttribute).unwrap();
        let pixel_format = unsafe { NSOpenGLPixelFormat::initWithAttributes(NSOpenGLPixelFormat::alloc(), attrs_ptr) }
            .ok_or("NSOpenGLPixelFormat.initWithAttributes returned nil (no accelerated pixel format available)")?;
        let gl_context = NSOpenGLContext::initWithFormat_shareContext(NSOpenGLContext::alloc(), &pixel_format, None)
            .ok_or("NSOpenGLContext.initWithFormat_shareContext returned nil")?;
        gl_context.makeCurrentContext();

        let api_type_ptr = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *const c_char;
        let mut init_params = mpv_opengl_init_params {
            get_proc_address: Some(gl_get_proc_address),
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
        unsafe {
            let rc = mpv_render_context_create(&mut render_ctx, mpv, params.as_mut_ptr());
            if rc < 0 {
                let msg = std::ffi::CStr::from_ptr(mpv_error_string(rc)).to_string_lossy();
                return Err(format!("mpv_render_context_create (opengl): {msg} ({rc})"));
            }
            mpv_render_context_set_update_callback(render_ctx, Some(on_render_update), Arc::as_ptr(waker) as *mut c_void);
        }

        content_view.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);

        Ok(Self { render_ctx, view, gl_context, device, queue, metal_layer, sized: Mutex::new(None) })
    }

    /// (Re)builds the GL FBO + IOSurface + Metal-texture triple for w×h. Err on any setup failure -- callers treat that as "skip this frame", not a backend switch.
    fn resize(&self, w: i32, h: i32) -> Result<Sized, String> {
        self.gl_context.makeCurrentContext();

        let io_surface: CFRetained<IOSurfaceRef> = create_io_surface(w, h)?;
        let cgl_ctx = unsafe { CGLGetCurrentContext() };
        if cgl_ctx.is_null() {
            return Err("CGLGetCurrentContext returned null".into());
        }

        let mut gl_texture: GLuint = 0;
        unsafe {
            glGenTextures(1, &mut gl_texture);
            glBindTexture(GL_TEXTURE_RECTANGLE, gl_texture);
            glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_MIN_FILTER, GL_LINEAR as GLint);
            glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_MAG_FILTER, GL_LINEAR as GLint);
            let io_surface_ptr = (&*io_surface as *const IOSurfaceRef) as *mut c_void;
            let cgl_err = CGLTexImageIOSurface2D(
                cgl_ctx,
                GL_TEXTURE_RECTANGLE,
                GL_RGBA,
                w,
                h,
                GL_BGRA,
                GL_UNSIGNED_INT_8_8_8_8_REV,
                io_surface_ptr,
                0,
            );
            if cgl_err != 0 {
                glDeleteTextures(1, &gl_texture);
                return Err(format!("CGLTexImageIOSurface2D failed ({cgl_err})"));
            }
        }

        let mut fbo: GLuint = 0;
        let status = unsafe {
            glGenFramebuffers(1, &mut fbo);
            glBindFramebuffer(GL_FRAMEBUFFER, fbo);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_RECTANGLE, gl_texture, 0);
            glCheckFramebufferStatus(GL_FRAMEBUFFER)
        };
        if status != GL_FRAMEBUFFER_COMPLETE {
            unsafe {
                glDeleteFramebuffers(1, &fbo);
                glDeleteTextures(1, &gl_texture);
            }
            return Err(format!("incomplete framebuffer (status 0x{status:x})"));
        }

        let descriptor = MTLTextureDescriptor::new();
        descriptor.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
        unsafe {
            descriptor.setWidth(w as usize);
            descriptor.setHeight(h as usize);
        }
        descriptor.setStorageMode(MTLStorageMode::Shared); // required for an IOSurface-backed texture
        descriptor.setUsage(MTLTextureUsage::ShaderRead);
        let metal_texture = self
            .device
            .newTextureWithDescriptor_iosurface_plane(&descriptor, &io_surface, 0)
            .ok_or("MTLDevice.newTextureWithDescriptor:iosurface:plane: returned nil")?;

        self.metal_layer.setDrawableSize(objc2_foundation::NSSize::new(w as f64, h as f64));

        Ok(Sized { w, h, fbo, gl_texture, _io_surface: io_surface, metal_texture })
    }
}

/// mpv's OPENGL_INIT_PARAMS callback -- resolves GL function names against OpenGL.framework already loaded (mpv itself doesn't link GL libraries directly).
unsafe extern "C" fn gl_get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    // RTLD_DEFAULT: not exposed by the libc crate for this target, but a frozen <dlfcn.h> sentinel value.
    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
    unsafe { libc::dlsym(RTLD_DEFAULT, name) }
}

fn create_io_surface(w: i32, h: i32) -> Result<CFRetained<IOSurfaceRef>, String> {
    let bytes_per_element = 4i32;
    // No explicit IOSurfaceBytesPerRow: Metal requires the stride 16-byte aligned, and naive `w * 4`
    // isn't always (e.g. w=1710 -> 6840, not divisible by 16) -- crashed with a bytesPerRow validation
    // error. Omitting the key lets IOSurfaceCreate pick a correctly-aligned stride itself.
    let keys = [
        CFString::from_str("IOSurfaceWidth"),
        CFString::from_str("IOSurfaceHeight"),
        CFString::from_str("IOSurfaceBytesPerElement"),
        CFString::from_str("IOSurfacePixelFormat"),
    ];
    let values = [
        CFNumber::new_i32(w),
        CFNumber::new_i32(h),
        CFNumber::new_i32(bytes_per_element),
        CFNumber::new_i32(0x42475241), // 'BGRA' FourCC (kCVPixelFormatType_32BGRA)
    ];
    let key_refs: Vec<&CFString> = keys.iter().map(|k| &**k).collect();
    let value_refs: Vec<&CFNumber> = values.iter().map(|v| &**v).collect();
    let dict: CFRetained<CFDictionary<CFString, CFNumber>> = CFDictionary::from_slices(&key_refs, &value_refs);
    unsafe { IOSurfaceRef::new(dict.as_ref()) }.ok_or_else(|| "IOSurfaceRef::new returned nil".to_string())
}

impl RenderSurface for GpuSurface {
    fn set_rect(&self, x: f64, y_top_left: f64, w: f64, h: f64) {
        if w <= 0.0 || h <= 0.0 {
            self.view.setHidden(true);
            return;
        }
        let superview = unsafe { self.view.superview() }.expect("render surface view detached");
        let parent_bounds = superview.bounds();
        let y = parent_bounds.size.height - y_top_left - h;
        self.view.setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(w, h)));
        self.view.setHidden(false);
        self.render();
    }

    fn render(&self) {
        if self.render_ctx.is_null() {
            return; // torn down
        }
        if self.view.isHidden() {
            return;
        }
        // ponytail: point resolution, not Retina backing-store -- real upgrade work, not done for either backend.
        let bounds = self.view.bounds();
        let (w, h) = (bounds.size.width as i32, bounds.size.height as i32);
        if w <= 0 || h <= 0 {
            return;
        }

        let mut guard = self.sized.lock().unwrap();
        if !matches!(&*guard, Some(s) if s.w == w && s.h == h) {
            match self.resize(w, h) {
                Ok(sized) => *guard = Some(sized),
                Err(_) => return, // transient failure, try again next tick
            }
        }
        let Some(sized) = guard.as_ref() else { return };

        self.gl_context.makeCurrentContext();
        let mut fbo_param = mpv_opengl_fbo { fbo: sized.fbo as c_int, w, h, internal_format: 0 };
        let mut params = [
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo_param as *mut _ as *mut c_void },
            mpv_render_param { type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        unsafe {
            glBindFramebuffer(GL_FRAMEBUFFER, sized.fbo);
            glViewport(0, 0, w, h);
            let rc = mpv_render_context_render(self.render_ctx, params.as_mut_ptr());
            if rc < 0 {
                return; // no frame ready yet or a transient error, try again next tick
            }
            glFlush(); // ensures mpv's GL writes finish before Metal reads the same memory (zero-copy handoff sync)
        }

        let Some(drawable) = self.metal_layer.nextDrawable() else { return }; // layer not ready, skip this tick
        let Some(cmd_buf) = self.queue.commandBuffer() else { return };
        let Some(encoder) = cmd_buf.blitCommandEncoder() else { return };
        unsafe { encoder.copyFromTexture_toTexture(&sized.metal_texture, &drawable.texture()) };
        encoder.endEncoding();
        cmd_buf.presentDrawable(drawable.as_ref());
        cmd_buf.commit();
    }

    fn teardown(&mut self) {
        unsafe {
            mpv_render_context_set_update_callback(self.render_ctx, None, std::ptr::null_mut());
            mpv_render_context_free(self.render_ctx);
        }
        self.gl_context.makeCurrentContext(); // Sized::drop issues glDelete* calls, must land on our GL context
        *self.sized.lock().unwrap() = None; // frees the GL FBO/texture
        self.view.removeFromSuperview();
        self.render_ctx = std::ptr::null_mut();
    }
}
