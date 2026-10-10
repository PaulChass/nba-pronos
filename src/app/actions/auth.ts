'use server'

import { redirect } from 'next/navigation'
import { isLocked } from '@/config/season'
import { authenticate, clearSessionCookie, createAccount, setSessionCookie, type AuthResult } from '@/lib/auth'

export interface AuthFormState {
  error: string | null
  pseudo: string
}

const SERVER_DOWN = 'Le serveur ne répond pas, réessaie dans un instant.'

/** Runs the DB part only; cookie + redirect stay outside so redirect() is never swallowed. */
async function attempt(run: () => Promise<AuthResult>): Promise<AuthResult> {
  try {
    return await run()
  } catch (err) {
    console.error('[auth]', err)
    return { ok: false, error: SERVER_DOWN }
  }
}

/** useActionState-compatible: (prevState, formData) => newState. Redirects on success. */
export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const pseudo = String(formData.get('pseudo') ?? '')
  const pin = String(formData.get('pin') ?? '')
  const pinConfirm = String(formData.get('pinConfirm') ?? '')
  if (isLocked()) return { error: 'Les inscriptions sont fermées depuis le premier match.', pseudo }
  if (pin !== pinConfirm) return { error: 'Les deux codes PIN ne correspondent pas.', pseudo }
  const res = await attempt(() => createAccount(pseudo, pin))
  if (!res.ok) return { error: res.error, pseudo }
  await setSessionCookie(res.user.id, res.version)
  redirect('/grille')
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const pseudo = String(formData.get('pseudo') ?? '')
  const pin = String(formData.get('pin') ?? '')
  const res = await attempt(() => authenticate(pseudo, pin))
  if (!res.ok) return { error: res.error, pseudo }
  await setSessionCookie(res.user.id, res.version)
  redirect(isLocked() ? '/classement' : '/grille')
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie()
  redirect('/')
}
