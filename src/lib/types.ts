// Shared domain types. Pure: no runtime imports, safe to import from client, server and tests.

export type Conf = 'E' | 'W'
/** NBA tricode, e.g. "NYK", "SAS". */
export type TeamAbbr = string

export interface Team {
  espnId: string
  abbr: TeamAbbr
  espnAbbr: string
  name: string
  shortName: string
  conference: Conf
  color: string
  altColor: string
  logo: string
}

export interface Player {
  id: string // ESPN athlete id
  name: string
  team: TeamAbbr
  pos: string
  exp: number | null
  rookie: boolean
  headshot: string | null
}

export interface Coach {
  id: string // ESPN coach id
  name: string
  team: TeamAbbr
}

// ---------------------------------------------------------------- predictions

/**
 * The user's grid. `order[conf]` lists the 15 teams of that conference from rank 1 to 15
 * (index + 1 = predicted rank). `wins[abbr]` is null until the user fills it in.
 */
export interface GridPrediction {
  order: Record<Conf, TeamAbbr[]>
  wins: Record<TeamAbbr, number | null>
}

export type QuestionId =
  | 'mvp'
  | 'roy'
  | 'dpoy'
  | 'smoy'
  | 'mip'
  | 'clutch'
  | 'coy'
  | 'scoring'
  | 'cup'
  | 'finalistE'
  | 'finalistW'
  | 'champion'
  | 'fmvp'

/** What a question's answer refers to. Answers store ESPN player/coach ids or team tricodes. */
export type AnswerKind = 'player' | 'rookie' | 'coach' | 'team' | 'teamE' | 'teamW' | 'champion'

/** Picked answer per question (player id, coach id or team tricode). Missing = not answered. */
export type Answers = Partial<Record<QuestionId, string>>

export interface HotTakes {
  teams: TeamAbbr[]
  questions: QuestionId[]
}

export interface PredictionDoc {
  grid: GridPrediction
  answers: Answers
  hotTakes: HotTakes
}

/** A stored prediction with its owner, as loaded from the database. */
export interface StoredPrediction extends PredictionDoc {
  userId: number
  pseudo: string
  gridValid: boolean
  lastSavedAt: string // ISO
}

// ---------------------------------------------------------------- reality

export interface TeamStanding {
  abbr: TeamAbbr
  conference: Conf
  w: number
  l: number
}

export type QuestionResult =
  | { status: 'pending' }
  | { status: 'void' }
  /** One or more winners (co-winners all score). Ids use the same scheme as Answers. */
  | { status: 'final'; winners: string[]; source: 'auto' | 'admin' }

export type Results = Partial<Record<QuestionId, QuestionResult>>

/** De-vigged probabilities per question at lock: answerId -> probability (sums to ~1). */
export type QuestionOdds = Partial<Record<QuestionId, Record<string, number>>>

// ---------------------------------------------------------------- scoring output

export interface TeamHotTake {
  eligible: boolean // passed the bookmaker + group tests at lock
  success: boolean
  bonus: number
}

export interface TeamScore {
  abbr: TeamAbbr
  conference: Conf
  predictedWins: number
  predictedRank: number
  /** Projected wins during the season, real wins once final. */
  actualWins: number
  /** Rank range shared by teams with identical records: [lo, hi]. */
  actualRank: [number, number]
  line: number // normalized bookmaker line (sum 1230)
  winPts: number
  rankPts: number
  hotTake: TeamHotTake | null // null = not declared
}

export interface QuestionHotTake {
  eligible: boolean
  success: boolean
  bonus: number
}

export interface QuestionScore {
  id: QuestionId
  pick: string | null
  status: QuestionResult['status']
  correct: boolean | null // null while pending / void / unanswered
  points: number
  maxPoints: number
  hotTake: QuestionHotTake | null
  /**
   * Still pending, but the pick can no longer score (e.g. a champion whose conference finalist is
   * another team): shown greyed out as "éliminé" and left out of `stillPlayable`.
   */
  dead: boolean
}

export interface ScoreCard {
  userId: number
  pseudo: string
  gridValid: boolean
  lastSavedAt: string
  grid: number // win points + rank points
  questions: number
  hotTakes: number
  total: number
  teams: TeamScore[]
  qs: QuestionScore[]
  /** Points still mathematically available (pending questions whose pick is alive + their hot-take bonus). */
  stillPlayable: number
  rank: number // 1-based position in the general leaderboard (ties share nothing: strict order)
}
