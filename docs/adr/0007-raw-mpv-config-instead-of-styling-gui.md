# Raw mpv config passthrough instead of a subtitle styling GUI

mpv-only rendering (ADR-0003/0005) means subtitle appearance is no longer CSS
`::cue` (`SubtitleStyleTag.tsx`) but mpv's own `sub-*` properties, which don't map
1:1 onto the old font/color/size/opacity/position sliders. Rather than rebuild a
bespoke GUI mapped property-by-property onto mpv's model, Photon ships one sane
default subtitle style and exposes a raw mpv-config passthrough (a text field
whose contents become extra mpv options/config on launch) for anyone who wants
more. `SubtitleSettings.tsx`'s granular styling page is removed. Existing
playback shortcuts ([ / ] delay, < / > speed, etc.) are unchanged — they now
call mpv's native properties instead of DOM APIs, no new shortcuts introduced.
