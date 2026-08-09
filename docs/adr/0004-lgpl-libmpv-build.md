---
status: superseded by 0011-mit-source-gpl-binaries
---

# Vendor the LGPL build of libmpv, not the full GPL build

> **Superseded by [ADR-0011](0011-mit-source-gpl-binaries.md).** This was
> never implemented, and the plan below understates the work: `--enable-lgpl`
> on mpv is not enough on its own, because libmpv links ffmpeg and every
> readily available ffmpeg build (Homebrew, apt, shinchiro) is
> `--enable-gpl`. An LGPL libmpv needs an LGPL ffmpeg built alongside it, on
> three platforms, in CI. ADR-0011 takes the cheaper trade instead: Photon's
> source stays MIT, the macOS/Windows binaries are GPLv2-or-later because
> they bundle a GPL libmpv, and Linux ships no mpv code at all (it declares a
> package dependency). Kept for the reasoning about which mpv components are
> GPL-only, which is still accurate and would still apply if anyone revisits
> the LGPL route.

Bundling libmpv (ADR-0003) risks license contamination: mpv's default build is
GPL, and linking it into a compiled binary typically forces that binary's
distribution terms to GPL too (this is why IINA, which also embeds libmpv, ships
as GPLv3 despite being a from-scratch app). Photon stays MIT-licensed by vendoring
mpv's `--enable-lgpl` build instead, which drops the GPL-only components (a
handful of demuxers/filters, notably no DVD nav/CDDA) to stay LGPLv2.1+. Photon
doesn't need those pieces — it's a Jellyfin player, not a media manager, and disc
navigation was never in scope.
