'use server'

import { redirect } from 'next/navigation'
import { isLocked } from '@/config/season'
import { authenticate, clearSessionCookie, createAccount, setSessionCookie } from '@/lib/auth'

export interface AuthFormState {
  error: string | null
  pseudo: string
}

/** useActionState-compatible: (prevState, formData) => newState. Redirects on success. */
export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const pseudo = String(formData.get('pseudo') ?? '')
  const pin = String(formData.get('pin') ?? '')
  const pinConfirm = String(formData.get('pinConfirm') ?? '')
  if (isLocked()) return { error: 'Les inscriptions sont fermées depuis le premier match.', pseudo }
  if (pin !== pinConfirm) return { error: 'Les deux codes PIN ne correspondent pas.', pseudo }
  const res = await createAccount(pseudo, pin)
  if (!res.ok) return { error: res.error, pseudo }
  await setSessionCookie(res.user.id, res.version)
  redirect('/grille')
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const pseudo = String(formData.get('pseudo') ?? '')
  const pin = String(formData.get('pin') ?? '')
  const res = await authenticate(pseudo, pin)
  if (!res.ok) return { error: res.error, pseudo }
  await setSessionCookie(res.user.id, res.version)
  redirect(isLocked() ? '/classement' : '/grille')
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie()
  redirect('/')
}
