import Link from 'next/link'
import { signOutAction } from '@/app/actions/auth'
import { isLocked } from '@/config/season'
import { getCurrentUser } from '@/lib/auth'
import styles from './Nav.module.css'

/** Top bar. Before the lock: entry steps. After: leaderboard, consensus. */
export async function Nav() {
  const user = await getCurrentUser().catch(() => null)
  const locked = isLocked()
  const links = locked
    ? [
        { href: '/classement', label: 'Classement' },
        { href: '/consensus', label: 'Consensus' },
        ...(user ? [{ href: `/joueur/${encodeURIComponent(user.pseudo)}`, label: 'Mes pronos' }] : []),
        { href: '/regles', label: 'Règles' },
      ]
    : user
      ? [
          { href: '/grille', label: 'Grille' },
          { href: '/questions', label: 'Questions' },
          { href: '/recap', label: 'Récap' },
          { href: '/regles', label: 'Règles' },
        ]
      : [{ href: '/regles', label: 'Règles' }]

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.ball} aria-hidden>
            🏀
          </span>
          Pronos <strong>NBA</strong>
        </Link>
        <nav className={styles.links} aria-label="Navigation principale">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={styles.link}>
              {l.label}
            </Link>
          ))}
          {user?.isAdmin && (
            <Link href="/admin" className={styles.link}>
              Admin
            </Link>
          )}
        </nav>
        {user ? (
          <form action={signOutAction} className={styles.user}>
            <span className={styles.pseudo}>{user.pseudo}</span>
            <button className={`btn btn-ghost btn-sm ${styles.logout}`} type="submit" aria-label="Déconnexion" title="Déconnexion">
              <span className={styles.logoutText}>Déconnexion</span>
              <span className={styles.logoutIcon} aria-hidden>
                ⏻
              </span>
            </button>
          </form>
        ) : (
          <Link href="/connexion" className="btn btn-primary btn-sm">
            Connexion
          </Link>
        )}
      </div>
    </header>
  )
}
