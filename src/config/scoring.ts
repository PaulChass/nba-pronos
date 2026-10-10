// The barème. The rules page is rendered from these constants and the engine (lib/scoring.ts)
// reads only these, so what players read and how they are scored cannot drift apart.

export const SCORING = {
  rulesVersion: '2026.1',

  // Grid: per team, max(0, winBase - |predicted - actual|) + rank points.
  winBase: 20,
  rankExact: 5,
  rankNear: 2, // within one place of the actual rank range

  // Grid entry guard rails (warnings only).
  warnHighWins: 70,
  warnLowWins: 15,

  // Hot takes (declared before lock, qualified by formula at lock).
  htMaxTeams: 3,
  htMaxQuestions: 2,
  htTeamMinGap: 10, // wins away from the normalized line AND from the group median, same side
  htTeamBonus: 10,
  htGroupMinOthers: 4, // the group test needs at least this many other players
  htOddsRatio: 3, // a question pick must be at least 3x less likely than the favourite
  htGroupShareDivisor: 5, // at most floor((N-1)/5) other players made the same pick

  // Live projection: proj = W + (82-GP) * (W + K*L'/82) / (GP + K)
  projectionK: 25,
} as const
