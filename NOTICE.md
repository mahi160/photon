# Third-party licenses

Photon's own source code is MIT — see [LICENSE](LICENSE). That is true of
every file in this repository, and it does not change on any platform.

Photon plays video with [libmpv](https://mpv.io), which is
**GPLv2-or-later**. How that affects a given download depends on whether the
build ships mpv inside it (see [ADR-0011](docs/adr/0011-mit-source-gpl-binaries.md)):

| Download | Ships libmpv? | License of that download |
| --- | --- | --- |
| macOS `.dmg` / `.app` | yes, in `Contents/Resources/frameworks/` | GPLv2-or-later |
| Windows `.exe` | yes, `libmpv-2.dll` next to the binary | GPLv2-or-later |
| Linux `.deb` / `.rpm` | no — declares a dependency on `libmpv2` / `mpv-libs` | MIT |

## Corresponding source

For the macOS and Windows builds, the distribution as a whole is conveyed
under the GPL, so the corresponding source for every part of it is offered
here:

- **Photon** — this repository, <https://github.com/mahi160/photon>, MIT.
- **libmpv and its dependencies (ffmpeg, libass, libplacebo, …)** — on macOS
  these are [Homebrew](https://github.com/Homebrew/homebrew-core)'s `mpv`
  formula and its dependency tree; on Windows, the prebuilt package from
  [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake).
  Both build from unmodified upstream sources — mpv's own is at
  <https://github.com/mpv-player/mpv>. Photon patches no mpv code; the only
  change made to the shipped libraries is `install_name_tool` rewriting
  macOS dylib load paths (`scripts/bundle-macos-dylibs.sh`), which does not
  alter any code.

The Linux packages contain no mpv code and are MIT on their own; the libmpv
they load at runtime comes from your distribution under its own terms.

## Note on Jellyfin

Photon talks to Jellyfin servers over the documented HTTP API. It contains no
code from jellyfin-web (GPLv2), Jellyfin Kodi (GPLv3), or any other Jellyfin
client — comments in `src/renderer/src/lib/jellyfin.ts` and
`src/renderer/src/player/session.ts` describe what other clients do on the
wire, which is API behaviour, not copied source.
