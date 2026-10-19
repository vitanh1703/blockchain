import { useEffect, useState } from 'react'
import { api, goToGoogleLogin } from '../lib/api'

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)

export default function LoginPage({ error }) {
  const [configured, setConfigured] = useState(null)

  useEffect(() => {
    api('/auth/config')
      .then((c) => setConfigured(c.googleConfigured))
      .catch(() => setConfigured(false))
  }, [])

  return (
    <div className="bt-login">
      <div className="bt-logo">
        <div className="bt-logo-globe">❌⭕</div>
        <div className="bt-logo-main">CỜ CARO</div>
        <div className="bt-logo-sub">ĐẶT CƯỢC</div>
      </div>

      <div className="bt-sheet bt-login-card">
        <p className="bt-tagline">
          Đặt cược ETH, ai có <b>5 quân liên tiếp</b> trước là thắng. Đăng nhập để vào sảnh chờ, đặt nickname và lên bảng
          xếp hạng.
        </p>
        {error && <p className="bt-field-error">⚠️ {error}</p>}
        <button className="bt-google-btn" onClick={goToGoogleLogin} disabled={configured === false}>
          <GoogleIcon /> Đăng nhập bằng Google
        </button>
        {configured === false && (
          <p className="bt-field-error">
            Backend chưa cấu hình đăng nhập Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET trong backend/.env), hoặc
            backend chưa chạy.
          </p>
        )}
        <p className="bt-muted">
          Sau khi đăng nhập, kết nối ví MetaMask để nạp tiền và đặt cược. Ví được liên kết với tài khoản Google của bạn.
        </p>
      </div>
    </div>
  )
}
