'use client'

import { Button, MenuItem } from '@blueprintjs/core'
import { Suggest } from '@blueprintjs/select'

interface DvColumnPickerProps {
  id?: string
  columns: string[]
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Set when leaving this field empty would NOT actually resolve to a real
   *  column (see the `unresolved` prop on the caller side) - shows a warning
   *  style so an unmapped attribute doesn't look silently fine. */
  warning?: boolean
}

// Picks a Data Vault column by name, with type-ahead filtering over the
// columns the dbt SQL parser found (see extractColumnsFromSql in
// config-parser.ts) - plus a manual fallback: that parser is a best-effort
// static-SQL heuristic, so a real column can still be missing from
// `columns` (an unusual expression it doesn't recognize, a column added
// after the last "Connect", etc.). Typing a name that isn't in the list
// offers it as a "use as typed" entry instead of blocking entry to only
// what was auto-detected.
export function DvColumnPicker({ id, columns, value, onChange, placeholder, warning }: DvColumnPickerProps) {
  return (
    <Suggest<string>
      items={columns}
      fill
      resetOnClose
      selectedItem={value || null}
      inputProps={{
        id,
        placeholder,
        leftIcon: 'search',
        intent: warning ? 'warning' : undefined,
        rightElement: value ? (
          <Button icon="cross" minimal small onClick={() => onChange('')} title="Zurücksetzen (Auto)" />
        ) : undefined
      }}
      itemPredicate={(query, item) => item.toLowerCase().includes(query.toLowerCase())}
      itemRenderer={(item, { handleClick, handleFocus, modifiers }) => {
        if (!modifiers.matchesPredicate) return null
        return (
          <MenuItem
            key={item}
            text={item}
            roleStructure="listoption"
            active={modifiers.active}
            onClick={handleClick}
            onFocus={handleFocus}
          />
        )
      }}
      onItemSelect={(item) => onChange(item)}
      inputValueRenderer={(item) => item}
      createNewItemFromQuery={(query) => query}
      createNewItemPosition="first"
      createNewItemRenderer={(query, active, handleClick) => (
        <MenuItem
          key="dv-column-manual"
          icon="new-text-box"
          text={`"${query}" manuell verwenden`}
          roleStructure="listoption"
          active={active}
          onClick={handleClick}
        />
      )}
      noResults={<MenuItem disabled text="Keine Spalten gefunden - Suchbegriff manuell übernehmen" />}
    />
  )
}
