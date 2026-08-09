fn main() {
    // ponytail: pkg-config probe against whatever `mpv` dev headers/libs are
    // on this machine (Homebrew mpv on macOS, apt's libmpv-dev on Linux --
    // both full GPL builds, which is deliberate: ADR-0011 keeps Photon's
    // source MIT and accepts GPL binaries rather than building an LGPL
    // libmpv+ffmpeg in CI). On macOS the release bundle then vendors this
    // exact tree into Photon.app (scripts/bundle-macos-dylibs.sh); on Linux
    // nothing is bundled and the package depends on the distro's libmpv.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pkg_config::probe_library("mpv")
        .expect("libmpv not found via pkg-config (macOS: brew install mpv, Linux: apt install libmpv-dev)");

    // No epoxy probe: mpv's GL entry points now come from the display server's own
    // resolver (eglGetProcAddress / glXGetProcAddressARB, dlopen'd at runtime in
    // mpv/linux/mod.rs) because libepoxy's dispatch pointers are never NULL and
    // libmpv needs NULL to detect a missing function. The old
    // `cargo:rustc-link-lib=epoxy` line was dead weight anyway -- nothing
    // referenced an epoxy symbol at link time, so --as-needed dropped it (no
    // libepoxy NEEDED entry in the shipped binary).

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

        // mpv.lib above only satisfies the linker; libmpv-2.dll has to ship
        // next to the exe or the installed app dies at startup on a machine
        // that never had mpv (ADR-0011). tauri.windows.conf.json lists it as
        // a bundle resource, and tauri_build::build() below *validates that
        // path exists* -- so staging it has to happen here, before that call,
        // rather than as a CI step. Doing it in build.rs also means a plain
        // `cargo check` works for anyone who set MPV_LIB_DIR, with no extra
        // manual copy.
        let dll = std::path::Path::new(&lib_dir).join("libmpv-2.dll");
        if dll.exists() {
            std::fs::copy(&dll, "libmpv-2.dll").expect("failed to stage libmpv-2.dll for bundling");
        } else {
            panic!("libmpv-2.dll not found in MPV_LIB_DIR ({lib_dir}) -- it must ship beside the exe");
        }
        println!("cargo:rerun-if-changed={}", dll.display());
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
