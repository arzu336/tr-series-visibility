import SectionShell from './SectionShell.jsx'
import { SECTION_COMPONENTS } from './ReportSections.jsx'
import { fmtDateTime, fmtWeek } from './format.js'

// Raporun kendisi: başlık, bölümler (sunucunun sectionOrder sırasıyla), eksik veri kutusu.
// Saf bileşen — ağ çağrısı yok; SSR testleri ve baskı ölçümü bunu doğrudan basar.
export default function CountryReportDocument({ report, countryName }) {
  const cut = report.dataCutoffs || {}
  const gaps = report.dataGaps || []
  return (
    <article className={`report__doc report__doc--${report.profile}`} lang="tr">
      <header className="report__head">
        <p className="report__kicker">Ülke raporu · {report.profileTitle}</p>
        <h1>{countryName}</h1>
        <p className="report__meta">
          Üretim: {fmtDateTime(report.generatedAt)} · Görünürlük verisi: {fmtDateTime(cut.visibilityUpdatedAt)} ·
          Netflix Top 10 son hafta: {cut.netflixLastWeek ? fmtWeek(cut.netflixLastWeek) : 'kayıt yok'} · Demografi:{' '}
          {cut.demographicsYear ?? '—'}
        </p>
      </header>

      {report.isTracked === false && (
        <p className="report__caveat" role="note">
          Bu ülke takip listesinde değil; bölümlerin çoğu hesaplanamaz.
        </p>
      )}

      {(report.sectionOrder || []).map((key) => {
        const s = report.sections?.[key]
        if (!s) return null
        const Cmp = SECTION_COMPONENTS[key]
        return (
          <SectionShell key={key} section={s}>
            {Cmp ? <Cmp data={s.data} /> : <p className="dashboard__empty">Bu bölüm için görünüm tanımlı değil.</p>}
          </SectionShell>
        )
      })}

      <aside className="report__gaps" aria-labelledby="rapor-eksik-veri">
        <h3 id="rapor-eksik-veri">Eksik veri</h3>
        {gaps.length === 0 ? (
          <p>Bu profildeki tüm bölümler hesaplandı.</p>
        ) : (
          <ul>
            {gaps.map((g) => (
              <li key={g.section}>
                <strong>{g.title}:</strong> {g.reason}
              </li>
            ))}
          </ul>
        )}
      </aside>

      <footer className="report__footer">
        Rapor yalnızca önbellekteki veriden üretildi; ücretli dış sorgu yapılmadı. Sözleşme: {report.contract}
      </footer>
    </article>
  )
}
