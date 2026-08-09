# Staged copy of mahi160/homebrew-photon's Casks/photon.rb.
#
# Not used by this repo's build -- it lives here only so the ADR-0011 change
# (dropping `depends_on formula: "mpv"`, now that Photon.app bundles its own
# libmpv) is reviewable alongside the change that makes it true. Copy it over
# to the tap and bump `version`/`sha256` when the first release containing
# the bundled dylibs is cut; delete this file once that's done.
cask "photon" do
  arch arm: "aarch64"

  version "2.0.0-pre.11"
  sha256 "997124c40ab990408f9a186b7f6b58824583ae5f6e13b94e0c9f362b12c609b5"

  url "https://github.com/mahi160/photon/releases/download/v#{version}/Photon_#{version}_#{arch}.dmg"
  name "Photon"
  desc "Calm, minimal desktop media player for Jellyfin"
  homepage "https://github.com/mahi160/photon"

  # :github_latest resolves against GitHub's "latest release" (which by
  # definition skips prereleases) -- deliberate: Photon's current v2 builds
  # are all flagged prerelease (github.com/mahi160/photon#27, Linux hardware
  # decode unverified) and this tap intentionally doesn't auto-bump onto
  # a pre.N build. Bump this cask's `version`/`sha256` by hand until the
  # first real stable release ships, at which point livecheck picks it up.
  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on :macos
  # arm64-only for now -- Photon's release pipeline only builds on
  # macos-latest (arm64), no Intel artifact exists yet
  # (mahi160/photon .github/workflows/release.yml, build-macos job).
  depends_on arch: :arm64
  # No `depends_on formula: "mpv"`: as of ADR-0011 Photon.app ships libmpv and
  # its whole dylib tree in Contents/Resources/frameworks/ with @executable_path
  # load commands, so it no longer dyld-aborts on a Mac without Homebrew's mpv.
  # Anyone who installed an older cask version already has the mpv formula --
  # it just goes unused, and `brew autoremove` will clear it.

  app "Photon.app"

  # Photon's macOS build is ad-hoc signed, not notarized (no paid Apple
  # Developer account) -- Gatekeeper blocks a plain downloaded/unzipped app
  # in that state. This is the same one-time fix documented in Photon's own
  # AGENTS.md, run automatically instead of by hand.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Photon.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/io.github.mahi160.Photon",
    "~/Library/Caches/io.github.mahi160.Photon",
    "~/Library/Preferences/io.github.mahi160.Photon.plist",
    "~/Library/Saved Application State/io.github.mahi160.Photon.savedState",
  ]
end
