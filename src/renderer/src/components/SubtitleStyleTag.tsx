import { useSettings } from '../stores/settings'

// styles native ::cue rendering from user settings; text subtitles only —
// burned-in subs are pixels in the video and can't be styled (see CONTEXT.md)
export function SubtitleStyleTag(): React.JSX.Element {
  const { subtitleStyle: s } = useSettings()
  // 0.8 baseline: Chromium's native cue size (~5% of video height) reads large
  // on a desktop — the user's 100% maps to 80% of native, slider still scales.
  const css = `
    video::cue {
      font-size: ${Math.round(s.fontSize * 0.8)}%;
      color: ${s.color};
      background-color: ${s.background};
      opacity: ${s.opacity};
      ${s.outline ? 'text-shadow: 0 0 3px #000, 0 0 3px #000, 0 0 3px #000;' : ''}
    }
    video::-webkit-media-text-track-container {
      transform: translateY(-${s.verticalPosition}%);
    }
  `
  // no width/margin overrides on -webkit-media-text-track-display: the cue box
  // is absolutely positioned by the UA and shrinking it anchors it left,
  // pushing subtitles off-center — native rendering is already centered
  return <style>{css}</style>
}
