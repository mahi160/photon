fn main() {
    // ponytail: pkg-config probe against whatever `mpv` dev headers/libs are
    // on this machine (Homebrew mpv on macOS, apt's libmpv-dev on Linux --
    // both full GPL builds). Ticket #3's real release build needs a vendored
    // --enable-lgpl libmpv instead (ADR-0004) — this is fine for local dev,
    // not for a distributed binary.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pkg_config::probe_library("mpv")
        .expect("libmpv not found via pkg-config (macOS: brew install mpv, Linux: apt install libmpv-dev)");

    // Windows has no pkg-config/vcpkg story for libmpv (a vcpkg port was
    // proposed and closed unmerged: microsoft/vcpkg#40587, "very hard to
    // build on windows with msvc or msys2 gcc") -- release.yml's
    // build-windows job instead downloads a prebuilt dev package and
    // generates an MSVC-compatible import lib itself (mpv's own documented
    // route, DOCS/compile-windows.md > "Linking libmpv with MSVC Programs"),
    // then points here via MPV_LIB_DIR. Unverified end-to-end (no Windows
    // box to test against) -- see that job's own comments.
    #[cfg(target_os = "windows")]
    {
        let lib_dir = std::env::var("MPV_LIB_DIR")
            .expect("set MPV_LIB_DIR to the folder containing mpv.lib (see release.yml's build-windows job)");
        println!("cargo:rustc-link-search=native={lib_dir}");
    }

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
