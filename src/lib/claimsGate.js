
export function isClaimLike(x) {
  return Boolean(x) && typeof x === 'object' && typeof x.claim_id === 'string'
}

/**
 * Yalnızca doğrulanmış iddialar. İddia olmayan öğeler olduğu gibi geçer.
 * Bayrağı eksik olan iddia ELENİR: alanın yokluğu "doğrulanmış" anlamına gelmez.
 */
export function onlyVerifiedClaims(claims) {
  if (!Array.isArray(claims)) return []
  return claims.filter((c) => (isClaimLike(c) ? c.passed_gates === true : true))
}
