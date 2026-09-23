import { createTrendStore } from './trend-store.js'

// Tek bir küresel seri (ülke kırılımı yok) — anahtarsız tablo. Toplam öğrenen sayısı yavaş
// değiştiği için yön eşiği ±1 (ülke skorlarındaki ±5 değil).
const store = createTrendStore({
  table: 'duolingo_history',
  valueColumn: 'total_learners',
  valueField: 'totalLearners',
  metaKey: 'duolingoLastSnapshotAt',
  risingPct: 1,
  fallingPct: -1,
})

export function getDuolingoTrend(currentTotalLearners) {
  const history = store.loadStore()
  return { ...store.getTrend(history, null, currentTotalLearners), lastSnapshotAt: history.__lastSnapshotAt }
}

export function maybeRecordDuolingoSnapshot(totalLearners) {
  return store.maybeRecordSnapshot(store.loadStore(), [{ value: totalLearners }])
}
