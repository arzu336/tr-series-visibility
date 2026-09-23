import { createTrendStore } from './trend-store.js'

const store = createTrendStore({
  table: 'benchmark_history',
  keyColumn: 'country_code',
  valueColumn: 'total_score',
  valueField: 'totalScore',
  metaKey: 'benchmarkLastSnapshotAt',
})

export function loadBenchmarkHistoryStore() {
  return store.loadStore()
}

export function getBenchmarkTrend(history, countryCode, currentTotalScore) {
  return store.getTrend(history, countryCode, currentTotalScore)
}

export function maybeRecordBenchmarkSnapshot(history, countries) {
  return store.maybeRecordSnapshot(
    history,
    countries.map((c) => ({ key: c.code, value: c.totalScore }))
  )
}
