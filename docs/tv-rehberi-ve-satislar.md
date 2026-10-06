# Televizyon rehberi (Afrika) ve dağıtımcı satış kayıtları

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
