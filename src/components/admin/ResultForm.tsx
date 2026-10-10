'use client'

import { useId, useState, useTransition, type FormEvent } from 'react'
import { setResultAction, type AdminMessage } from '@/app/actions/admin'
import type { QuestionId } from '@/lib/types'
import styles from './admin.module.css'

export interface ResultFormProps {
  questionId: QuestionId
  /** person = player/coach typed with a datalist; team = <select>. */
  mode: 'person' | 'team'
  /** id of the page-level <datalist> (person mode). */
  listId?: string
  /** Team choices (team mode): tricode + name. */
  teams?: { id: string; label: string }[]
  /** Current override winners: labels in person mode, tricodes in team mode. */
  defaults: string[]
  hasOverride: boolean
}

/** Override form for one question: set the winner(s), void the question, or go back to ESPN. */
export function ResultForm({ questionId, mode, listId, teams = [], defaults, hasOverride }: ResultFormProps) {
  const uid = useId()
  const [msg, setMsg] = useState<AdminMessage | null>(null)
  const [pending, startTransition] = useTransition()

  // Not a plain `action` form: React would reset the fields after every submit, losing a typo'd
  // name on error. The clicked button carries the intent.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const submitter = (e.nativeEvent as SubmitEvent).submitter
    fd.set('intent', submitter instanceof HTMLButtonElement && submitter.value ? submitter.value : 'set')
    startTransition(async () => {
      const res = await setResultAction(fd)
      startTransition(() => setMsg(res))
    })
  }

  return (
    // Remount when the saved override changes so the fields show the new defaults.
    <form key={defaults.join('|')} onSubmit={onSubmit} className={styles.resultForm} aria-busy={pending}>
      <input type="hidden" name="questionId" value={questionId} />
      {mode === 'person' ? (
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={`${uid}-w1`}>Vainqueur</label>
            <input
              id={`${uid}-w1`}
              name="winner"
              className="input"
              list={listId}
              defaultValue={defaults[0] ?? ''}
              autoComplete="off"
              placeholder="Tape un nom…"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${uid}-w2`}>
              Co-vainqueur <span className="muted">(trophée partagé)</span>
            </label>
            <input
              id={`${uid}-w2`}
              name="winner"
              className="input"
              list={listId}
              defaultValue={defaults[1] ?? ''}
              autoComplete="off"
              placeholder="Optionnel"
            />
          </div>
        </div>
      ) : (
        <div className={styles.field}>
          <label htmlFor={`${uid}-team`}>Équipe</label>
          <select id={`${uid}-team`} name="winner" className="input" defaultValue={defaults[0] ?? ''}>
            <option value="">— Choisis une équipe —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={styles.actions}>
        {/* First submit button = the one used when pressing Enter in a field. */}
        <button type="submit" name="intent" value="set" className="btn btn-primary btn-sm" disabled={pending}>
          Enregistrer
        </button>
        <button type="submit" name="intent" value="void" className="btn btn-sm" disabled={pending}>
          Annuler la question
        </button>
        <button
          type="submit"
          name="intent"
          value="auto"
          className="btn btn-ghost btn-sm"
          disabled={pending || !hasOverride}
        >
          Revenir à l’automatique
        </button>
      </div>
      <div aria-live="polite">
        {msg && <p className={`notice small ${msg.ok ? 'notice-ok' : 'notice-err'}`}>{msg.message}</p>}
      </div>
    </form>
  )
}
