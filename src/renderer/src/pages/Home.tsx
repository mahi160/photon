import { useQuery } from '@tanstack/react-query'
import { resumeItemsQuery, latestMoviesQuery, latestShowsQuery } from '../lib/queries'
import { Row } from '../components/Row'

export function Home(): React.JSX.Element {
  const resume = useQuery(resumeItemsQuery)
  const movies = useQuery(latestMoviesQuery)
  const shows = useQuery(latestShowsQuery)

  const empty =
    !resume.isPending &&
    !movies.isPending &&
    !shows.isPending &&
    !resume.data?.length &&
    !movies.data?.length &&
    !shows.data?.length

  return (
    <div className="py-8">
      <Row title="Continue Watching" items={resume.data} wide />
      <Row title="Movies" items={movies.data} to="/movies" />
      <Row title="TV Shows" items={shows.data} to="/shows" />
      {empty && (
        <div className="flex h-64 items-center justify-center text-neutral-500">
          Nothing here yet. Add media to your Jellyfin libraries.
        </div>
      )}
    </div>
  )
}
