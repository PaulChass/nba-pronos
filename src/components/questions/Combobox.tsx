'use client'

// Searchable picker (WAI-ARIA combobox + listbox pattern): the input keeps focus, arrow keys move
// the active option (aria-activedescendant), Enter picks, Escape closes then clears the query.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { PickerOption } from '@/lib/data'
import type { AnswerKind, TeamAbbr } from '@/lib/types'
import { buildIndex, search, type SearchEntry } from './logic'
import styles from './Combobox.module.css'

interface Props {
  kind: AnswerKind
  options: readonly PickerOption[]
  value: string | null
  onChange: (id: string | null) => void
  /** Id of the visible question title, used as the input's accessible name. */
  labelledBy: string
  placeholder: string
  /** Teams listed first while the query is empty. */
  prefer?: readonly TeamAbbr[]
  disabled?: boolean
}

const NO_MATCHES = { matches: [] as SearchEntry[], total: 0 }

export function Combobox({ kind, options, value, onChange, labelledBy, placeholder, prefer, disabled }: Props) {
  const uid = useId()
  const listId = `${uid}-list`
  const hintId = `${uid}-hint`
  const optionId = (i: number) => `${uid}-opt-${i}`

  const index = useMemo(() => buildIndex(kind, options), [kind, options])
  const current = useMemo(() => (value ? (index.find((e) => e.opt.id === value) ?? null) : null), [index, value])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const preferKey = prefer?.join(',') ?? ''
  const { matches, total } = useMemo(
    () => (open ? search(index, query, { prefer: preferKey ? preferKey.split(',') : [] }) : NO_MATCHES),
    [open, index, query, preferKey],
  )

  // Keep the active option visible while navigating with the keyboard.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  function select(id: string) {
    clearTimeout(blurTimer.current)
    onChange(id)
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) {
          setOpen(true)
          setActive(0)
        } else setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) setOpen(true)
        setActive((a) => Math.max(a - 1, 0))
        break
      case 'Enter':
        if (open && matches[active]) {
          e.preventDefault()
          select(matches[active].opt.id)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          setOpen(false)
        } else if (query) {
          e.preventDefault()
          setQuery('')
        }
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  const noun = kind === 'coach' ? 'coach' : kind === 'player' || kind === 'rookie' ? 'joueur' : 'équipe'
  let hint = `Tape un nom ou une équipe, puis choisis un ${noun} dans la liste.`
  if (open && query.trim()) {
    hint =
      total === 0
        ? 'Aucun résultat.'
        : total > matches.length
          ? `${total} résultats, les ${matches.length} premiers sont affichés : précise ta recherche.`
          : `${total} résultat${total > 1 ? 's' : ''}.`
  } else if (open) {
    hint = `${total} au choix : tape un nom ou une équipe pour filtrer.`
  }

  return (
    <div className={styles.root}>
      {value && (
        <div className={styles.pick}>
          {current?.team ? <img src={current.team.logo} alt="" className="team-logo" /> : null}
          <div className={styles.pickText}>
            <span className="visually-hidden">Ton choix : </span>
            <strong className={styles.pickLabel}>{current?.opt.label ?? `Choix inconnu (#${value})`}</strong>
            {current && <span className="small muted">{current.opt.sub}</span>}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label={`Effacer ton choix (${current?.opt.label ?? value})`}
          >
            Effacer
          </button>
        </div>
      )}

      <input
        className={`input ${styles.input}`}
        type="text"
        role="combobox"
        aria-labelledby={labelledBy}
        aria-describedby={hintId}
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? optionId(active) : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={value ? 'Changer de choix…' : placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onFocus={() => clearTimeout(blurTimer.current)}
        // Delayed so a tap on an option still lands on mobile browsers that blur first.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
      />
      <p id={hintId} className={open ? `small muted ${styles.hint}` : 'visually-hidden'} aria-live="polite">
        {hint}
      </p>

      <ul
        id={listId}
        ref={listRef}
        role="listbox"
        aria-labelledby={labelledBy}
        className={styles.list}
        hidden={!open || matches.length === 0}
        // Keeps focus in the input when an option is clicked.
        onMouseDown={(e) => e.preventDefault()}
      >
        {matches.map((e, i) => (
          <li
            key={e.opt.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            data-active={i === active}
            data-current={e.opt.id === value}
            className={styles.option}
            onClick={() => select(e.opt.id)}
            onMouseMove={() => i !== active && setActive(i)}
          >
            {e.team ? (
              <img src={e.team.logo} alt="" className="team-logo" loading="lazy" />
            ) : (
              <span className={`team-logo ${styles.noLogo}`} aria-hidden />
            )}
            <span className={styles.optText}>
              <span className={styles.optLabel}>{e.opt.label}</span>
              <span className="small muted">{e.opt.sub}</span>
            </span>
            {e.opt.id === value && (
              <span className={styles.check}>
                <span aria-hidden>✓</span>
                <span className="visually-hidden">(choix actuel)</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
