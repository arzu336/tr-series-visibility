# Televizyon rehberleri (Afrika, Arap kanalları), tabii ve dağıtımcı satış kayıtları

## İzin

DStv (MultiChoice) ve StarTimes'ın kullanım koşulları rehber içeriğinin yazılı izin olmadan kaydedilmesini ve
kullanılmasını yasaklar. Kurumun bu kaynaklar için yazılı izni sağladığı 2026-10-06'da bildirildi. İzin metinleri
kurum arşivinde saklanmalıdır. İzin geri alınırsa `server/.env` içinde `TV_GUIDE_ENABLED=false` ile toplama durur.

Toplanan: yalnızca program adı, kanal adı ve gün başına yayın sayısı. Açıklama, görsel ya da başka içerik alınmaz.

## DStv rehberi

- Kaynak: DStv'nin herkese açık program rehberi ucu, ülke başına günde tek istek (49 Afrika ülkesi, istekler arası
  1,5 sn).
- Zamanlayıcı günde bir kez çalışır; Yönetim → Televizyon yayınları → **Şimdi topla** ile elle başlatılabilir.
- Eşleşme: rehberdeki başlık, dizinin Türkçe adı ya da IMDb'deki herhangi bir dildeki yerel adıyla **tam eşit**
  olmalı ("Amor Proibido" → Aşk-ı Memnu).
- Belirsiz adlar: IMDb'de başka bir film ya da dizinin de adı olan yabancı adlar ("The Agency", "The Promise")
  yalnızca aynı toplamada kesin bir Türk dizisi eşleşmesi görülmüş kanalda kabul edilir. Belirsiz ad listesi IMDb
  veri setlerinden hesaplanır; veri setleri yenilendiğinde yeniden çalıştırın (yaklaşık 9 dakika):

  ```
  node server/scripts/tv-title-ambiguity.js
  ```

- Eşleşmeyen başlıklar (Türk dizisi yayınlayan kanallarda): Yönetim ekranında listelenir, **Diziye bağla** ile elle
  eşlenir; sonraki toplamada yayınları yazılır.

## elcinema (Arap kanalları) ve tabii

Kurum, elcinema.com ve tabii.com yöneticilerinden tarama izni alındığını 2026-10-09'da bildirdi. İzin metinleri kurum
arşivinde saklanmalıdır. İzin geri alınırsa `server/.env` içinde `ELCINEMA_ENABLED=0` / `TABII_ENABLED=0` ile durur.

- **elcinema** (`server/services/elcinemaGuide.js`): ~107 Arap kanalının (MBC 4, MBC Drama, OSN Ya Hala, Rotana
  Drama…) bugünden itibaren 3 günlük akışı günde bir; istekler arası 1,5 sn. Yalnızca dizi yayınları alınır. Türk
  dizisi, eser sayfasındaki **IMDb kimliğiyle** kataloğa bağlanır, yoksa özgün adın birebir eşleşmesiyle; yapım
  ülkesi Türkiye olmayan eser eşlenmez. Ülke, kanalın elcinema'daki ülkesidir (uydu yayını bölgeye yayılır).
  Yayınlar DStv ile aynı tabloya yazılır; ülke paneli ve dizi raporundaki televizyon bölümleri gösterir.
- **tabii** (`server/services/tabiiCatalog.js`): haftada bir herkese açık site haritasından katalog (~1.300 içerik),
  resmî SSS'den erişilebildiği ülkeler (52). Yalnızca TRT 1 ve tabii yapımları ad (slug) birebir tutuyorsa tabii'de
  sayılır; bu diziler o ülkelerde "tabii" platformunda yayında görünür. Giriş gerektiren sayfalar (arama, izleme)
  taranmaz. Çevrimdışı yedek ülke listesi: `src/data/tabii-countries.json`.

## mi.tv (Latin Amerika)

İzin: kurum, mi.tv yöneticisinden alınan iznin akış verisinin geldiği ve sitenin robots kurallarında taramaya kapalı
olan `/async/` adreslerini de kapsadığını 2026-10-09'da teyit etti. İzin geri alınırsa `MITV_ENABLED=0`.

- `server/services/miTvGuide.js`: 10 ülke (AR, BR, CL, CO, GT, HN, MX, PE, PY, SV). Türk dizisi görülmüş kanallar her
  gün, kalan kanallar 7 güne bölünüp dönüşümlü (ülke başına ~250 kanal, Brezilya 825); istekler arası 1 sn.
- Yalnızca dizi/telenovela kayıtları; eşleştirme DStv ile aynı (IMDb yerel adı birebir, belirsiz adlar yalnızca
  güvenilir kanalda). Eşleşmeyen başlıklar Yönetim ekranında elle bağlanabilir.

## Dağıtımcı satış tablosu

Yönetim → Televizyon yayınları → Dağıtımcı satış tablosu: dağıtımcı adını yazıp CSV yükleyin.

| Sütun | Zorunlu | Örnek |
|---|---|---|
| `dizi` | evet | `Aşk-ı Memnu` ya da TMDB kimliği `17635` |
| `ulke` | evet | `Kenya` ya da `KE` |
| `alici` | evet | `Citizen TV` (kanal ya da platform) |
| `baslangic` | hayır | `2024-01-01` (ya da `2024-01`, `2024`) |
| `bitis` | hayır | `2024-12-31` |

Ayraç virgül ya da noktalı virgül olabilir (Excel'in Türkçe ayarı). Aynı dağıtımcının yeni dosyası eskisinin yerini
alır. Tanınmayan satırlar nedeniyle birlikte listelenir; hiç geçerli satır yoksa eski kayıtlar korunur.
