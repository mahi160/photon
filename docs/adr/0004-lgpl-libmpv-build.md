# Vendor the LGPL build of libmpv, not the full GPL build

Bundling libmpv (ADR-0003) risks license contamination: mpv's default build is
GPL, and linking it into a compiled binary typically forces that binary's
distribution terms to GPL too (this is why IINA, which also embeds libmpv, ships
as GPLv3 despite being a from-scratch app). Photon stays MIT-licensed by vendoring
mpv's `--enable-lgpl` build instead, which drops the GPL-only components (a
handful of demuxers/filters, notably no DVD nav/CDDA) to stay LGPLv2.1+. Photon
doesn't need those pieces — it's a Jellyfin player, not a media manager, and disc
navigation was never in scope.
