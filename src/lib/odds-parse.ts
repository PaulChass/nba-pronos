// Pure helpers for the bookmaker markets ESPN's feed lacks (scoring leader, Finals MVP): reading a
// Kambi (BetRivers / Unibet) bet offer and matching bookmaker names to our ESPN player ids.
// No Next, no DB, no JSON imports, so `node --test` can run it.

/** "Luka Dončić", "Michael Porter Jr.", "Trey Murphy" -> "luka doncic", "michael porter", "trey murphy". */
export function normalizeName(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
  while (words.length > 2 && ['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/** Normalized name -> ESPN id. Names shared by two players map to null (never guessed). */
export function playerNameIndex(players: readonly { id: string; name: string }[]): Map<string, string | null> {
  const index = new Map<string, string | null>()
  for (const p of players) {
    const key = normalizeName(p.name)
    index.set(key, index.has(key) ? null : p.id)
  }
  return index
}

/** Implied probabilities (any scale) -> probabilities that sum to 1 (bookmaker margin removed). */
export function devig(raw: Record<string, number>): Record<string, number> | null {
  const total = Object.values(raw).reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  return Object.fromEntries(Object.entries(raw).map(([id, p]) => [id, p / total]))
}

export interface KambiBetOffers {
  betOffers?: {
    criterion?: { label?: string }
    outcomes?: { participant?: string; label?: string; odds?: number; status?: string }[]
  }[]
}

/**
 * Open outcomes of the bet offer whose criterion label is `offerLabel`, as {name, probability}
 * (Kambi odds are decimal × 1000). Empty when the offer is missing or closed.
 */
export function kambiOutcomes(json: KambiBetOffers, offerLabel: string): { name: string; p: number }[] {
  const offer = json.betOffers?.find((o) => o.criterion?.label?.trim() === offerLabel)
  const out: { name: string; p: number }[] = []
  for (const o of offer?.outcomes ?? []) {
    const name = o.participant ?? o.label
    if (!name || o.status !== 'OPEN' || typeof o.odds !== 'number' || o.odds <= 1000) continue
    out.push({ name, p: 1000 / o.odds })
  }
  return out
}

/** A Kambi offer as a de-vigged market keyed by ESPN player id (unmatched names are dropped). */
export function kambiMarket(
  json: KambiBetOffers,
  offerLabel: string,
  index: Map<string, string | null>,
): { market: Record<string, number> | null; unmatched: string[] } {
  const raw: Record<string, number> = {}
  const unmatched: string[] = []
  for (const { name, p } of kambiOutcomes(json, offerLabel)) {
    const id = index.get(normalizeName(name))
    if (id) raw[id] = p
    else unmatched.push(name)
  }
  return { market: devig(raw), unmatched }
}

/** American odds (number or "+250" / "-110" / "EVEN") -> implied probability. */
export function americanToProbability(american: number | string): number | null {
  const n = typeof american === 'number' ? american : american.trim().toUpperCase() === 'EVEN' ? 100 : Number(american)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100)
}
