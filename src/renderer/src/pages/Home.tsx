import { useQuery } from '@tanstack/react-query'
import {
  resumeItemsQuery,
  nextUpItemsQuery,
  latestMoviesQuery,
  latestShowsQuery
} from '../lib/queries'
import { Row } from '../components/Row'
import styles from './Home.module.css'

export function Home(): React.JSX.Element {
  const resume = useQuery(resumeItemsQuery)
  const nextUp = useQuery(nextUpItemsQuery)
  const movies = useQuery(latestMoviesQuery)
  const shows = useQuery(latestShowsQuery)

  const queries = [resume, nextUp, movies, shows]
  const empty = queries.every((q) => !q.isPending && !q.data?.length)

  return (
    <div className={styles.page}>
      <Row title="Continue Watching" items={resume.data} wide />
      <Row title="Next Up" items={nextUp.data} wide />
      <Row title="Movies" items={movies.data} to="/movies" />
      <Row title="TV Shows" items={shows.data} to="/shows" />
      {empty && (
        <div className={styles.empty}>Nothing here yet. Add media to your Jellyfin libraries.</div>
      )}
    </div>
  )
}
