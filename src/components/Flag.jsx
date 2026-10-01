import 'flag-icons/css/flag-icons.min.css'

// Küçük ülke bayrağı. Emoji bayraklar Windows'ta görünmüyor (harf çifti olarak çıkıyor); bu yüzden
// uygulamayla birlikte paketlenen SVG bayraklar (flag-icons, MIT) kullanılır — dış istek yok, CSP'ye takılmaz.
export default function Flag({ iso2, title }) {
  if (typeof iso2 !== 'string' || !/^[A-Za-z]{2}$/.test(iso2)) return null
  return (
    <span
      className={`fi fi-${iso2.toLowerCase()} country-flag`}
      {...(title ? { role: 'img', 'aria-label': title, title } : { 'aria-hidden': 'true' })}
    />
  )
}
