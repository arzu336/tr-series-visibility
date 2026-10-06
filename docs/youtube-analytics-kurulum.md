# YouTube Analytics bağlantısı — kurulum ve izin adımları

Platform, yayıncı kanalların (ATV, Show TV, Star, Kanal D, TRT…) kendi YouTube raporlarını **salt okunur** izinle okur:
dizi × ülke × ay izlenme ve izlenme süresi. Kanal şifresi platforma hiçbir zaman gelmez; izin Google'ın onay ekranında
verilir, istendiğinde tek tıkla geri alınır.

Kod tarafı hazır (`server/services/youtubeAnalytics.js`, `server/routes/youtube.js`, Yönetim → YouTube bağlantıları).
Aşağıdaki adımlar bir kez yapılır.

---

## 1. Google Cloud projesi (kurum hesabıyla)

1. <https://console.cloud.google.com> → kurumun Google hesabıyla giriş → **Yeni proje** (ör. `gorunurluk-platformu`).
2. **API'ler ve Hizmetler → Kitaplık**: şu iki API'yi etkinleştirin:
   - **YouTube Data API v3** (kanal ve video listesi)
   - **YouTube Analytics API** (ülke kırılımlı raporlar)

## 1b. Herkese açık veri için API anahtarı (izin gerektirmez — hemen kullanılabilir)

Kanal sahiplerinin izni beklenmeden, resmî yayıncı kanallarının **herkese açık** verisi toplanabilir: bölüm
videolarının izlenme, beğeni ve yorum sayıları (dizi bazında, günlük; artış buradan hesaplanır) ve yorumların hangi
dillerde yazıldığı. Ülke kırılımı **yoktur** — o yalnızca aşağıdaki izinli bağlantıyla gelir.

1. **API'ler ve Hizmetler → Kimlik bilgileri → Kimlik bilgisi oluştur → API anahtarı.**
2. Anahtarı **kısıtlayın**: *API kısıtlamaları* → yalnızca **YouTube Data API v3**. (Sunucudan çağrıldığı için
   uygulama kısıtlaması olarak sunucunun IP adresi verilebilir.)
3. `server/.env` dosyasına ekleyin ve sunucuyu yeniden başlatın:

   ```
   YOUTUBE_API_KEY=<API anahtarı>
   ```

4. Yönetim → YouTube bağlantıları → **Herkese açık veri → Şimdi topla**. Sonrası her gün kendiliğinden toplanır;
   sonuçlar dizi sayfasındaki **YouTube** bölümünde görünür.

Ayrıntılar:

- Taranan kanallar: ATV, Show TV, Star, Kanal D, TRT 1, NOW, TV8, Kanal 7 (YouTube kullanıcı adlarıyla). İlk
  çalıştırmada bulunamayan kanal yönetim ekranında hata olarak görünür; liste
  `YOUTUBE_PUBLIC_CHANNELS=@atvturkiye,@showtv,...` ile değiştirilebilir.
- Kota: YouTube Data API günlük 10.000 birim ücretsiz; platform günde en çok 8.000 birim kullanır
  (`YOUTUBE_DAILY_QUOTA`). Büyük kanalların eski videoları birkaç güne yayılarak listelenir.
- Yorum dili kaba bir tahmindir (alfabe ve sık kelimeler); dil ülke değildir.

## 2. OAuth onay ekranı

**API'ler ve Hizmetler → OAuth onay ekranı**:

| Alan | Değer |
|---|---|
| Kullanıcı türü | **Harici** (kanallar kurum dışındaki hesaplarda) |
| Uygulama adı | Türk Dizileri Küresel Görünürlük Platformu |
| Destek e-postası / geliştirici iletişimi | kurumun kurumsal adresi |
| Uygulama ana sayfası, gizlilik politikası | platformun alan adındaki sayfalar (yayın aşamasında zorunlu) |
| Kapsamlar | `https://www.googleapis.com/auth/yt-analytics.readonly`, `https://www.googleapis.com/auth/youtube.readonly` |

**Test aşaması ve yayın:**

- Uygulama "Test" durumundayken yalnızca **Test kullanıcıları** listesine eklenen Google hesapları onay verebilir (en çok 100).
  Pilot için kanal hesaplarını buraya ekleyin.
- **Önemli:** Test durumundaki uygulamalarda Google'ın verdiği izin anahtarı **7 gün** sonra geçersiz olur; kanal
  her hafta yeniden bağlanmak zorunda kalır. Kalıcı kullanım için uygulama **yayınlanmalı** ve Google'ın doğrulamasından
  geçmelidir (bu kapsamlar "hassas" sınıfında). Doğrulama için alan adı doğrulaması, gizlilik politikası ve izinlerin
  nasıl kullanıldığını gösteren kısa bir video istenir; süreç birkaç gün ile birkaç hafta arasında sürebilir.
- Önerilen sıra: 2–3 kanalla test aşamasında pilot → veri anlamlıysa doğrulama başvurusu.

## 3. OAuth istemcisi

**API'ler ve Hizmetler → Kimlik bilgileri → Kimlik bilgisi oluştur → OAuth istemci kimliği**:

- Uygulama türü: **Web uygulaması**
- **Yetkilendirilmiş yönlendirme URI'leri** (birebir aynı yazılmalı):
  - Geliştirme: `http://localhost:5173/api/youtube/oauth/callback`
  - Üretim: `https://<platform alan adı>/api/youtube/oauth/callback`

Oluşturulan **istemci kimliği** ve **istemci gizli anahtarı** bir sonraki adımda kullanılır.

## 4. Sunucu ayarları (`server/.env`)

```
YOUTUBE_CLIENT_ID=<istemci kimliği>
YOUTUBE_CLIENT_SECRET=<istemci gizli anahtarı>
YOUTUBE_REDIRECT_URI=<3. adımdaki dönüş adresi, ortama göre>
YOUTUBE_TOKEN_KEY=<rastgele 64 karakter>
```

- Geliştirme ortamında `YOUTUBE_REDIRECT_URI` ve `YOUTUBE_TOKEN_KEY` eklendi; yalnızca istemci kimliği ve gizli anahtar
  eksik.
- `YOUTUBE_TOKEN_KEY` kanal izin anahtarlarını şifreler. Değiştirilirse bağlı kanalların yeniden bağlanması gerekir.
  Üretim için ayrı bir değer üretin:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Ayar sonrası sunucuyu yeniden başlatın. Yönetim → YouTube bağlantıları bölümünde "yapılandırılmadı" uyarısı kalkar.

## 5. Kanalın bağlanması

İki yol var; ikisinde de onayı kanala erişimi olan Google hesabı verir.

**A. Kurum hesabına kanal yöneticiliği (önerilen).** Kanal bir *Marka Hesabı* ise sahibi, kurumun Google hesabını
marka hesabına **Yönetici** olarak ekler (hesap ayarları → Marka hesabı → İzinleri yönet). Ardından platformdaki
yönetici, Yönetim → YouTube bağlantıları → **Kanal bağla** ile onay ekranına gider, kurum hesabıyla girip ilgili kanalı
seçer. Bütün kanallar tek kurum hesabından yönetilir; kanal sahibinin platforma girmesi gerekmez.

> Not: YouTube Studio'daki "Kanal izinleri" ile verilen *Görüntüleyen* rolünün API onay ekranında kanalı seçmeye yetip
> yetmediği ilk pilotta denenmelidir; yetmezse A yolundaki Marka Hesabı yöneticiliği gerekir.

**B. Kanal sahibinin kendisi onaylar.** Platform yöneticisinin oturumu açıkken kanal sahibi aynı tarayıcıda
**Kanal bağla**'ya basar, onay ekranında kendi Google hesabıyla giriş yapıp izni verir. (Yüz yüze ya da ekran
paylaşımıyla kısa bir oturum.)

Bağlanan kanal listede görünür. **Şimdi eşitle** ilk eşitlemeyi başlatır; sonrası her gün kendiliğinden yapılır.

## 6. Eşitleme ne yapar

1. Kanalın yüklediği videoları listeler (en yeniden eskiye; büyük kanallarda eski videolar birkaç güne yayılarak
   tamamlanır, çalıştırma başına en çok 10.000 video).
2. Video başlığını katalogdaki dizilerle eşler (Türkçe ad, Türkçe harfsiz yazım, İngilizce uluslararası ad).
3. Tamamlanmış aylar için **kanal toplamı** ve **dizi başına** ülke kırılımlı izlenme ve izlenme süresini yazar:
   ilk eşitlemede son 12 ay, sonrakilerde son 2 ay yeniden hesaplanır. İçinde bulunulan ay yazılmaz.

Saklanan: kanal adı, şifreli izin anahtarı, video kimliği ve başlığı, ülke × ay toplamları. Kişisel izleyici verisi
yoktur; YouTube bu raporlarda yalnızca toplam sayı verir.

**Bağlantıyı kaldır**: Google'daki izni geri alır ve kanalın platformdaki bütün verisini siler. Kanal sahibi izni
kendi tarafından da geri alabilir: <https://myaccount.google.com/permissions>.

## 7. Sonraki adım (veri geldikten sonra)

İlk ayın verisi geldiğinde "YouTube izlenmesi" göstergesi haritaya, dizi sayfasına ve ülke brifingine eklenecek.
Özellikle yayın kataloğu tutulmayan 36 ülkede (Afrika, Asya, adalar) ölçülmüş tek izlenme sinyali bu olacak.

---

## Ek: kanal sahiplerine gönderilecek izin metni

> **Konu:** Türk dizilerinin yurt dışı görünürlüğü için YouTube istatistiklerine salt okunur erişim
>
> Sayın yetkili,
>
> Cumhurbaşkanlığı İletişim Başkanlığı bünyesinde yürütülen *Türk Dizileri Küresel Görünürlük Platformu*, Türk
> dizilerinin hangi ülkelerde ne ölçüde izlendiğini ülke ülke izlemektedir. Yayın platformu verisinin bulunmadığı
> pek çok ülkede (özellikle Afrika ve Asya) dizilerin izlenmesini gösteren en güvenilir kaynak, kanalınızın YouTube
> istatistikleridir.
>
> Bu amaçla kanalınızın YouTube Analytics raporlarına **salt okunur** erişim izni rica ediyoruz:
>
> - Okunacak veri yalnızca **ülke ve ay bazında toplam izlenme ve izlenme süresidir**; izleyicilere ait kişisel veri
>   alınmaz, YouTube bu raporlarda zaten yalnızca toplam sayı verir.
> - İzin, Google'ın kendi onay ekranında verilir; kanal şifreniz paylaşılmaz ve Başkanlığa ulaşmaz.
> - Platform kanalınızda **hiçbir değişiklik yapamaz**; video yükleme, silme, yorum ya da ayar değiştirme yetkisi
>   istenmez.
> - İzni dilediğiniz an Google hesap ayarlarınızdan (myaccount.google.com/permissions) geri alabilirsiniz;
>   geri alındığında kanalınıza ait veriler platformdan silinir.
> - Veriler yalnızca kurum içi analiz ve raporlamada kullanılır, üçüncü taraflarla paylaşılmaz.
>
> İzin için iki yoldan birini tercih edebilirsiniz: kanalınızın Marka Hesabına kurumumuzun Google hesabını
> yönetici olarak eklemek, ya da kısa bir çevrim içi oturumda onayı sizin vermeniz. Uygun olduğunuz yolu ve iletişim
> kurabileceğimiz kişiyi bildirmenizi rica ederiz.
>
> Saygılarımızla,
