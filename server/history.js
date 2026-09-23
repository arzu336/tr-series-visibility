import { createTrendStore } from './trend-store.js'

const store = createTrendStore({
  table: 'visibility_history',
  keyColumn: 'iso2',
  valueColumn: 'score',
  valueField: 'score',
  metaKey: 'lastSnapshotAt',
})

export function loadHistoryStore() {
  return store.loadStore()
}

export function getTrend(history, iso2, currentScore) {
  return store.getTrend(history, iso2, currentScore)
}

export function maybeRecordSnapshot(history, countries) {
  return store.maybeRecordSnapshot(
    history,
    countries.map((c) => ({ key: c.iso2, value: c.score }))
  )
}
