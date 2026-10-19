import { useEffect, useState } from 'react'
import { formatEther } from 'ethers'
import { TX_TYPES, ZERO_ADDRESS, errorMessage, readContract } from '../lib/caro'

const POLL_MS = 4000
const LIMIT = 100

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Lịch sử giao dịch đọc trực tiếp từ smart contract (getHistory). */
export default function TxHistory({ me, nameOf, onClose }) {
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!me) return
    let alive = true
    const load = async () => {
      try {
        const count = Number(await readContract.getHistoryCount(me))
        const start = Math.max(0, count - LIMIT)
        const list = count ? await readContract.getHistory(me, start, LIMIT) : []
        if (!alive) return
        setTotal(count)
        setRows(
          list
            .map((t, i) => ({
              no: start + i + 1,
              type: Number(t.txType),
              counterparty: t.counterparty,
              amount: t.amount,
              gameId: Number(t.gameId),
              balanceAfter: t.balanceAfter,
              timestamp: Number(t.timestamp),
            }))
            .reverse(),
        )
        setError(null)
      } catch (err) {
        if (alive) setError(errorMessage(err))
      }
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [me])

  return (
    <div className="bt-modal-backdrop" onClick={onClose}>
      <div className="bt-panel is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="bt-panel-head">
          📜 Lịch sử giao dịch
          <button className="bt-panel-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bt-panel-body">
          {!me ? (
            <p className="bt-muted">Kết nối ví để xem lịch sử giao dịch.</p>
          ) : (
            <>
              <p className="bt-muted">
                Mọi giao dịch của ví game được smart contract ghi lại trên blockchain
                {total > 0 && ` · ${total} giao dịch${total > LIMIT ? `, hiện ${LIMIT} gần nhất` : ''}`}.
              </p>
              {error && <p className="bt-field-error">{error}</p>}
              {rows == null ? (
                <p className="bt-muted">Đang tải…</p>
              ) : rows.length === 0 ? (
                <p className="bt-muted">Chưa có giao dịch nào. Hãy nạp tiền vào ví game để bắt đầu.</p>
              ) : (
                <div className="bt-panel-scroll">
                  <div className="bt-tx is-head">
                    <span />
                    <span>Giao dịch</span>
                    <span className="bt-tx-amount">Số tiền</span>
                    <span className="bt-tx-balance">Số dư sau</span>
                  </div>
                  {rows.map((t) => {
                    const meta = TX_TYPES[t.type] || { icon: '•', label: `Loại ${t.type}`, sign: 0 }
                    const details = []
                    if (t.counterparty !== ZERO_ADDRESS) {
                      const who = nameOf(t.counterparty)
                      details.push(
                        t.type === 2 ? `tới ${who}` : t.type === 3 ? `từ ${who}` : t.type === 4 ? `vs ${who}` : `đối thủ ${who}`,
                      )
                    }
                    if (t.gameId) details.push(`phòng #${t.gameId}`)
                    details.push(fmtTime(t.timestamp))
                    return (
                      <div key={t.no} className="bt-tx">
                        <span className="bt-tx-icon">{meta.icon}</span>
                        <span className="bt-tx-info">
                          <b>{meta.label}</b>
                          <span title={t.counterparty}>{details.join(' · ')}</span>
                        </span>
                        <span className={`bt-tx-amount ${meta.sign > 0 ? 'pos' : 'neg'}`}>
                          {meta.sign > 0 ? '+' : '−'}
                          {formatEther(t.amount)}
                        </span>
                        <span className="bt-tx-balance">{formatEther(t.balanceAfter)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
