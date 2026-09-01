import { useQuery } from '@tanstack/react-query'
import {
  resumeItemsQuery,
  nextUpItemsQuery,
  latestMoviesQuery,
  latestShowsQuery
} from '../lib/queries'
import { Row } from '../components/Row'
import { Status } from '../components/Status'
import styles from './Home.module.css'

export function Home(): React.JSX.Element {
  const resume = useQuery(resumeItemsQuery)
  const nextUp = useQuery(nextUpItemsQuery)
  const movies = useQuery(latestMoviesQuery)
  const shows = useQuery(latestShowsQuery)

  const queries = [resume, nextUp, movies, shows]
  const isPending = queries.some((q) => q.isPending)
  const isError = queries.some((q) => q.isError)
  const empty = !isPending && !isError && queries.every((q) => !q.data?.length)

  return (
    <div className={styles.page}>
      {isError && (
        <Status
          message="Cannot reach server."
          onRetry={() => queries.forEach((q) => q.isError && q.refetch())}
          className={styles.status}
        />
      )}
      <Row title="Continue Watching" items={resume.data} wide loading={resume.isPending} />
      <Row title="Next Up" items={nextUp.data} wide loading={nextUp.isPending} />
      <Row
        title="Recently Added Movies"
        items={movies.data}
        to="/movies"
        loading={movies.isPending}
      />
      <Row title="Recently Added Shows" items={shows.data} to="/shows" loading={shows.isPending} />
      {empty && (
        <div className={styles.empty}>Nothing here yet. Add media to your Jellyfin library.</div>
      )}
    </div>
  )
}
