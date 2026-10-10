'use client'

// Live countdown to the lock. Import it as `Countdown` from '@/components/Countdown'.
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import styles from './Countdown.module.css'

interface Props {
  /** Lock instant as an ISO string (from lockAt().toISOString() on the server). */
  lockAt: string
  /** 'sm' (default): inline pill. 'lg': hero size, for the home page. */
  size?: 'sm' | 'lg'
  className?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

export function CountdownClock({ lockAt, size = 'sm', className }: Props) {
  const target = new Date(lockAt).getTime()
  const router = useRouter()
  // null until mounted: server and browser clocks never agree to the second, so the first render
  // is an invisible placeholder of the same width (no hydration mismatch, no layout shift).
  const [now, setNow] = useState<number | null>(null)
  const wasOpen = useRef<boolean | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const t = Date.now()
      setNow(t)
      // Re-align on the next second boundary so the seconds never skip.
      if (t < target) timer = setTimeout(tick, 1000 - (t % 1000) + 10)
    }
    tick()
    return () => clearTimeout(timer)
  }, [target])

  const remaining = now === null ? null : target - now

  // If the lock passes while the page is open, re-render the server components once (CTAs,
  // sign-up form, read-only pages…).
  useEffect(() => {
    if (remaining === null) return
    if (wasOpen.current === null) wasOpen.current = remaining > 0
    else if (wasOpen.current && remaining <= 0) {
      wasOpen.current = false
      router.refresh()
    }
  }, [remaining, router])

  if (Number.isNaN(target)) return null
  const cls = [styles.countdown, size === 'lg' ? styles.lg : styles.sm, className].filter(Boolean).join(' ')

  if (remaining === null)
    return (
      <span className={cls} aria-hidden="true">
        <span className={styles.placeholder}>J-00 · 00:00:00</span>
      </span>
    )

  if (remaining <= 0) return <span className={`${cls} ${styles.done}`}>C’est parti !</span>

  const total = Math.ceil(remaining / 1000)
  const days = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const label = `Verrouillage dans ${days ? `${plural(days, 'jour')}, ` : ''}${plural(h, 'heure')} et ${plural(m, 'minute')}`

  return (
    // role="timer" is an implicit aria-live="off" region: screen readers are not spammed every
    // second, but the label is there when the user reaches it.
    <span className={cls} role="timer" aria-label={label}>
      {days > 0 && (
        <>
          <span className={styles.days}>J-{days}</span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
        </>
      )}
      <span>
        {pad(h)}:{pad(m)}:{pad(s)}
      </span>
    </span>
  )
}
