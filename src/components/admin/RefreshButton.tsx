'use client'

import { useState, useTransition } from 'react'
import { refreshScoresAction, type AdminMessage } from '@/app/actions/admin'

/** Forces the score pages (and their cached ESPN standings) to be rebuilt on next visit. */
export function RefreshButton() {
  const [msg, setMsg] = useState<AdminMessage | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="stack">
      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await refreshScoresAction()
              startTransition(() => setMsg(res))
            })
          }
        >
          {pending ? 'Rafraîchissement…' : 'Rafraîchir le classement'}
        </button>
      </div>
      <div aria-live="polite">
        {msg && <p className={`notice small ${msg.ok ? 'notice-ok' : 'notice-err'}`}>{msg.message}</p>}
      </div>
    </div>
  )
}
