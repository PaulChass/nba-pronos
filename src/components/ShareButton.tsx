'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { SEASON } from '@/config/season'
import styles from './ShareButton.module.css'

const TITLE = `Mes pronos NBA ${SEASON.label}`

type Status = 'idle' | 'loading' | 'options'

function supportsFileShare(file: File): boolean {
  return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] })
}

/**
 * "Partager mes pronos": the native share sheet with the PNG when the device supports sharing
 * files (most phones), otherwise a small panel (download, WhatsApp, Facebook, copy link).
 * The image only exists after the lock: /api/share answers 404 before.
 */
export function ShareButton({ pseudo, url }: { pseudo: string; url: string }) {
  const [status, setStatus] = useState<Status>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const [canShareFile, setCanShareFile] = useState(false)
  const fileRef = useRef<File | null>(null)
  const pending = useRef<Promise<File | null> | null>(null)
  const panelId = useId()

  const text = `${TITLE} 🏀 ${url}`
  const fileName = `pronos-nba-${pseudo.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}.png`

  // Free the object URL when it changes or the button unmounts.
  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  /** Fetches the PNG once; later calls reuse it (null if the image is unavailable). */
  function loadFile(): Promise<File | null> {
    if (fileRef.current) return Promise.resolve(fileRef.current)
    pending.current ??= fetch(`/api/share/${encodeURIComponent(pseudo)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`share image ${res.status}`)
        const blob = await res.blob()
        const file = new File([blob], fileName, { type: 'image/png' })
        fileRef.current = file
        return file
      })
      .catch(() => {
        pending.current = null // allow a retry on the next click
        return null
      })
    return pending.current
  }

  function showOptions(file: File | null) {
    setImageError(!file)
    if (file && !imageUrl) setImageUrl(URL.createObjectURL(file))
    setCanShareFile(!!file && supportsFileShare(file))
    setStatus('options')
  }

  async function onShare() {
    if (status === 'loading') return // keeps focus on the button instead of disabling it
    setCopied(null)
    // Already loaded (prefetched on hover/focus): share right away, while the click still counts
    // as a user gesture (Safari refuses navigator.share after a slow await).
    const ready = fileRef.current
    if (!ready) setStatus('loading')
    const file = ready ?? (await loadFile())
    if (!file) return showOptions(null)

    if (supportsFileShare(file)) {
      try {
        await navigator.share({ files: [file], title: TITLE, text })
        setStatus('idle')
      } catch (err) {
        if ((err as Error | null)?.name === 'AbortError') {
          setStatus('idle') // the user closed the share sheet
          return
        }
        showOptions(file) // e.g. NotAllowedError: the gesture expired while loading
      }
      return
    }
    showOptions(file)
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }

  const prefetch = () => void loadFile()

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onShare}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onTouchStart={prefetch}
        aria-busy={status === 'loading'}
        aria-expanded={status === 'options'}
        aria-controls={status === 'options' ? panelId : undefined}
      >
        <span aria-hidden>📤</span>
        {status === 'loading' ? 'Préparation de l’image…' : 'Partager mes pronos'}
      </button>

      {status === 'options' && (
        <div id={panelId} className={`card ${styles.panel}`} role="group" aria-label="Options de partage">
          <div className={styles.head}>
            <p className={styles.title}>Partager</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setStatus('idle')}
              aria-label="Fermer les options de partage"
            >
              ✕
            </button>
          </div>

          {imageError ? (
            <p className="notice notice-warn">
              L’image n’a pas pu être générée. Tu peux quand même partager le lien.
            </p>
          ) : (
            imageUrl && (
              <img className={styles.preview} src={imageUrl} alt={`Aperçu de l’image des pronos de ${pseudo}`} />
            )
          )}

          <div className={styles.actions}>
            {canShareFile && (
              // The image is loaded now, so a second tap opens the share sheet right away.
              <button type="button" className="btn btn-primary" onClick={onShare}>
                <span aria-hidden>📲</span> Partager l’image
              </button>
            )}
            {imageUrl && !imageError && (
              <a className="btn" href={imageUrl} download={fileName}>
                <span aria-hidden>⬇️</span> Télécharger l’image
              </a>
            )}
            <a
              className="btn"
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden>💬</span> Envoyer sur WhatsApp
            </a>
            <a
              className="btn"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden>👍</span> Partager sur Facebook
            </a>
            <button type="button" className="btn" onClick={onCopy}>
              <span aria-hidden>🔗</span> {copied === 'ok' ? 'Lien copié !' : 'Copier le lien'}
            </button>
          </div>

          {imageUrl && !imageError && (
            <p className="small muted">
              Astuce : télécharge l’image, puis joins-la à ton message WhatsApp ou à ton post.
            </p>
          )}

          <p className={styles.live} aria-live="polite">
            {copied === 'ok' && 'Le lien est dans ton presse-papiers.'}
          </p>
          {copied === 'fail' && (
            <label className={styles.manual}>
              <span className="small">Copie le lien à la main :</span>
              <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
