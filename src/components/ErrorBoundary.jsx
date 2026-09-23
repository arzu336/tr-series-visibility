import { Component } from 'react'

// React.lazy ile yüklenen bir chunk (ör. Globe3D ~1,9 MB) ağ hatasıyla gelmezse ya da bir
// bileşen render sırasında fırlatırsa, sınır yoksa tüm uygulama beyaz ekrana düşer. Bu sınır
// yalnızca sardığı bölgeyi düşürür, geri kalan arayüz çalışmaya devam eder ve kullanıcıya
// yeniden deneme imkânı verir. Hook'larla yazılamaz (getDerivedStateFromError sınıf API'si).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.name ? ` ${this.props.name}` : ''}]`, error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // Kullanıcı başka bir görünüme geçtiğinde (resetKey değişir) hata durumu sıfırlanır;
    // aksi halde bir kez çöken sekme, geri dönülünce de hata ekranında kalırdı.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  handleRetry = () => {
    this.setState({ error: null })
    this.props.onRetry?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.error, this.handleRetry)
    const chunkHatasi = /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(
      this.state.error?.message || ''
    )
    return (
      <div className="status status--error" role="alert" style={{ margin: '1rem' }}>
        <strong>{chunkHatasi ? 'Bu bölüm yüklenemedi.' : 'Bu bölümde bir hata oluştu.'}</strong>
        <p style={{ margin: '0.5rem 0' }}>
          {chunkHatasi
            ? 'Ağ bağlantısı kesilmiş ya da uygulama bu arada güncellenmiş olabilir. Sayfayı yenilemek genellikle çözer.'
            : String(this.state.error?.message || this.state.error)}
        </p>
        <button type="button" className="dashboard__link-btn" onClick={this.handleRetry}>
          Yeniden dene
        </button>
        {chunkHatasi && (
          <button type="button" className="dashboard__link-btn" style={{ marginLeft: '0.5rem' }} onClick={() => window.location.reload()}>
            Sayfayı yenile
          </button>
        )}
      </div>
    )
  }
}
