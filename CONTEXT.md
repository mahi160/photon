# Famto

A calm, minimal desktop media player built exclusively for Jellyfin. It is a media player, not a media manager.

## Language

**Server**:
The single Jellyfin server Famto is signed in to. Exactly one per install in v1.
_Avoid_: Instance, backend, connection

**Card**:
A poster tile anywhere in the app. Clicking the card (or its hover play button) starts playback; clicking its title label opens details. Same semantics everywhere.
_Avoid_: Tile, thumbnail, item

**Movies / Shows**:
The two browsable catalogs. Each merges every server library of its type into one grid; library boundaries are invisible in Famto.
_Avoid_: Library (as a UI concept), collection

**Text Subtitle**:
A subtitle track the server can deliver as text (e.g. converted to VTT). Only text subtitles support delay and appearance styling.
_Avoid_: Soft sub, external sub

**Burned-in Subtitle**:
A subtitle track rendered into the video by the server transcoder (PGS/VOBSUB/styled ASS). Delay and styling controls are disabled for these.
_Avoid_: Hardsub, image sub

**Continue Watching**:
The server-provided list of partially watched items, ordered by recency. The sole resume surface in Famto — there is no separate "resume last" concept.
_Avoid_: Resume Last Playback, resume list
