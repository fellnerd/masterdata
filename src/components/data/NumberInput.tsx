'use client'

import { useState } from 'react'
import { InputGroup } from '@blueprintjs/core'

interface NumberInputProps {
  id?: string
  /** Current value: a number, a numeric string, or empty. */
  value: number | string | null | undefined
  /** Receives the parsed number, or '' when the field is empty / not (yet) a valid number. */
  onChange: (next: number | '') => void
  integer?: boolean
  placeholder?: string
  intent?: 'primary' | 'none'
}

// What may be typed: an optional minus, digits, ONE decimal separator ("," or
// ".") and an optional exponent ("1.2e-8" - imported GWP values look like
// that). Blueprint's NumericInput only lets "." through (its default allow-list
// is [0-9+-.eE]), so a German user typing "1,5" got nothing at all.
const DECIMAL_TYPING_RE = /^-?\d*[.,]?\d*([eE][-+]?\d*)?$/
const INTEGER_TYPING_RE = /^-?\d*$/

function parse(text: string): number | '' {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return ''
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : ''
}

function toText(value: NumberInputProps['value']): string {
  return value === null || value === undefined ? '' : String(value)
}

// Number field that accepts both "," and "." as decimal separator and always
// hands a real number (dot-normalised) to the caller, so the stored value is a
// canonical JSON number no matter which separator the user typed. The text the
// user typed stays as typed (no reformatting under the cursor).
export function NumberInput({ id, value, onChange, integer, placeholder, intent }: NumberInputProps) {
  const [text, setText] = useState(() => toText(value))
  const [seenValue, setSeenValue] = useState(value)

  // The value can change from outside (form reset, switching record): when it
  // no longer matches what the text parses to, show the new value. Adjusting
  // state while rendering is the documented alternative to an effect here.
  if (value !== seenValue) {
    setSeenValue(value)
    const parsed = parse(text)
    const incoming = value === null || value === undefined || value === '' ? '' : Number(value)
    if (parsed !== incoming) setText(toText(value))
  }

  const typingRe = integer ? INTEGER_TYPING_RE : DECIMAL_TYPING_RE

  return (
    <InputGroup
      id={id}
      fill
      inputMode={integer ? 'numeric' : 'decimal'}
      placeholder={placeholder}
      intent={intent}
      value={text}
      onChange={(e) => {
        const next = e.target.value
        if (!typingRe.test(next)) return
        setText(next)
        onChange(parse(next))
      }}
    />
  )
}
