export function computeSharePct(score, totalScore) {
  if (!totalScore || totalScore <= 0) return 0
  return Math.round((score / totalScore) * 1000) / 10
}

export function totalScoreOf(countries) {
  return (countries || []).reduce((sum, c) => sum + c.score, 0)
}
