fn main() {
    // ponytail: pkg-config probe against whatever `mpv` dev headers/libs are
    // on this machine (Homebrew mpv, GPL build). Ticket #3's real release
    // build needs a vendored --enable-lgpl libmpv instead (ADR-0004) — this
    // is fine for local dev, not for a distributed binary.
    pkg_config::probe_library("mpv").expect("libmpv not found via pkg-config (brew install mpv)");
    tauri_build::build();
}
