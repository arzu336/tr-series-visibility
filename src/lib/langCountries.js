// Wikipedia dili → ülke eşlemesi. Wikimedia okunma verisi DİL bazlıdır; ülke sinyaline çevirmek
// için bu tablo kullanılır. Kural: tek ülkeli dil ülke sinyali sayılır; birden çok ülkede konuşulan
// dil "bölgesel" işaretlenir (izlenme sinyalinde ağırlığı yarıya iner, arayüzde etiketlenir).
// İngilizce bilinçli olarak EŞLENMEZ: onlarca ülkeye yayılır, ülke sinyali üretmez.
// Bakım: yeni dil eklerken ISO 639-1 kodu ve ISO 3166-1 alpha-2 ülke kodları; test dosyası kodları doğrular.

const REGIONAL = (iso) => ({ regional: true, iso })
const SINGLE = (iso) => ({ regional: false, iso: [iso] })

export const LANG_COUNTRIES = {
  tr: SINGLE('TR'),
  ar: REGIONAL([
    'SA',
    'AE',
    'EG',
    'IQ',
    'JO',
    'KW',
    'LB',
    'LY',
    'MA',
    'DZ',
    'TN',
    'OM',
    'QA',
    'BH',
    'YE',
    'PS',
    'SY',
    'SD',
  ]),
  es: REGIONAL([
    'ES',
    'MX',
    'AR',
    'CO',
    'CL',
    'PE',
    'VE',
    'EC',
    'GT',
    'CU',
    'BO',
    'DO',
    'HN',
    'PY',
    'SV',
    'NI',
    'CR',
    'PA',
    'UY',
  ]),
  pt: REGIONAL(['BR', 'PT', 'AO', 'MZ']),
  fa: REGIONAL(['IR', 'AF']),
  ru: REGIONAL(['RU', 'BY', 'KZ', 'KG']),
  fr: REGIONAL(['FR', 'BE', 'CH', 'CA', 'SN', 'CI', 'CM', 'MA', 'DZ', 'TN']),
  de: REGIONAL(['DE', 'AT', 'CH']),
  el: REGIONAL(['GR', 'CY']),
  ro: REGIONAL(['RO', 'MD']),
  nl: REGIONAL(['NL', 'BE']),
  zh: REGIONAL(['CN', 'TW', 'HK', 'SG']),
  sq: REGIONAL(['AL', 'XK', 'MK']),
  ms: REGIONAL(['MY', 'SG', 'BN']),
  sw: REGIONAL(['KE', 'TZ', 'UG']),
  it: SINGLE('IT'),
  bg: SINGLE('BG'),
  pl: SINGLE('PL'),
  sr: SINGLE('RS'),
  hu: SINGLE('HU'),
  uk: SINGLE('UA'),
  id: SINGLE('ID'),
  he: SINGLE('IL'),
  hr: SINGLE('HR'),
  ja: SINGLE('JP'),
  bn: SINGLE('BD'),
  sk: SINGLE('SK'),
  uz: SINGLE('UZ'),
  cs: SINGLE('CZ'),
  sv: SINGLE('SE'),
  ka: SINGLE('GE'),
  az: SINGLE('AZ'),
  vi: SINGLE('VN'),
  mk: SINGLE('MK'),
  sl: SINGLE('SI'),
  bs: SINGLE('BA'),
  ko: SINGLE('KR'),
  kk: SINGLE('KZ'),
  hi: SINGLE('IN'),
  ur: SINGLE('PK'),
  hy: SINGLE('AM'),
  et: SINGLE('EE'),
  th: SINGLE('TH'),
  fi: SINGLE('FI'),
  da: SINGLE('DK'),
  no: SINGLE('NO'),
  lt: SINGLE('LT'),
  lv: SINGLE('LV'),
  tk: SINGLE('TM'),
  ky: SINGLE('KG'),
  mn: SINGLE('MN'),
  km: SINGLE('KH'),
  my: SINGLE('MM'),
  si: SINGLE('LK'),
  ne: SINGLE('NP'),
  am: SINGLE('ET'),
  is: SINGLE('IS'),
  mt: SINGLE('MT'),
  ga: SINGLE('IE'),
  // 2026-10-06: maddesi ve okunması olduğu hâlde hiçbir ülkeye bağlanmamış diller. Tacikçe Tacikistan'a, Hausaca
  // Nijer'e ikinci izlenme kaynağı verir; lehçe vikileri (Mısır ve Fas Arapçası, Güney Azerbaycan Türkçesi)
  // ortak Arapça/Farsçanın aksine tek ülkeye ayrılabilen okunmadır.
  tg: SINGLE('TJ'),
  ha: REGIONAL(['NG', 'NE']),
  arz: SINGLE('EG'),
  ary: SINGLE('MA'),
  azb: SINGLE('IR'),
  zu: SINGLE('ZA'),
}

/** Bilinçli olarak eşlenmeyen wiki kodları (ülke sinyali üretmez ya da dil değil). */
export const UNMAPPED_LANGS = new Set(['en', 'simple', 'sh', 'ckb', 'diq', 'commons', 'meta', 'wikidata'])

/** Bir ülkenin eşlendiği diller: [{ lang, regional }]. Yoksa boş liste. */
export function languagesOfCountry(iso2) {
  const out = []
  for (const [lang, spec] of Object.entries(LANG_COUNTRIES)) {
    if (spec.iso.includes(iso2)) out.push({ lang, regional: spec.regional })
  }
  return out
}

/** Dilin eşlendiği ülkeler ve bölgesel bayrağı; eşlenmemiş dilde null. */
export function countriesOfLanguage(lang) {
  return LANG_COUNTRIES[lang] ?? null
}
