// Gọi backend (Vite proxy /api -> http://localhost:4000)
const TOKEN_KEY = 'caro.token'

export async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || `Lỗi máy chủ (HTTP ${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // trình duyệt chặn localStorage: phiên chỉ tồn tại tới khi tải lại trang
  }
}

/** Google redirect về /#token=... hoặc /#error=...; đọc rồi xoá khỏi thanh địa chỉ. */
export function takeAuthResultFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('token')
  const error = params.get('error')
  if (token || error) window.history.replaceState(null, '', window.location.pathname)
  return { token, error }
}

/** Chuyển sang trang chọn tài khoản Google (dùng cho cả đăng nhập lẫn đổi tài khoản). */
export function goToGoogleLogin() {
  window.location.href = '/api/auth/google'
}

/** Liên kết ví MetaMask vào tài khoản: lấy message -> ký bằng ví -> backend kiểm tra chữ ký. */
export async function linkWallet(signer, token) {
  const address = await signer.getAddress()
  const { message } = await api(`/wallet/nonce?address=${address}`, { token })
  const signature = await signer.signMessage(message)
  return api('/wallet/link', { method: 'POST', token, body: { signature } })
}
