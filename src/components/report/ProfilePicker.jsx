export const ACCESS_LABELS = {
  viewer: 'Tüm kullanıcılar',
  analyst: 'Analist ve üstü',
  admin: 'Yalnızca yönetici',
}

const PROFILE_DESCRIPTIONS = {
  executive: 'İzlenme düzeyi, platform listeleri, ülkeler arası konum, trend ve bulgular.',
  marketing: 'Platform listeleri, öne çıkan diziler, tema dağılımı, arama ilgisi ve basın tonu.',
  producer: 'Platform listeleri, yayın varlığı, Netflix geçmişi, boşluk analizi ve turizm sinyali.',
}

// Üç profil kartı, radyo grubu gibi davranır: Tab ile gruba girilir, ok tuşları erişilebilir
// kartlar arasında dolaşır, Enter/Space seçer. Erişilemeyen profil pasif kalır ve nedenini yazar.
export default function ProfilePicker({ profiles, value, onChange, disabled = false }) {
  const erisilebilir = profiles.filter((p) => p.allowed)

  const handleKeyDown = (e, current) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    if (erisilebilir.length === 0) return
    e.preventDefault()
    const i = erisilebilir.findIndex((p) => p.id === current)
    let sonraki
    if (e.key === 'Home') sonraki = erisilebilir[0]
    else if (e.key === 'End') sonraki = erisilebilir[erisilebilir.length - 1]
    else {
      const ileri = e.key === 'ArrowRight' || e.key === 'ArrowDown'
      sonraki = erisilebilir[(i + (ileri ? 1 : -1) + erisilebilir.length) % erisilebilir.length]
    }
    onChange?.(sonraki.id)
    e.currentTarget.parentElement?.querySelector(`[data-profile="${sonraki.id}"]`)?.focus()
  }

  return (
    <div className="profile-picker" role="radiogroup" aria-label="Rapor profili">
      {profiles.map((p) => {
        const secili = p.id === value
        const pasif = !p.allowed || disabled
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            data-profile={p.id}
            className={`profile-card${secili ? ' profile-card--selected' : ''}${!p.allowed ? ' profile-card--locked' : ''}`}
            aria-checked={secili}
            aria-disabled={pasif || undefined}
            disabled={pasif}
            tabIndex={pasif ? -1 : secili || (!value && erisilebilir[0]?.id === p.id) ? 0 : -1}
            onClick={() => !pasif && onChange?.(p.id)}
            onKeyDown={(e) => !pasif && handleKeyDown(e, p.id)}
            title={
              p.allowed ? undefined : `Bu profil için ${ACCESS_LABELS[p.minAccess] || p.minAccess} erişimi gerekir`
            }
          >
            <span className="profile-card__title">{p.title}</span>
            <span className="profile-card__desc">{PROFILE_DESCRIPTIONS[p.id] || ''}</span>
            <span className={`profile-card__access${p.allowed ? '' : ' profile-card__access--locked'}`}>
              {p.allowed
                ? ACCESS_LABELS[p.minAccess] || p.minAccess
                : `Erişim yok — ${ACCESS_LABELS[p.minAccess] || p.minAccess}`}
            </span>
          </button>
        )
      })}
    </div>
  )
}
