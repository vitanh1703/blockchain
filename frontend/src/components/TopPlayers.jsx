import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatProfit, sameAddress, shortAddress } from '../lib/caro'

const POLL_MS = 5000
const LIMIT = 5
const MEDALS = ['🥇', '🥈', '🥉']

/** Top 5 bảng xếp hạng hiển thị ngay ở sảnh chờ. */
export default function TopPlayers({ me, onShowAll }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () =>
      api('/leaderboard')
        .then((data) => {
          if (!alive) return
          setRows(data.rows.slice(0, LIMIT))
          setFailed(false)
        })
        .catch(() => alive && setFailed(true))
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="bt-top">
      <div className="bt-top-head">
        <span>🏆 Top {LIMIT} cao thủ</span>
        <button className="bt-top-all" onClick={onShowAll}>
          Xem tất cả ›
        </button>
      </div>
      {failed ? (
        <p className="bt-live-empty">Không tải được bảng xếp hạng.</p>
      ) : rows == null ? (
        <p className="bt-live-empty">Đang tải…</p>
      ) : rows.length === 0 ? (
        <p className="bt-live-empty">Chưa có trận nào kết thúc. Thắng ván đầu tiên để lên bảng!</p>
      ) : (
        <ol className="bt-top-list">
          {rows.map((r) => {
            const isMe = sameAddress(r.address, me)
            const profit = BigInt(r.profitWei)
            return (
              <li key={r.address} className={`bt-top-item ${isMe ? 'is-me' : ''}`} title={r.address}>
                <span className={`bt-top-rank r${r.rank}`}>{MEDALS[r.rank - 1] || r.rank}</span>
                <span className="bt-top-name">
                  {r.nickname || shortAddress(r.address)}
                  {isMe && <span className="bt-you"> (bạn)</span>}
                </span>
                <span className="bt-top-wins">{r.wins} thắng</span>
                <span className={`bt-top-profit ${profit > 0n ? 'pos' : profit < 0n ? 'neg' : ''}`}>
                  {formatProfit(r.profitWei)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
