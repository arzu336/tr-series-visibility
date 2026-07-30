// Göreli Yüzdelik Pay: bir ülkenin skorunun, bir bütünün (tüm dünya ya da tek bir kıta)
// toplam skoruna oranı. Saf bir hesaplama — /api/visibility'de zaten var olan skorlardan
// türetilir, yeni bir backend endpoint'i veya uydurma bir yüzde gerekmez.
export function computeSharePct(score, totalScore) {
  if (!totalScore || totalScore <= 0) return 0
  return Math.round((score / totalScore) * 1000) / 10
}

export function totalScoreOf(countries) {
  return (countries || []).reduce((sum, c) => sum + c.score, 0)
}
