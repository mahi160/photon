import { Heart } from 'reicon-react'
import { IconToggle } from './IconToggle'
import { useToggleFavorite } from '../lib/itemMutations'
import type { BaseItem } from '../lib/jellyfin'

export function FavoriteButton({
  item,
  className,
  activeClassName,
  stopPropagation = false
}: {
  item: Pick<BaseItem, 'Id'> & { UserData?: BaseItem['UserData'] }
  className: string
  activeClassName: string
  stopPropagation?: boolean // card grids: the button sits inside a clickable row/card
}): React.JSX.Element {
  const toggle = useToggleFavorite(item)
  const active = item.UserData?.IsFavorite ?? false
  return (
    <IconToggle
      active={active}
      labelOn="Remove from favorites"
      labelOff="Add to favorites"
      icon={<Heart weight={active ? 'Filled' : 'Outline'} />}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        toggle.mutate(!active)
      }}
      className={className}
      activeClassName={activeClassName}
    />
  )
}
