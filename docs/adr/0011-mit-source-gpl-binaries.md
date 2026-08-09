---
status: accepted
supersedes: 0004-lgpl-libmpv-build
---

# MIT source, GPL binaries: bundle libmpv on macOS/Windows, depend on it on Linux

ADR-0004 planned to vendor mpv's `--enable-lgpl` build so the shipped binary
could stay permissively licensed. It was never wired up, and the reason is
that its true cost was understated: `--enable-lgpl` on mpv is not sufficient
on its own, because libmpv links ffmpeg, and Homebrew/apt/shinchiro ffmpeg
builds are all `--enable-gpl` (x264, x265). A genuinely LGPL libmpv needs an
LGPL ffmpeg built alongside it, on three platforms, in CI. That is a build
pipeline, not a flag.

We are buying nothing with it. Photon is a fully open-source hobby player;
the only right GPL takes away is someone's ability to ship a closed fork of
a Photon *binary*. So: accept GPL binaries, and separate the two licensing
questions that ADR-0004 ran together.

**Photon's own source code stays MIT.** We hold the copyright on it; linking
against a GPL library does not retroactively relicense the source, it only
constrains how the *combination* may be conveyed. Anyone can still clone this
repo and reuse the Jellyfin client, the search index, or the mpv render-API
embedding under MIT. Keeping this requires ongoing discipline about one
thing, and it is not the linker: **do not copy code out of jellyfin-web
(GPLv2) or Jellyfin Kodi (GPLv3)**. Describing another client's wire
behaviour in a comment is fine and there are several such comments in
`jellyfin.ts`/`session.ts`; pasting its source is what would actually cost us
MIT. (jellyfin-mpv-shim is GPLv3 for exactly this reason — it began as MIT
and inherited GPL from Jellyfin Kodi, not from libmpv.)

**Distributed binaries are GPLv2-or-later wherever we ship libmpv inside
them**, which is macOS and Windows. GPL's substantive obligation is offering
corresponding source, and the repo is public, so compliance is a `NOTICE.md`
plus a link to the exact mpv build. Linux ships no mpv code at all — the
`.deb`/`.rpm` declare `libmpv2`/`mpv-libs` as a package dependency, so the
user's package manager performs the combination and the package itself stays
MIT.

Linux keeps the dependency rather than bundling for a second, harder reason:
libmpv drags in libva/libdrm, and those must resolve to the host's copies to
match the host's GPU driver. Vendoring them is what made Tauri's AppImage
bundler silently kill hardware decode (see the packaging notes in AGENTS.md) —
bundling libmpv on Linux walks back into the same trap, on machines we do not
own, failing as "no hardware decode" rather than as a crash. The dependency
also means distro security updates for ffmpeg arrive without us cutting a
release, which is the real recurring cost of bundling that we now accept on
two platforms.

macOS bundling is what makes this ADR worth doing at all: it fixes a live
crash. The binary's dyld load command was an absolute path into the Homebrew
Cellar of whichever CI runner built it, so the `.dmg` failed at launch with
`Library not loaded: .../libmpv.2.dylib` on any Mac without a matching `brew
install mpv` — and would have kept failing even *with* mpv installed, at the
first version bump. `scripts/bundle-macos-dylibs.sh` now copies libmpv and
its transitive tree (48 dylibs, ~60 MB, taking the `.dmg` from 4.6 MB to
29 MB) into `Contents/Resources/frameworks/` and rewrites every load command
to `@executable_path`. It runs from `beforeBundleCommand` because that is the
only available hook: post-processing the built `.app` does not survive, since
`tauri bundle --bundles dmg` regenerates and then deletes the `.app` before
cutting the image.

Consequences: the `.dmg` is now standalone, and the Homebrew cask no longer
needs `depends_on formula: "mpv"` (kept as a no-op for already-installed
users, dropped on the next cask update). README stops telling `.dmg` users to
install mpv. Ad-hoc signing and the `xattr -cr` Gatekeeper dance are
unchanged and unrelated — the dylibs are individually ad-hoc signed by the
script because `install_name_tool` invalidates signatures and arm64 refuses
to load unsigned code. Bundle size on macOS/Windows is now ours to watch, and
an ffmpeg CVE is ours to ship a release for.
