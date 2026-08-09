# frameworks/

Staging directory for the macOS-only libmpv bundle (ADR-0011).

`scripts/bundle-macos-dylibs.sh` fills this with libmpv and its whole
transitive Homebrew dylib tree during a release build, rewritten to load from
`@executable_path`. The `.dylib` files here are build output and are
gitignored.

This README is committed on purpose, and deleting it breaks the build on
macOS: `tauri.macos.conf.json` bundles this directory via a `resources` glob,
and `tauri-build` validates that glob while compiling `src-tauri` -- which
happens *before* the script has run (and never runs at all under `tauri
dev`). An empty directory would fail with "glob pattern frameworks/* path not
found or didn't match any files". Keeping one tracked file here means the
pattern always matches; it gets copied into `Photon.app` alongside the
dylibs, which is harmless.
