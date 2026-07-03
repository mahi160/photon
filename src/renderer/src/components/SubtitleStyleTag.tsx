import { useSettings } from '../stores/settings'

// styles native ::cue rendering from user settings; text subtitles only —
// burned-in subs are pixels in the video and can't be styled (see CONTEXT.md)
export function SubtitleStyleTag(): React.JSX.Element {
  const { subtitleStyle: s } = useSettings()
  const css = `
    video::cue {
      font-size: ${s.fontSize}%;
      color: ${s.color};
      background-color: ${s.background};
      opacity: ${s.opacity};
      ${s.outline ? 'text-shadow: 0 0 3px #000, 0 0 3px #000, 0 0 3px #000;' : ''}
    }
    video::-webkit-media-text-track-container {
      transform: translateY(-${s.verticalPosition}%);
    }
  `
  return <style>{css}</style>
}
