import { getRouteApi } from '@tanstack/react-router'
import { LibraryGrid } from '../components/LibraryGrid'

const routeApi = getRouteApi('/app/shell/movies')

export function Movies(): React.JSX.Element {
  const { sort = 'added' } = routeApi.useSearch()
  const navigate = routeApi.useNavigate()
  return (
    <LibraryGrid
      type="Movie"
      title="Movies"
      sort={sort}
      onSortChange={(s) => navigate({ search: { sort: s === 'added' ? undefined : s } })}
    />
  )
}
