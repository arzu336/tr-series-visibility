import { useMemo, useState } from 'react'
import countryNames from '../../data/country-centroids.json'
import continentByIso2 from '../../data/continents.json'
import { fetchTrendSeriesList } from '../../lib/api.js'
import { useAsync } from '../../lib/useAsync.js'
import { IconChart, IconGlobe, IconReport, IconTv } from '../Icons.jsx'
import { CONTINENTS } from '../../lib/continents.js'
import CountryReportView from './CountryReportView.jsx'
import SeriesReportView from './SeriesReportView.jsx'
import GlobalReportView from './GlobalReportView.jsx'
import SearchPicker from './SearchPicker.jsx'
import { AllCountries, CountryQuickPicks, SeriesQuickPicks } from '../QuickPicks.jsx'

// Dönem seçici (2026-10-13): ay düzeyinde tarih aralığı → o dönemin kayıtlı verisinden dönem raporu; "Güncel rapor"
// bugünkü rapora döner. Kullanıcı isteğiyle hazır seçenekler (yıllar, son 12 ay) kaldırıldı; aralık 2010'dan.
const FIRST_YEAR = 2010
const AYLAR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Tarayıcının yerleşik ay kutusu (input type=month) yazılanı çoğu zaman almıyordu (kullanıcı: "aralığı uygula
// çalışmıyor") → ay ve yıl için iki açılır liste.
function MonthField({ label, value, onChange, max }) {
  const [y, m] = value.split('-')
  const years = Array.from({ length: Number(max.slice(0, 4)) - FIRST_YEAR + 1 }, (_, i) => Number(max.slice(0, 4)) - i)
  return (
    <fieldset className="report__month">
      <legend>{label}</legend>
      <select aria-label={`${label} ayı`} value={m} onChange={(e) => onChange(`${y}-${e.target.value}`)}>
        {AYLAR.map((ad, i) => (
          <option key={ad} value={String(i + 1).padStart(2, '0')}>
            {ad}
          </option>
        ))}
      </select>
      <select aria-label={`${label} yılı`} value={y} onChange={(e) => onChange(`${e.target.value}-${m}`)}>
        {years.map((yr) => (
          <option key={yr} value={yr}>
            {yr}
          </option>
        ))}
      </select>
    </fieldset>
  )
}

export function PeriodPicker({ value, onChange, currentLabel = 'Güncel rapor', defaultFrom = null }) {
  const now = ym(new Date())
  const [from, setFrom] = useState(value?.from ?? defaultFrom ?? `${now.slice(0, 4)}-01`)
  const [to, setTo] = useState(value?.to ?? now)
  const error = from > to ? 'Başlangıç, bitişten sonra olamaz.' : to > now ? 'Bitiş bugünden sonra olamaz.' : null
  const applied = value && value.from === from && value.to === to
  return (
    <div
      className={`report__range report__period${value ? ' report__range--active' : ''}`}
      role="group"
      aria-label="Rapor dönemi"
    >
      <MonthField label="Başlangıç" value={from} onChange={setFrom} max={now} />
      <MonthField label="Bitiş" value={to} onChange={setTo} max={now} />
      <button
        type="button"
        className="series-page__btn report__apply"
        disabled={Boolean(error) || applied}
        onClick={() => onChange({ from, to })}
      >
        {applied ? 'Uygulandı' : 'Aralığı uygula'}
      </button>
      {value && (
        <button type="button" className="series-page__btn" onClick={() => onChange(null)}>
          {currentLabel}
        </button>
      )}
      {error && <span className="report__range-error">{error}</span>}
    </div>
  )
}

// Raporlar: tek menü, üç sekme (2026-10-06), üçü de aynı belge biçiminde (özet → başlıklar → ek). Küresel
// görünüm eski "Etki analizi"nin yerini aldı; bütün ülkeleri kapsadığı için yalnızca yöneticiye görünür.
// Ülke brifingi ve dizi raporu herkese açık.

// Kıtası olmayan kayıtlar (Antarktika, Fransız Güney Toprakları) ülke değil; seçicide yer almaz.
const COUNTRY_OPTIONS = Object.entries(countryNames)
  .filter(([iso2]) => iso2 !== 'TR' && continentByIso2[iso2])
  .map(([iso2, c]) => ({ id: iso2, iso2, label: c.name }))
  .sort((a, b) => a.label.localeCompare(b.label, 'tr'))

export default function ReportsHub({
  isAdmin,
  tab,
  iso2,
  seriesId,
  continent = null,
  onChange,
  countries = [],
  onBack = null,
  backLabel,
  seriesActions = {},
  period = null,
}) {
  const tabs = [
    ...(isAdmin ? [{ key: 'kuresel', label: 'Küresel görünüm', Icon: IconGlobe }] : []),
    { key: 'ulke', label: 'Ülke brifingi', Icon: IconReport },
    { key: 'dizi', label: 'Dizi raporu', Icon: IconTv },
    { key: 'kita', label: 'Kıta raporu', Icon: IconGlobe },
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
            <>
              <PeriodPicker value={period} onChange={(p) => onChange({ period: p })} />
              <CountryReportView iso2={iso2} countryName={countryNames[iso2]?.name || iso2} period={period} />
            </>
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
          {seriesId && <PeriodPicker value={period} onChange={(p) => onChange({ period: p })} />}
          {seriesId ? (
            <SeriesReportView
              period={period}
              seriesId={seriesId}
              allCountries={countries}
              onBack={onBack}
              backLabel={backLabel}
              actions={seriesActions}
              isAdmin={isAdmin}
            />
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

      {active === 'kita' && (
        <>
          <div className="ts-scope report__continents" role="group" aria-label="Kıta">
            <span className="ts-scope__label">Kıta:</span>
            <div className="ts-scope__chips">
              {CONTINENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`ts-scope__chip${continent === c.id ? ' ts-scope__chip--active' : ''}`}
                  aria-pressed={continent === c.id}
                  onClick={() => onChange({ tab: 'kita', continent: c.id })}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          {continent ? (
            <>
              <PeriodPicker
                value={period}
                onChange={(p) => onChange({ period: p })}
                currentLabel="Son 12 ay"
                defaultFrom={ym(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1))}
              />
              <CountryReportView
                continent={continent}
                countryName={CONTINENTS.find((c) => c.id === continent)?.name || continent}
                period={period}
              />
            </>
          ) : (
            <p className="dashboard__empty">
              Kıta seçin: o kıtanın ülkelerinde en çok izlenen Türk dizileri, ülkeler, okunma, basın ve turizm.
            </p>
          )}
        </>
      )}

      {active === 'kuresel' && isAdmin && <GlobalReportView />}
    </div>
  )
}
