I genuinely like this direction. It has a clear identity, which is something many media apps lack.

You're **not building a Jellyfin replacement**. You're building **the desktop player Jellyfin deserves**.

The key constraint I'd put at the top of the document is:

> **Famto is not a media manager. It is a media player.**

That single sentence should settle almost every future feature request.

---

# Product Requirements Document (PRD)

# Famto

**Version:** 1.0
**Status:** Draft
**Author:** Salauddin Omar Sifat
**License:** MIT (Open Source)

---

# Vision

Famto is a calm, minimal desktop media player built exclusively for Jellyfin.

It focuses on one thing:

> Watching media beautifully.

Famto intentionally avoids becoming another full Jellyfin client. It does not attempt to expose every server capability or administrative feature. Instead, it provides a lightweight, fast, distraction-free playback experience with first-class Picture-in-Picture support and native desktop behavior.

Every design decision should answer one question:

> **Does this make watching media better?**

If the answer is no, the feature does not belong in Famto.

---

# Product Philosophy

## Core Values

### Fast

The application should feel instant.

- Fast startup
- Fast navigation
- Fast search
- Fast playback
- Fast resume

---

### Calm

The interface should never overwhelm users.

No banners.

No advertisements.

No giant hero carousels.

No unnecessary animations.

No clutter.

---

### Minimal

Only expose features directly related to watching videos.

English-only in v1; i18n arrives with the first real translation.

---

### Native

Famto should feel like a desktop application rather than a website inside Electron.

---

### Invisible

Users should spend almost all their time watching media—not interacting with the UI.

---

# Non Goals

Famto will **NOT** include:

- Live TV
- Music playback
- Photo viewing
- Books
- Comics
- Server administration
- Metadata editing
- User management
- Plugin management
- Dashboard
- Statistics
- Library editing
- Collection editing
- User permissions
- Casting
- Mobile support
- Browser support
- DVR
- Recording
- Themes marketplace
- Skins

---

# Target Users

Primary audience:

People who already run Jellyfin and want the fastest possible desktop playback experience.

Secondary audience:

Family members who simply want to open an application and watch something without learning Jellyfin.

---

# Supported Platforms

- macOS
- Windows
- Linux

All platforms should provide the same experience.

---

# Primary Use Cases

## Watch a movie

Launch Famto

↓

Continue Watching

↓

Click movie

↓

Watch

---

## Resume TV show

Launch

↓

Continue Watching

↓

Resume

↓

Episode starts immediately

---

## Browse

Launch

↓

Movies

↓

Search

↓

Play

---

# Success Metrics

Cold launch

- Under 2 seconds

Resume launch

- Under 1 second

Navigation latency

- Under 100ms

Search latency

- Under 100ms

Player startup

- Under 500ms (excluding network)

Memory usage idle

- < 200MB preferred

Crash rate

- < 0.1%

---

# Information Architecture

```
Login

↓

Home

├── Continue Watching

├── Recently Added Movies

├── Recently Added TV Shows

↓

Movies

↓

TV Shows

↓

Search

↓

Player

↓

Settings
```

That's the entire application.

---

# Screens

## Login

Contains:

Server URL

Username

Password

Sign In

Nothing else.

Sessions always persist (token in OS keychain via `safeStorage`). Logout in Settings is the escape hatch. Famto supports exactly one server per install in v1.

---

## Home

Contains exactly three sections.

Continue Watching

Recently Added Movies

Recently Added Shows

No banners.

No recommendations.

No trending.

No featured.

---

## Movies

Grid layout. All movie-type libraries on the server are merged into one grid; library boundaries are invisible.

Sort:

Recently Added

Alphabetical

Release Date

Search button.

---

## TV Shows

Grid.

Exactly same layout. All show-type libraries merged, same as Movies.

---

## Card Semantics

Everywhere in the app: clicking a card (or its hover play button) starts playback; clicking the card's title label opens details.

---

## Search

Global search.

Results grouped by:

Movies

TV Shows

Episodes

Instant filtering.

Keyboard navigation.

Hybrid architecture: movies/shows filtered against a local index fetched once per launch (<100ms honest); episodes searched server-side, debounced, results appended. See ADR-0001.

---

## Movie Details

Poster

Title

Runtime

Overview

Play

Resume

Subtitle selector

Audio selector

That's all.

---

## Show Details

Poster

Overview

Seasons

Episodes

Play Next Episode

Resume

---

## Player

The most important screen.

Controls:

Play

Pause

Seek

Timeline

Volume

Mute

Subtitle selection

Audio selection

Playback speed

Fullscreen

Picture in Picture

Nothing else.

---

# Picture in Picture

This is a flagship feature.

Behavior must exactly match Chromium PiP.

Requirements:

One-click activation

No dialogs

Works across all platforms

Continues playback

Supports keyboard shortcuts

Remembers playback position

Closing PiP returns to player

---

# Playback

Version 1

Electron HTML5 video.

Future

Abstract playback engine.

```
Player Interface

↓

HTML5 Player

or

MPV

or

VLC

```

The UI should never know which backend is active.

---

# Playback Features

Required

Resume

Continue Watching sync

Audio track switching

Subtitle switching

Subtitle delay

Playback speed

Fullscreen

PiP

Hardware decoding where Chromium supports it

Future

MPV backend

HDR

Advanced subtitle rendering

---

# Subtitle Settings

Users can configure:

Font Size

Font Color

Background

Outline

Shadow

Vertical Position

Opacity

Language preference

Subtitle enabled by default

These settings sync locally only.

Delay and styling apply to text subtitles only. Burned-in tracks (PGS/VOBSUB/styled ASS via transcode) show these controls disabled. Prefer text delivery from the server whenever the format allows.

---

# Navigation

Keyboard-first.

Shortcuts

```
Space

Pause

← →

Seek

↑ ↓

Volume

F

Fullscreen

P

Picture in Picture

M

Mute

Esc

Exit Fullscreen

Ctrl+F

Search
```

---

# Search

Search only:

Movies

Shows

Episodes

No people.

No collections.

No music.

---

# Sync

Supported

Watch progress

Playback position

Watched status

Continue Watching

User settings (if supported)

Not supported

Server configuration

Admin actions

Metadata changes

---

# Settings

Only one page.

Sections

## General

Launch at startup

Auto update

Theme

---

## Playback

Preferred quality

Hardware acceleration

Autoplay next episode

Remember playback speed

---

## Subtitles

Language

Color

Size

Position

Outline

Background

Opacity

---

## Server

Current server

Logout

Reconnect

---

## About

Version

GitHub

License

Acknowledgements

---

# Design System

Inspired by

Apple TV

IINA

Arc

Linear

Raycast

Goals

Large spacing

Soft corners

Muted colors

Modern typography

Minimal chrome

Animations below 150ms

No flashy effects

---

# Visual Language

Dark mode

Neutral gray surfaces

Soft shadows

Accent color only when necessary

Rounded components

Minimal borders

---

Light mode

Same principles.

---

# Electron Architecture

```
Electron Main

├── Window

├── Auto Update

├── IPC

├── Native Menu

├── PiP

└── Media Session

↓

Renderer

↓

React

↓

TanStack Router

↓

TanStack Query

↓

Jellyfin API

↓

Player Layer
```

---

# Recommended Stack

Use tanstack libraries even if alternatives are there. <https://tanstack.com/libraries>

Electron

React

TypeScript

Vite

TanStack Router

TanStack Query

Zustand

Tailwind CSS v4

shadcn/ui

Tanstack Form

Zod

Keyboard shortcuts: hand-rolled keydown map, no dependency.

electron-builder

ESLint

Prettier

Vitest

Playwright

GitHub Actions

---

# API Usage

Use only official Jellyfin APIs.

Avoid custom server modifications.

Prefer direct play whenever possible.

If transcoding is required, defer entirely to the Jellyfin server. The client should not implement custom transcoding logic or quality heuristics.

Famto sends an accurate DeviceProfile; the server decides direct-play/remux/transcode and the user never sees which.

---

# Error Handling

Human-friendly messages.

Examples:

Cannot reach server.

Incorrect password.

Playback failed.

Subtitle unavailable.

Retry should always be one click.

---

# Accessibility

Keyboard navigable

Screen reader labels

High contrast support

Scalable fonts

Visible focus indicators

Reduced motion support

---

# Open Source

License

MIT

Goals

Simple codebase

Easy contributions

Small dependency graph

Clear architecture

Excellent documentation

---

# Future Roadmap (Post-v1)

These ideas should **not** delay the initial release:

- MPV playback backend
- Discord Rich Presence
- Global media controls
- Mini player (separate from standard PiP)
- Native download support
- Skip intro (using Jellyfin markers if available)
- SponsorBlock-style community segments (if applicable)
- Plugin API (only if a compelling need emerges)

---

# Guiding Principles for Feature Requests

Every proposed feature must satisfy at least one of the following:

- Improves playback quality
- Reduces time to start watching
- Enhances desktop integration
- Simplifies the user experience
- Makes the application feel faster

If it doesn't satisfy any of these, it should be declined.

---

# Definition of Done (v1.0)

Famto 1.0 is complete when a user can:

1. Install the app on Windows, macOS, or Linux.
2. Sign in to a Jellyfin server.
3. Browse their Movies and TV Shows libraries.
4. Search for content.
5. Resume playback from where they left off.
6. Switch audio and subtitle tracks.
7. Customize subtitle appearance.
8. Enter and exit Picture-in-Picture with a single click.
9. Use keyboard shortcuts for all primary playback controls.
10. Watch media smoothly with synchronized progress back to Jellyfin.

No more, no less.

---

## One architectural decision I'd make from day one

Even though v1 uses Electron's built-in `<video>` element, **never let the UI talk directly to it**. Define a `PlaybackEngine` interface (play, pause, seek, setSubtitleTrack, enterPiP, etc.) and have the HTML5 implementation satisfy that interface.

That way, if you decide to adopt `libmpv` later for superior codec support, HDR, and subtitle rendering, the rest of Famto—the UI, state management, keyboard shortcuts, and sync logic—doesn't need to change. It keeps the codebase aligned with your philosophy of staying small while leaving room for the one thing that matters most: an even better playback experience.
