'use client'

import { Spinner, NonIdealState, Button } from '@blueprintjs/core'
import { Header } from './Header'

interface PageLayoutProps {
  /** Seitentitel für Header */
  title: string
  /** Breadcrumb-Pfad für Header */
  breadcrumb: string[]
  /** Seiteninhalt (optional bei loading/error states) */
  children?: React.ReactNode
  /** Aktions-Buttons im Header (z.B. Erstellen-Button) */
  actions?: React.ReactNode
  /** Ladezustand */
  loading?: boolean
  /** Ladetext */
  loadingText?: string
  /** Fehlermeldung */
  error?: string | null
  /** Callback für Retry bei Fehler */
  onRetry?: () => void
}

/**
 * Einheitliches Seitenlayout für alle Seiten.
 * 
 * Struktur:
 * - Fragment als Wrapper
 * - Header mit Titel und Breadcrumb
 * - page-content div für Inhalt (mit korrektem Hintergrund)
 * 
 * @example
 * <PageLayout title="History" breadcrumb={['Data Management', 'History']}>
 *   <KpiGrid>
 *     <KpiCard label="Total" value={100} />
 *   </KpiGrid>
 *   <div className="section-header">
 *     <h2>Überschrift</h2>
 *   </div>
 *   <div className="data-table-container">
 *     <HTMLTable>...</HTMLTable>
 *   </div>
 * </PageLayout>
 */
export function PageLayout({
  title,
  breadcrumb,
  children,
  actions,
  loading = false,
  loadingText = 'Laden...',
  error = null,
  onRetry
}: PageLayoutProps) {
  // Loading State
  if (loading) {
    return (
      <>
        <Header title={title} breadcrumb={breadcrumb} actions={actions} />
        <div className="page-content" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <Spinner size={40} />
          <p style={{ marginTop: 12 }}>{loadingText}</p>
        </div>
      </>
    )
  }

  // Error State
  if (error) {
    return (
      <>
        <Header title={title} breadcrumb={breadcrumb} actions={actions} />
        <div className="page-content">
          <NonIdealState
            icon="error"
            title="Fehler beim Laden"
            description={error}
            action={onRetry ? <Button intent="primary" onClick={onRetry}>Erneut versuchen</Button> : undefined}
          />
        </div>
      </>
    )
  }

  // Normal Content
  return (
    <>
      <Header title={title} breadcrumb={breadcrumb} actions={actions} />
      <div className="page-content">
        {children}
      </div>
    </>
  )
}
