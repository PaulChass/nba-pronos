'use client'

// Invitation link only: before the lock, predictions are never shared (see spec §2).
import { useState } from 'react'
import { SEASON } from '@/config/season'

const INVITE_TEXT = `Viens faire tes pronos NBA ${SEASON.label} avant le premier match 🏀`

type Fallback = { url: string; copied: boolean }

export function InviteButton({ className }: { className?: string }) {
  // Set once the native share sheet is unavailable (or failed): show the copy result + WhatsApp.
  const [fallback, setFallback] = useState<Fallback | null>(null)

  async function invite() {
    const url = window.location.origin
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Pronos NBA ${SEASON.label}`, text: INVITE_TEXT, url })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return // user closed the sheet
      }
    }
    let copied = false
    try {
      await navigator.clipboard.writeText(`${INVITE_TEXT} ${url}`)
      copied = true
    } catch {
      // No clipboard (insecure context, permission denied): the link is shown for manual copy.
    }
    setFallback({ url, copied })
  }

  const whatsApp = fallback && `https://wa.me/?text=${encodeURIComponent(`${INVITE_TEXT} ${fallback.url}`)}`

  return (
    <div className={['stack', className].filter(Boolean).join(' ')} style={{ gap: 8 }}>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={invite}>
          <span aria-hidden="true">📣</span> Inviter mes potes
        </button>
        {whatsApp && (
          <a className="btn" href={whatsApp} target="_blank" rel="noopener noreferrer">
            Envoyer sur WhatsApp
          </a>
        )}
      </div>
      <p role="status" className="small muted" style={{ margin: 0, overflowWrap: 'anywhere' }}>
        {fallback &&
          (fallback.copied ? (
            'Lien copié ! Colle-le dans ton groupe.'
          ) : (
            <>
              Copie ce lien : <strong>{fallback.url}</strong>
            </>
          ))}
      </p>
    </div>
  )
}
