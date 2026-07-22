fn main() {
    // ponytail: pkg-config probe against whatever `mpv` dev headers/libs are
    // on this machine (Homebrew mpv, GPL build). Ticket #3's real release
    // build needs a vendored --enable-lgpl libmpv instead (ADR-0004) — this
    // is fine for local dev, not for a distributed binary.
    pkg_config::probe_library("mpv").expect("libmpv not found via pkg-config (brew install mpv)");

    // GpuSurface's own hand-declared CGL/OpenGL FFI (ADR-0009) calls C
    // functions (not Obj-C classes resolved at runtime), so unlike
    // AppKit/QuartzCore -- already linked transitively via `tauri`/`wry`'s
    // own WKWebView/window use -- these need an explicit link line.
    // IOSurface/Metal similarly aren't pulled in by anything else this crate
    // links today.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        for framework in ["OpenGL", "IOSurface", "Metal", "CoreGraphics"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }

    tauri_build::build();
}
