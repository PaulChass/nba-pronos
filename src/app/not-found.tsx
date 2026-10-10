import Link from 'next/link'

// Rendered inside the root layout (nav included). Global primitives only: no CSS module needed.
export default function NotFound() {
  return (
    <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '48px 0', gap: 14 }}>
      <p aria-hidden="true" style={{ margin: 0, fontSize: '4rem', lineHeight: 1 }}>
        🏀
      </p>
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          letterSpacing: '0.14em',
          color: 'var(--accent)',
        }}
      >
        ERREUR 404
      </p>
      <h1 style={{ margin: 0 }}>Air ball !</h1>
      <p className="muted" style={{ margin: 0, maxWidth: '34ch' }}>
        Ce tir n’a touché ni le cercle ni la planche : la page que tu cherches n’existe pas (ou plus).
      </p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
        <Link href="/" className="btn btn-primary">
          Retour à l’accueil
        </Link>
        <Link href="/regles" className="btn">
          Les règles
        </Link>
      </div>
    </div>
  )
}
