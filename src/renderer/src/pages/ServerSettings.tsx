import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { SettingsSection, SettingsRow } from './SettingsSection'
import styles from './Settings.module.css'

export function ServerSettings(): React.JSX.Element {
  const session = useSession((s) => s.session)
  const logout = useSession((s) => s.logout)
  const reset = useSettings((s) => s.reset)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <>
      <h1 className={styles.pageTitle}>Server</h1>

      <div className={styles.section}>
        <div className={styles.rows}>
          <SettingsRow
            label={session?.server ?? ''}
            hint={`Signed in as ${session?.userName ?? ''}`}
          >
            <div className={styles.buttons}>
              <button
                className={styles.ghostBtn}
                onClick={() =>
                  // don't refetch the search index: staleTime:Infinity,
                  // fetched once per launch on purpose (ADR-0001)
                  queryClient.invalidateQueries({
                    predicate: (q) => q.queryKey.join('.') !== queryKeys.search.index().join('.')
                  })
                }
              >
                Reconnect
              </button>
              <button
                className={styles.dangerBtn}
                onClick={async () => {
                  await logout()
                  navigate({ to: '/login' })
                }}
              >
                Logout
              </button>
            </div>
          </SettingsRow>
        </div>
      </div>

      <hr className={styles.hr} />

      <SettingsSection title="Danger zone">
        <SettingsRow label="Reset settings" hint="Restores all preferences to defaults">
          <button
            className={styles.dangerBtn}
            onClick={() => {
              if (confirm('Reset all settings to defaults? This does not sign you out.')) {
                reset()
              }
            }}
          >
            Reset
          </button>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
