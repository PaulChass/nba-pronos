import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect, unstable_rethrow } from 'next/navigation'
import { AuthPanel, type AuthMode } from '@/components/auth/AuthPanel'
import { formatLockDate } from '@/components/Countdown'
import { isLocked, lockAt } from '@/config/season'
import { getCurrentUser } from '@/lib/auth'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Connexion' }

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>
}) {
  const locked = isLocked()
  // A database hiccup should not hide the forms (the actions report their own errors).
  const user = await getCurrentUser().catch((err: unknown) => {
    unstable_rethrow(err)
    return null
  })
  if (user) redirect(locked ? '/classement' : '/grille')

  const { mode } = await searchParams
  const initialMode: AuthMode = mode === 'inscription' ? 'inscription' : 'connexion'
  const lockDate = formatLockDate(lockAt().toISOString())

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.kicker}>
          <span aria-hidden="true">🏀</span> Pronos NBA
        </p>
        <h1 className={styles.title}>{locked ? 'Content de te revoir' : 'Rejoins la partie'}</h1>
        {!locked && (
          <p className={`muted ${styles.lead}`}>
            Un pseudo et un code à 6 chiffres, c’est tout. Tes pronos restent modifiables jusqu’au {lockDate}.
          </p>
        )}
      </header>

      {locked && (
        <p className="notice notice-warn">
          Les inscriptions sont fermées : la saison a commencé le {lockDate}. Si tu as déjà un compte,
          connecte-toi. Sinon, tu peux toujours suivre <Link href="/classement">le classement</Link>.
        </p>
      )}

      <div className="card">
        <AuthPanel initialMode={initialMode} signUpOpen={!locked} />
      </div>

      <p className={`small muted ${styles.foot}`}>
        <Link href="/regles">Comment ça marche ? Le barème expliqué</Link>
      </p>
    </div>
  )
}
