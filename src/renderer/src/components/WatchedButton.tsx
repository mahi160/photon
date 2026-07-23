import { Check } from 'reicon-react'
import { IconToggle } from './IconToggle'
import { useToggleWatched } from '../lib/itemMutations'
import type { BaseItem } from '../lib/jellyfin'

export function WatchedButton({
  item,
  className,
  activeClassName,
  stopPropagation = false
}: {
  item: Pick<BaseItem, 'Id'> & { UserData?: BaseItem['UserData'] }
  className: string
  activeClassName: string
  stopPropagation?: boolean // card grids/episode rows: the button sits inside a clickable row/card
}): React.JSX.Element {
  const toggle = useToggleWatched(item)
  const active = item.UserData?.Played ?? false
  return (
    <IconToggle
      active={active}
      labelOn="Mark unwatched"
      labelOff="Mark watched"
      icon={<Check />}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        toggle.mutate(!active)
      }}
      className={className}
      activeClassName={activeClassName}
    />
  )
}
