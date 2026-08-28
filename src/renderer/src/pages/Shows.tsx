import { getRouteApi } from '@tanstack/react-router'
import { LibraryGrid } from '../components/LibraryGrid'

const routeApi = getRouteApi('/app/shell/shows')

export function Shows(): React.JSX.Element {
  const { sort = 'added' } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  return (
    <LibraryGrid
      type="Series"
      title="Shows"
      sort={sort}
      onSortChange={(s) => navigate({ search: { sort: s === 'added' ? undefined : s } })}
    />
  )
}
