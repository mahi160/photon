fn main() {
    // ponytail: hardcoded pkg-config probe, good enough for a throwaway spike.
    // Real port (ticket #3) needs a vendored --enable-lgpl libmpv build instead
    // of whatever `mpv` pkg-config resolves to on the dev machine.
    pkg_config::probe_library("mpv").expect("libmpv not found via pkg-config (brew install mpv)");
    tauri_build::build();
}
