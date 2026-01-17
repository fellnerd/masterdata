'use client'

import { ReactNode } from 'react'

interface SectionHeaderProps {
  /** Überschrift der Section */
  title: string
  /** Aktionen (Buttons, Filter, etc.) rechts */
  actions?: ReactNode
}

/**
 * Einheitlicher Section Header für alle Listen-Seiten.
 * 
 * @example
 * <SectionHeader 
 *   title="Entity Definitions"
 *   actions={
 *     <>
 *       <HTMLSelect ... />
 *       <Button icon="add" intent="primary">New Entity</Button>
 *     </>
 *   }
 * />
 */
export function SectionHeader({ title, actions }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <h2 className="bp5-heading">{title}</h2>
      {actions && (
        <div className="section-actions">
          {actions}
        </div>
      )}
    </div>
  )
}
