// Her rapor bölümünün ortak kabuğu: başlık, içerik YA DA "veri yok + neden", varsa uyarı
// (caveat) ve metodoloji notu. Hangi bölümün görüneceğine sunucu (sectionOrder) karar verir;
// bu bileşen yalnızca verilen bölümü sözleşmeye (hesaplandi | hesaplanamaz + reason) göre basar.
export default function SectionShell({ section, children }) {
  const id = `rapor-bolum-${section.key}`
  const veriYok = section.status !== 'hesaplandi'
  return (
    <section
      className={`dashboard__section report__section${veriYok ? ' report__section--empty' : ''}`}
      aria-labelledby={id}
      data-section={section.key}
    >
      <h3 id={id} className="dashboard__section-title">
        {section.title}
      </h3>
      {veriYok ? (
        <p className="report__nodata">
          <strong>Veri yok.</strong> {section.reason || 'Neden belirtilmedi.'}
        </p>
      ) : (
        children
      )}
      {section.caveat && (
        <p className="report__caveat" role="note">
          <span aria-hidden="true">⚠ </span>
          {section.caveat}
        </p>
      )}
      {section.note && <p className="report__note">Metodoloji: {section.note}</p>}
    </section>
  )
}
