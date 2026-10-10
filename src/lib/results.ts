// Question results = ESPN auto-detection, overridden by the admin when needed — CONTRACT STUB.
// Implemented by the ESPN workstream.
import type { QuestionId, QuestionResult, Results } from './types'

/** Auto results merged with admin overrides (admin wins). Every question present. */
export async function getResults(): Promise<Results> {
  throw new Error('not implemented')
}

/** Admin override for one question; null removes the override (back to auto). */
export async function setAdminResult(_q: QuestionId, _result: QuestionResult | null): Promise<void> {
  throw new Error('not implemented')
}

/** Current admin overrides only (for the admin page). */
export async function getAdminOverrides(): Promise<Results> {
  throw new Error('not implemented')
}
