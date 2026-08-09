#!/usr/bin/env bash
#
# Copy libmpv and its whole transitive Homebrew dylib tree next to the built
# binary and rewrite every absolute /opt/homebrew path to @executable_path,
# so the shipped Photon.app runs on a Mac that has never had `brew install
# mpv` (ADR-0011).
#
# Runs from tauri.macos.conf.json's `beforeBundleCommand`, i.e. after the
# Rust binary is linked but before the bundler packs Photon.app -- the only
# window where this can happen. Post-processing the .app instead does not
# work: `tauri bundle --bundles dmg` regenerates and then *deletes* the .app
# it was handed, so anything patched into it is lost before the .dmg is cut.
#
# The dylibs land in src-tauri/frameworks/ and get into the bundle via the
# `resources` glob in tauri.macos.conf.json (a glob, not bundle.macOS.frameworks'
# fixed list, because these filenames carry soname versions -- libavcodec.62,
# libplacebo.360 -- that change under us every time Homebrew bumps ffmpeg).
# That directory keeps a committed README.md so the glob still matches before
# this script has ever run -- see src-tauri/frameworks/README.md.
set -euo pipefail

[[ "$(uname -s)" == "Darwin" ]] || exit 0

cd "$(dirname "$0")/.."

BIN="src-tauri/target/release/photon"
DEST="src-tauri/frameworks"
# Where the dylibs sit relative to the executable inside Photon.app. Tauri
# puts `resources` under Contents/Resources/ preserving their relative path,
# and the binary is Contents/MacOS/photon.
PREFIX="@executable_path/../Resources/frameworks"

[[ -f "$BIN" ]] || { echo "bundle-macos-dylibs: no binary at $BIN" >&2; exit 1; }

# Seed from pkg-config, the same probe build.rs links against -- not from the
# binary's own load commands. Re-running this script (any second `tauri
# bundle` without a rebuild in between) sees a binary already pointing at
# @executable_path, which would leave nothing to collect.
MPV_LIB="$(pkg-config --variable=libdir mpv)/libmpv.2.dylib"
[[ -f "$MPV_LIB" ]] || { echo "bundle-macos-dylibs: libmpv not found at $MPV_LIB" >&2; exit 1; }

# Clear previous output only -- the directory itself, and its committed
# README.md, have to survive (deleting them breaks compilation, not just
# bundling).
mkdir -p "$DEST"
rm -f "$DEST"/*.dylib

# Absolute paths only. /usr/lib and /System are OS-provided (dyld shared
# cache) and must NOT be copied -- they are guaranteed present and bundling
# them breaks on OS upgrades. @executable_path deps are ours, already
# bundled. @rpath/@loader_path would need rpath resolution to follow;
# Homebrew doesn't emit them for this tree, so warn rather than pretend.
deps_of() {
  local dep self
  self="$(basename "$1")"
  while read -r dep; do
    # otool lists a dylib's own id as its first entry -- skip it, or the
    # rewrite pass below tries to make every library depend on itself.
    [[ "$(basename "$dep")" == "$self" ]] && continue
    case "$dep" in
      /usr/lib/* | /System/*) continue ;;
      "$PREFIX"/*) echo "$dep" ;;
      @*) echo "bundle-macos-dylibs: unresolvable dep '$dep' in $1" >&2 ;;
      *) echo "$dep" ;;
    esac
  done < <(otool -L "$1" | tail -n +2 | awk '{print $1}')
}

# install_name_tool always warns that it invalidated the code signature; we
# re-sign everything below, so that one line is noise. Anything else it says
# is not.
rename() {
  install_name_tool "$@" 2> >(grep -v 'will invalidate the code signature' >&2)
}

collect() {
  local lib="$1" base dep
  base="$(basename "$lib")"
  [[ -e "$DEST/$base" ]] && return 0
  [[ -f "$lib" ]] || { echo "bundle-macos-dylibs: missing $lib" >&2; exit 1; }
  cp "$lib" "$DEST/$base"
  chmod u+w "$DEST/$base"
  while read -r dep; do
    # Skip anything already rewritten to @executable_path -- that only shows
    # up on a rebuild against a previously patched copy, never on a fresh one.
    [[ -n "$dep" && "$dep" != @* ]] && collect "$dep"
  done < <(deps_of "$lib")
}

collect "$MPV_LIB"

compgen -G "$DEST/*.dylib" > /dev/null || { echo "bundle-macos-dylibs: nothing collected" >&2; exit 1; }

# Rewrite: every collected dylib gets an @executable_path id, and every
# reference to a sibling we also collected is repointed at the bundle copy.
for lib in "$DEST"/*.dylib; do
  base="$(basename "$lib")"
  rename -id "$PREFIX/$base" "$lib"
  while read -r dep; do
    depbase="$(basename "$dep")"
    [[ -e "$DEST/$depbase" ]] && rename -change "$dep" "$PREFIX/$depbase" "$lib"
  done < <(deps_of "$lib")
done

while read -r dep; do
  depbase="$(basename "$dep")"
  [[ -e "$DEST/$depbase" ]] && rename -change "$dep" "$PREFIX/$depbase" "$BIN"
done < <(deps_of "$BIN")

# install_name_tool invalidates the existing signature, and arm64 refuses to
# load unsigned code -- so every patched file needs an ad-hoc re-sign. Tauri
# signs the outer .app afterwards; it does not descend into Resources.
for lib in "$DEST"/*.dylib; do
  codesign --force --sign - "$lib" 2>/dev/null
done
codesign --force --sign - "$BIN" 2>/dev/null

# Nothing in the bundle may still point outside it. A leftover Homebrew path
# in a *nested* dylib is the dangerous case -- the app still launches on this
# machine and only dies on a Mac without that Cellar -- so check every file,
# not just the binary.
leaks=0
for f in "$BIN" "$DEST"/*.dylib; do
  if otool -L "$f" | tail -n +2 | grep -q "/opt/homebrew\|/usr/local/opt"; then
    echo "bundle-macos-dylibs: $f still references Homebrew:" >&2
    otool -L "$f" | tail -n +2 | grep "/opt/homebrew\|/usr/local/opt" >&2
    leaks=1
  fi
done
[[ "$leaks" -eq 0 ]] || exit 1

echo "bundle-macos-dylibs: bundled $(ls "$DEST"/*.dylib | wc -l | tr -d ' ') dylibs ($(du -sh "$DEST" | cut -f1))"
