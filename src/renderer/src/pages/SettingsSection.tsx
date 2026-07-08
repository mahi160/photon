import React from 'react'
import styles from './Settings.module.css'

export interface SettingsSectionProps {
  title: string
  children: React.ReactNode
}

export function SettingsSection({ title, children }: SettingsSectionProps): React.JSX.Element {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}

export interface SettingsRowProps {
  label: string
  children?: React.ReactNode
  hint?: string
}

export function SettingsRow({ label, children, hint }: SettingsRowProps): React.JSX.Element {
  return (
    <div className={styles.row}>
      <div>
        <div className={styles.label}>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}
