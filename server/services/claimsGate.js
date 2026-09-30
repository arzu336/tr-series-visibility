/**
 * Bir nesnenin iddia olup olmadığı — ayırt edici `claim_id`, `passed_gates` DEĞİL.
 *
 * Önce `passed_gates` alanının varlığına bakıyordu ve bu kendi amacını baltalıyordu: bayrağı
 * eklemeyi unutan bir üreticinin çıktısı "iddia değil" sayılıp kapıdan olduğu gibi geçiyordu —
 * yani tam da yakalanması gereken durum, tek kaçış yoluydu. Kimlik alanı her iddiada var
 * (claims_models.Claim.claim_id) ve üreticinin unutamayacağı alan o.
 */
export function isClaimLike(x) {
  return Boolean(x) && typeof x === 'object' && typeof x.claim_id === 'string'
}

/**
 * Yalnızca doğrulanmış iddialar. İddia olmayan öğeler olduğu gibi geçer.
 *
 * `passed_gates` alanı olmayan bir iddia EKSİK sayılır ve elenir: alanın yokluğu
 * "doğrulanmış" anlamına gelmez. Varsayılan güvenli tarafta olmalı — yeni bir üretici
 * bayrağı eklemeyi unutursa çıktısı sessizce yayımlanmamalı.
 */
export function onlyVerifiedClaims(claims) {
  if (!Array.isArray(claims)) return []
  return claims.filter((c) => (isClaimLike(c) ? c.passed_gates === true : true))
}

/**
 * Elenen iddiaların sayısı — uç noktalar bunu loglayabilsin diye. Sessiz süzme, bir üreticinin
 * bozulduğunu fark etmeyi zorlaştırır: "hiç iddia yok" ile "hepsi elendi" farklı durumlardır.
 */
export function countUnverified(claims) {
  if (!Array.isArray(claims)) return 0
  return claims.filter((c) => isClaimLike(c) && c.passed_gates !== true).length
}

/**
 * Bir yanıt gövdesindeki iddia listelerini yerinde süzer ve ne kadar elendiğini döner.
 * Uç noktalar `res.json(...)` ÖNCESİNDE bunu çağırır.
 */
export function sanitizeClaimsPayload(payload) {
  if (!payload || typeof payload !== 'object') return { payload, removed: 0 }
  let removed = 0
  const gez = (node) => {
    if (Array.isArray(node)) {
      node.forEach(gez)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [anahtar, deger] of Object.entries(node)) {
      if (Array.isArray(deger) && deger.some(isClaimLike)) {
        removed += countUnverified(deger)
        node[anahtar] = onlyVerifiedClaims(deger)
      } else {
        gez(deger)
      }
    }
  }
  gez(payload)
  return { payload, removed }
}

/**
 * Ülke raporu için kapı: iddia listelerini süzer (yukarıdaki kural) VE `text` alanı taşıyan
 * metin öğelerinden (bulgular, açıklamalar) aksiyon önerisi içerenleri düşürür. Rapor üreticisi
 * zaten öneri yazmamalı; bu, ikinci savunma hattıdır. Yerinde çalışır, sayaçları döner.
 */
export function sanitizeReportPayload(payload, { direktifIceriyorMu } = {}) {
  const { removed: removedClaims } = sanitizeClaimsPayload(payload)
  let removedDirectives = 0
  if (typeof direktifIceriyorMu !== 'function' || !payload?.sections)
    return { payload, removedClaims, removedDirectives }

  const gez = (node) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const el = node[i]
        if (el && typeof el === 'object' && typeof el.text === 'string' && direktifIceriyorMu(el.text)) {
          node.splice(i, 1)
          removedDirectives++
        } else {
          gez(el)
        }
      }
      return
    }
    if (!node || typeof node !== 'object') return
    for (const deger of Object.values(node)) gez(deger)
  }
  gez(payload.sections)
  return { payload, removedClaims, removedDirectives }
}
