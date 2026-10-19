import { useEffect, useState } from 'react'
import { formatEther } from 'ethers'
import { api } from '../lib/api'
import { sameAddress, shortAddress } from '../lib/caro'

const POLL_MS = 5000

function formatProfit(wei) {
  const v = BigInt(wei)
  const eth = Number(formatEther(v < 0n ? -v : v)).toFixed(3)
  return v > 0n ? `+${eth}` : v < 0n ? `−${eth}` : eth
}

export default function Leaderboard({ me, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      api('/leaderboard')
        .then((data) => {
          if (!alive) return
          setRows(data.rows)
          setError(data.indexer?.error ? `Backend chưa đồng bộ được blockchain: ${data.indexer.error}` : null)
        })
        .catch((err) => alive && setError(`Không tải được bảng xếp hạng: ${err.message}`))
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="bt-modal-backdrop" onClick={onClose}>
      <div className="bt-panel is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="bt-panel-head">
          🏆 Bảng xếp hạng
          <button className="bt-panel-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="bt-panel-body">
          <p className="bt-muted">Xếp theo số trận thắng, rồi lợi nhuận. Kết quả được backend đọc trực tiếp từ smart contract.</p>
          {error && <p className="bt-field-error">{error}</p>}
          {rows == null ? (
            <p className="bt-muted">Đang tải…</p>
          ) : rows.length === 0 ? (
            <p className="bt-muted">Chưa có trận nào kết thúc.</p>
          ) : (
            <div className="bt-panel-scroll">
              <div className="bt-rank is-head">
                <span>#</span>
                <span>Người chơi</span>
                <span className="bt-rank-wld">T / B / H</span>
                <span className="bt-rank-profit">Lời/lỗ ETH</span>
              </div>
              {rows.map((r) => {
                const isMe = sameAddress(r.address, me)
                const profit = BigInt(r.profitWei)
                return (
                  <div key={r.address} className={`bt-rank ${isMe ? 'is-me' : ''}`}>
                    <span className={`bt-rank-no r${r.rank}`}>{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
                    <span className="bt-rank-name" title={r.address}>
                      <b>
                        {r.nickname || shortAddress(r.address)} {isMe && <span className="bt-you">(bạn)</span>}
                      </b>
                      <span>
                        {r.games} trận · thắng {Math.round(r.winRate * 100)}%
                      </span>
                    </span>
                    <span className="bt-rank-wld">
                      <span className="w">{r.wins}</span> / <span className="l">{r.losses}</span> / {r.draws}
                    </span>
                    <span className={`bt-rank-profit ${profit > 0n ? 'pos' : profit < 0n ? 'neg' : ''}`}>{formatProfit(r.profitWei)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
