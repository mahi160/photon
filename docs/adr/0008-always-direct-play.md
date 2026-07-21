# Always request direct play, let mpv own embedded track selection

The old HTML5 `<video>` engine could only ever play a container's default
audio track and could only show a non-text subtitle (PGS/VOBSUB/styled ASS)
by asking the server to burn it into transcoded pixels — so the client asked
for a server-side transcode (`EnableDirectPlay: false`) the moment the user
picked a non-default audio track or a non-text subtitle, even when the
source itself was perfectly direct-playable.

mpv (ADR-0003) demuxes the exact same file the server's PlaybackInfo
negotiation resolves, and can select any embedded audio/subtitle track
itself via its own track-list (`aid`/`sid` properties) — no server remux
needed for either case. Photon now never sends `EnableDirectPlay`/
`EnableDirectStream` overrides and never asks for a specific track as a
reason to transcode; `DeviceProfile` claims the real, broad codec set
ffmpeg (mpv's decoder backend) supports instead of probing the webview's
`MediaSource.isTypeSupported()`. The server still decides direct-play vs.
transcode (PRD: API Usage) — this only removes the *client-manufactured*
reasons to ask for the latter.

`engine.selectAudioTrack`/`engine.selectEmbeddedSubtitleTrack` (see
`player/engine.ts`) resolve a Jellyfin `MediaStream.Index` against mpv's own
track-list for the file it's currently demuxing. That mapping only holds
when the source actually is direct-played: a genuine server-forced
Transcode fallback (exotic codec, bitrate cap) re-encodes into a track
layout mpv never sees the source side of — a transcode's audio is a single
negotiated track, and (since `DeviceProfile` declares no Encode subtitle
profile) a non-text subtitle only exists there because the server burned it
into that stream's pixels. mpv has no property that reaches either case.

Switching in that fallback therefore falls back to the pre-mpv mechanism: a
fresh `PlaybackInfo` negotiation with the new audio/subtitle index, same as
before mpv could select embedded tracks itself
(`embeddedSubtitleSwitchNeedsReload` in `player/session.ts` decides when a
subtitle switch needs this; an audio switch always does under Transcode).
Direct play never takes this path — mpv always switches its own track
instantly there, no reload.
