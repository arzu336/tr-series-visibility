import { useMemo } from 'react'
import countryNames from '../../data/country-centroids.json'
import continentByIso2 from '../../data/continents.json'
import { fetchTrendSeriesList } from '../../lib/api.js'
import { useAsync } from '../../lib/useAsync.js'
import { IconChart, IconGlobe, IconReport, IconTv } from '../Icons.jsx'
import CountryReportView from './CountryReportView.jsx'
import SeriesReportView from './SeriesReportView.jsx'
import GlobalReportView from './GlobalReportView.jsx'
import SearchPicker from './SearchPicker.jsx'
import { AllCountries, CountryQuickPicks, SeriesQuickPicks } from '../QuickPicks.jsx'

// Raporlar: tek menü, üç sekme (2026-10-06), üçü de aynı belge biçiminde (özet → başlıklar → ek). Küresel
// görünüm eski "Etki analizi"nin yerini aldı; bütün ülkeleri kapsadığı için yalnızca yöneticiye görünür.
// Ülke brifingi ve dizi raporu herkese açık.

// Kıtası olmayan kayıtlar (Antarktika, Fransız Güney Toprakları) ülke değil; seçicide yer almaz.
const COUNTRY_OPTIONS = Object.entries(countryNames)
  .filter(([iso2]) => iso2 !== 'TR' && continentByIso2[iso2])
  .map(([iso2, c]) => ({ id: iso2, iso2, label: c.name }))
  .sort((a, b) => a.label.localeCompare(b.label, 'tr'))

export default function ReportsHub({ isAdmin, tab, iso2, seriesId, onChange, countries = [] }) {
  const tabs = [
    ...(isAdmin ? [{ key: 'kuresel', label: 'Küresel görünüm', Icon: IconGlobe }] : []),
    { key: 'ulke', label: 'Ülke brifingi', Icon: IconReport },
    { key: 'dizi', label: 'Dizi raporu', Icon: IconTv },
  ]
  const active = tabs.some((t) => t.key === tab) ? tab : 'ulke'
  const seriesReq = useAsync(fetchTrendSeriesList, [], { enabled: active === 'dizi' })
  const seriesOptions = useMemo(
    () =>
      [...(seriesReq.data?.items || [])]
        .map((s) => ({ id: s.id, label: s.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [seriesReq.data]
  )

  return (
    <div className="dashboard reports">
      <div className="reports__head">
        <h2>Raporlar</h2>
        <nav className="app__nav dashboard__tabs reports__tabs" aria-label="Rapor türü">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={active === t.key ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
              aria-pressed={active === t.key}
              onClick={() => onChange({ tab: t.key })}
            >
              <t.Icon size={15} inline />
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {active === 'ulke' && (
        <>
          <SearchPicker
            id="rapor-ulke"
            label="Ülke"
            placeholder="Ülke adı yazın…"
            items={COUNTRY_OPTIONS}
            value={iso2}
            onSelect={(v) => onChange({ tab: 'ulke', iso2: v })}
          />
          {iso2 ? (
            <CountryReportView iso2={iso2} countryName={countryNames[iso2]?.name || iso2} />
          ) : (
            <>
              <p className="dashboard__empty">
                Brifingini görmek istediğiniz ülkeyi seçin ({COUNTRY_OPTIONS.length} ülke) ya da aşağıdan birine
                tıklayın.
              </p>
              <CountryQuickPicks countries={countries} onPick={(v) => onChange({ tab: 'ulke', iso2: v })} />
              <AllCountries onPick={(v) => onChange({ tab: 'ulke', iso2: v })} />
            </>
          )}
        </>
      )}

      {active === 'dizi' && (
        <>
          <SearchPicker
            id="rapor-dizi"
            label="Dizi"
            placeholder={seriesReq.status === 'loading' ? 'Diziler yükleniyor…' : 'Dizi adı yazın…'}
            items={seriesOptions}
            value={seriesId}
            onSelect={(v) => onChange({ tab: 'dizi', seriesId: v })}
          />
          {seriesId ? (
            <SeriesReportView seriesId={seriesId} />
          ) : (
            <>
              <p className="dashboard__empty">
                <IconChart size={15} inline />
                Raporunu görmek istediğiniz diziyi arayın ya da aşağıdan birine tıklayın.
              </p>
              <SeriesQuickPicks countries={countries} onPick={(v) => onChange({ tab: 'dizi', seriesId: v })} />
            </>
          )}
        </>
      )}

      {active === 'kuresel' && isAdmin && <GlobalReportView />}
    </div>
  )
}
