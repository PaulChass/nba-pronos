'use client'

import { useId, useState, useTransition } from 'react'
import { resetPinAction, type ResetPinState } from '@/app/actions/admin'
import styles from './admin.module.css'

export interface PinTarget {
  id: number
  pseudo: string
}

/** Pick a player, confirm, and show the new PIN once (it only lives in this component's state). */
export function ResetPinForm({ users }: { users: PinTarget[] }) {
  const selectId = useId()
  const [userId, setUserId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [state, setState] = useState<ResetPinState>({ status: 'idle' })
  const [pending, startTransition] = useTransition()
  const target = users.find((u) => String(u.id) === userId)

  function reset() {
    if (!target) return
    startTransition(async () => {
      const res = await resetPinAction(target.id)
      startTransition(() => {
        setState(res)
        setConfirming(false)
        if (res.status === 'ok') setUserId('')
      })
    })
  }

  return (
    <div className={styles.pinBox}>
      <h3>Réinitialiser un PIN</h3>
      <p className="small muted">
        Un nouveau code à 6 chiffres est tiré au hasard, et toutes ses sessions ouvertes sont déconnectées.
      </p>
      <form
        className={styles.pinForm}
        onSubmit={(e) => {
          e.preventDefault()
          if (target) setConfirming(true)
        }}
      >
        <label htmlFor={selectId}>Joueur</label>
        <select
          id={selectId}
          className="input"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value)
            setConfirming(false)
          }}
        >
          <option value="">— Choisis un joueur —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.pseudo}
            </option>
          ))}
        </select>
        {confirming && target ? (
          <div className={styles.actions} role="group" aria-label="Confirmation">
            <span className="small">
              Nouveau PIN pour <strong>{target.pseudo}</strong> ?
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={reset} disabled={pending}>
              {pending ? 'En cours…' : 'Confirmer'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={pending}>
              Annuler
            </button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button type="submit" className="btn btn-sm" disabled={!target}>
              Réinitialiser le PIN
            </button>
          </div>
        )}
      </form>
      <div aria-live="polite">
        {state.status === 'ok' && (
          <div className={`notice notice-ok ${styles.pinResult}`}>
            <p>
              Nouveau PIN de <strong>{state.pseudo}</strong> : <span className={styles.pin}>{state.pin}</span>
            </p>
            <p>Communique-le à {state.pseudo}. Il ne sera plus affiché ensuite.</p>
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setState({ status: 'idle' })}>
                C’est noté, masquer
              </button>
            </div>
          </div>
        )}
        {state.status === 'error' && <p className="notice notice-err">{state.error}</p>}
      </div>
    </div>
  )
}
