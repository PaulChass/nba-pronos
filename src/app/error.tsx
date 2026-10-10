'use client' // Error boundaries must be Client Components

import Link from 'next/link'
import { useEffect } from 'react'

/** Shown inside the layout when a page or a Server Function throws (DB or ESPN hiccup). */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="stack" style={{ alignItems: 'center', textAlign: 'center', paddingBlock: 48 }}>
      <h1>Petit airball…</h1>
      <p className="muted">Le serveur ne répond pas pour l’instant. Réessaie dans un instant.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" type="button" onClick={() => retry()}>
          Réessayer
        </button>
        <Link className="btn" href="/">
          Accueil
        </Link>
      </div>
    </div>
  )
}
