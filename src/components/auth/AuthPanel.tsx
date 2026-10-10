'use client'

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { signInAction, signUpAction, type AuthFormState } from '@/app/actions/auth'
import styles from './AuthPanel.module.css'

export type AuthMode = 'inscription' | 'connexion'

const TABS: { mode: AuthMode; label: string }[] = [
  { mode: 'inscription', label: 'Créer mon compte' },
  { mode: 'connexion', label: 'Me connecter' },
]
const INITIAL: AuthFormState = { error: null, pseudo: '' }
const PIN_PATTERN = '\\d{6}'

/**
 * Sign-up / sign-in tabs. The server picks the initial tab from ?mode=; switching is instant
 * client-side and mirrored in the URL. The tab links still work without JavaScript.
 * With `signUpOpen` false (after the lock) only the sign-in form is rendered.
 */
export function AuthPanel({ initialMode, signUpOpen }: { initialMode: AuthMode; signUpOpen: boolean }) {
  const [mode, setMode] = useState<AuthMode>(signUpOpen ? initialMode : 'connexion')
  const id = useId()
  const tabRefs = useRef<Partial<Record<AuthMode, HTMLAnchorElement | null>>>({})

  function select(next: AuthMode, focus = false) {
    setMode(next)
    window.history.replaceState(null, '', `?mode=${next}`)
    if (focus) tabRefs.current[next]?.focus()
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLAnchorElement>) {
    // WAI-ARIA tabs pattern: arrows / Home / End move between tabs.
    const i = TABS.findIndex((t) => t.mode === mode)
    const target =
      e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length]
      : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length]
      : e.key === 'Home' ? TABS[0]
      : e.key === 'End' ? TABS[TABS.length - 1]
      : null
    if (!target) return
    e.preventDefault()
    select(target.mode, true)
  }

  if (!signUpOpen) return <SignInForm />

  return (
    <div className={styles.panel}>
      <div role="tablist" aria-label="Inscription ou connexion" className="tabs">
        {TABS.map((t) => (
          <a
            key={t.mode}
            ref={(el) => {
              tabRefs.current[t.mode] = el
            }}
            id={`${id}-tab-${t.mode}`}
            href={`?mode=${t.mode}`}
            role="tab"
            className="tab"
            aria-selected={mode === t.mode}
            aria-controls={`${id}-panel`}
            tabIndex={mode === t.mode ? 0 : -1}
            onClick={(e) => {
              e.preventDefault()
              select(t.mode)
            }}
            onKeyDown={onTabKeyDown}
          >
            {t.label}
          </a>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${mode}`}>
        {mode === 'inscription' ? <SignUpForm /> : <SignInForm />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- shared bits

/** Keeps PIN fields to digits only (desktop keyboards ignore inputMode). */
function digitsOnly(e: FormEvent<HTMLInputElement>) {
  const el = e.currentTarget
  const clean = el.value.replace(/\D/g, '').slice(0, 6)
  if (clean !== el.value) el.value = clean
}

/** Moves focus to the error after each failed submit, so screen readers read it again. */
function useErrorFocus(state: AuthFormState) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.error) ref.current?.focus()
  }, [state])
  return ref
}

function ErrorMessage({ error, errorRef }: { error: string | null; errorRef: RefObject<HTMLParagraphElement | null> }) {
  if (!error) return null
  return (
    <p ref={errorRef} role="alert" tabIndex={-1} className={`notice notice-err ${styles.error}`}>
      {error}
    </p>
  )
}

function PseudoField({ id, defaultValue, hint }: { id: string; defaultValue: string; hint?: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>Ton pseudo</label>
      <input
        id={id}
        name="pseudo"
        className="input"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        minLength={2}
        maxLength={20}
        // React resets the form after each submit: the action echoes the pseudo back.
        defaultValue={defaultValue}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className={`small muted ${styles.hint}`}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** Plain show/hide button: its label says what it does, so no aria-pressed. */
function ShowPinButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`btn btn-ghost btn-sm ${styles.toggle}`} onClick={onToggle}>
      <span aria-hidden="true">{shown ? '🙈' : '👀'}</span> {shown ? 'Masquer le code' : 'Afficher le code'}
    </button>
  )
}

// ---------------------------------------------------------------- forms

function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, INITIAL)
  const [showPin, setShowPin] = useState(false)
  const errorRef = useErrorFocus(state)
  const pinRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const id = useId()

  // Native validation message on the confirmation field (the server checks again).
  function checkMatch() {
    const pin = pinRef.current
    const confirm = confirmRef.current
    if (!pin || !confirm) return
    confirm.setCustomValidity(confirm.value && confirm.value !== pin.value ? 'Les deux codes ne correspondent pas.' : '')
  }

  const pinProps = {
    type: showPin ? 'text' : 'password',
    inputMode: 'numeric' as const,
    pattern: PIN_PATTERN,
    minLength: 6,
    maxLength: 6,
    required: true,
    autoComplete: 'new-password',
    title: '6 chiffres',
    className: `input ${styles.pin}`,
    onInput: (e: FormEvent<HTMLInputElement>) => {
      digitsOnly(e)
      checkMatch()
    },
  }

  return (
    <form action={action} className={styles.form}>
      <ErrorMessage error={state.error} errorRef={errorRef} />
      <PseudoField
        id={`${id}-pseudo`}
        defaultValue={state.pseudo}
        hint="2 à 20 caractères : c’est lui que tes potes verront au classement."
      />
      <div className={styles.field}>
        <label htmlFor={`${id}-pin`}>Ton code PIN (6 chiffres)</label>
        <input id={`${id}-pin`} name="pin" ref={pinRef} aria-describedby={`${id}-pin-hint`} {...pinProps} />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-confirm`}>Confirme ton code</label>
        <input id={`${id}-confirm`} name="pinConfirm" ref={confirmRef} {...pinProps} />
      </div>
      <ShowPinButton shown={showPin} onToggle={() => setShowPin((v) => !v)} />
      <p id={`${id}-pin-hint`} className="notice notice-warn">
        <span aria-hidden="true">🔑 </span>
        Retiens bien ton code : en cas d’oubli, demande à l’admin de le réinitialiser.
      </p>
      <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
        {pending ? 'Création…' : 'Créer mon compte'}
      </button>
    </form>
  )
}

function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL)
  const [showPin, setShowPin] = useState(false)
  const errorRef = useErrorFocus(state)
  const id = useId()

  return (
    <form action={action} className={styles.form}>
      <ErrorMessage error={state.error} errorRef={errorRef} />
      <PseudoField id={`${id}-pseudo`} defaultValue={state.pseudo} />
      <div className={styles.field}>
        <label htmlFor={`${id}-pin`}>Ton code PIN</label>
        <input
          id={`${id}-pin`}
          name="pin"
          type={showPin ? 'text' : 'password'}
          inputMode="numeric"
          pattern={PIN_PATTERN}
          minLength={6}
          maxLength={6}
          required
          autoComplete="current-password"
          title="6 chiffres"
          className={`input ${styles.pin}`}
          aria-describedby={`${id}-pin-hint`}
          onInput={digitsOnly}
        />
      </div>
      <ShowPinButton shown={showPin} onToggle={() => setShowPin((v) => !v)} />
      <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
        {pending ? 'Connexion…' : 'Me connecter'}
      </button>
      <p id={`${id}-pin-hint`} className={`small muted ${styles.hint}`}>
        Code oublié ? Demande à l’admin de le réinitialiser.
      </p>
    </form>
  )
}
