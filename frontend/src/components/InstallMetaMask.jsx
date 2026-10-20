import { metaMaskInstallLink } from '../lib/caro'

/** Hiện khi bấm "Kết nối ví" mà trình duyệt chưa có MetaMask. */
export default function InstallMetaMask({ onClose }) {
  const { url, store } = metaMaskInstallLink()

  return (
    <div className="bt-modal-backdrop" onClick={onClose}>
      <div className="bt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bt-panel-head">
          🦊 Chưa cài MetaMask
          <button className="bt-panel-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bt-panel-body bt-rules">
          <p>
            Cần ví <b>MetaMask</b> để nạp tiền, chuyển tiền và đặt cược. Cài tiện ích từ <b>{store}</b> rồi quay lại trang
            này.
          </p>
          <a className="bt-btn is-primary bt-install-btn" href={url} target="_blank" rel="noopener noreferrer">
            Cài MetaMask từ {store} ↗
          </a>
          <ul>
            <li>Sau khi cài, tạo ví mới hoặc nhập private key tài khoản Ganache (xem README).</li>
            <li>Quay lại tab này và bấm nút bên dưới để tải lại trang.</li>
          </ul>
          <button className="bt-btn is-ghost" onClick={() => window.location.reload()}>
            🔄 Tôi đã cài xong — tải lại trang
          </button>
        </div>
      </div>
    </div>
  )
}
