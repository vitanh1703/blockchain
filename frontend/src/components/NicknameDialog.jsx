import { useState } from 'react'

export default function NicknameDialog({ current, onSave, onClose }) {
  const [value, setValue] = useState(current || '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(value.trim())
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bt-modal-backdrop" onClick={onClose}>
      <form className="bt-panel" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="bt-panel-head">
          {current ? 'Đổi nickname' : 'Chọn nickname'}
          <button type="button" className="bt-panel-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bt-panel-body">
          <p className="bt-muted">Nickname sẽ hiện ở sảnh chờ, bàn cờ và bảng xếp hạng thay cho địa chỉ ví.</p>
          <input
            className="bt-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="vd. CaoThuCaro_99"
            maxLength={20}
          />
          <p className="bt-muted">3–20 ký tự: chữ, số, dấu gạch dưới.</p>
          {error && <p className="bt-field-error">{error}</p>}
          <div className="bt-actions">
            <button type="button" className="bt-btn is-ghost" onClick={onClose}>
              Để sau
            </button>
            <button className="bt-btn is-primary" type="submit" disabled={saving}>
              Lưu
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
