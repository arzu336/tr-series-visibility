function formatAge(hours) {
  if (hours == null) return 'Henüz kayıt yok'
  if (hours < 1) return '1 saatten az önce'
  return `${hours} saat önce`
}

const STATUS_LABELS = {
  güncel: 'Güncel',
  işleniyor: 'İşleniyor',
  'yeniden-denenecek': 'Yeniden denenecek',
  'yenileme-gerekli': 'Yenileme gerekli',
  'veri-bekleniyor': 'Veri bekleniyor',
}

export default function SourceHealth({ data, error }) {
  return (
    <section className="dashboard__section source-health">
      <div className="source-health__heading">
        <div>
          <h3 className="dashboard__section-title">Veri Güveni ve Kaynak Durumu</h3>
          <p className="dashboard__hint">Bu panel, rapordaki göstergelerin hangi veri kaynağından geldiğini ve ne kadar güncel olduğunu gösterir.</p>
        </div>
        {data?.generatedAt && <span className="source-health__generated">Kontrol: {new Date(data.generatedAt).toLocaleString('tr-TR')}</span>}
      </div>

      {error && <p className="dashboard__empty">Kaynak durumu alınamadı: {error}</p>}
      {!data && !error && <p className="dashboard__empty">Kaynak durumu kontrol ediliyor…</p>}
      {data && (
        <div className="source-health__grid">
          {data.sources.map((source) => (
            <article key={source.id} className="source-health__card">
              <div className="source-health__card-top">
                <h4>{source.name}</h4>
                <span className={`source-health__status source-health__status--${source.status}`}>{STATUS_LABELS[source.status] || source.status}</span>
              </div>
              <p>{source.detail}</p>
              {source.id === 'llm' && source.pending > 0 && (
                <p className="source-health__meta">{source.delayedRetries > 0 ? `${source.delayedRetries} kayıt geri deneme sırasında` : `${source.pending} kayıt sırada`}</p>
              )}
              {source.id !== 'llm' && <p className="source-health__meta">Son başarılı veri: {formatAge(source.freshnessHours)}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
