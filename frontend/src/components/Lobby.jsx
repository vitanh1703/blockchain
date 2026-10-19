import { useState } from 'react'
import { formatEther, parseEther } from 'ethers'
import { STATUS, STATUS_LABEL, sameAddress } from '../lib/caro'

const QUICK_BETS = ['0.01', '0.05', '0.1', '0.5']

export default function Lobby({ games, me, nameOf, busy, onCreate, onJoin, onCancel, onOpen }) {
  const [bet, setBet] = useState('0.05')

  function create(e) {
    e.preventDefault()
    try {
      onCreate(parseEther(bet))
    } catch {
      // số tiền không hợp lệ
    }
  }

  const rooms = games.filter((g) => g.status !== STATUS.Cancelled)
  const openCount = rooms.filter((g) => g.status === STATUS.Waiting).length

  return (
    <div className="bt-lobby">
      <div className="bt-logo">
        <div className="bt-logo-globe">❌⭕</div>
        <div className="bt-logo-main">CỜ CARO</div>
        <div className="bt-logo-sub">ĐẶT CƯỢC</div>
      </div>

      <div className="bt-sheet">
        <p className="bt-tagline">
          Đặt cược ETH, ai có <b>5 quân liên tiếp</b> trước là thắng. Smart contract giữ tiền cược và tự trả thưởng.
        </p>

        <form className="bt-create" onSubmit={create}>
          <label htmlFor="bet">Tiền cược mỗi bên</label>
          <div className="bt-bet-input">
            <input
              id="bet"
              className="bt-input"
              type="number"
              min="0"
              step="0.01"
              value={bet}
              onChange={(e) => setBet(e.target.value)}
            />
            <span>ETH</span>
          </div>
          <div className="bt-chips">
            {QUICK_BETS.map((b) => (
              <button type="button" key={b} className={`bt-chip ${bet === b ? 'is-on' : ''}`} onClick={() => setBet(b)}>
                {b}
              </button>
            ))}
          </div>
          <button className="bt-cta" type="submit" disabled={!me || busy}>
            TẠO PHÒNG
          </button>
          <p className="bt-muted">
            {me ? 'Ví game thiếu tiền thì phần còn thiếu được nạp từ MetaMask trong cùng giao dịch.' : 'Kết nối ví MetaMask ở góc trên để chơi.'}
          </p>
        </form>

        <div className="bt-live">
          <div className="bt-live-head">
            <span className="bt-live-dot" /> Phòng chơi
            {openCount > 0 && <span className="bt-live-count">{openCount} đang chờ</span>}
          </div>
          {rooms.length === 0 ? (
            <p className="bt-live-empty">Chưa có phòng nào. Hãy tạo phòng đầu tiên!</p>
          ) : (
            <div className="bt-live-list">
              {rooms.map((g) => {
                const isX = sameAddress(g.playerX, me)
                const mine = isX || sameAddress(g.playerO, me)
                const waiting = g.status === STATUS.Waiting
                return (
                  <div
                    key={g.id}
                    className={`bt-live-item ${mine ? 'is-mine' : ''} ${g.status === STATUS.Finished ? 'is-done' : ''}`}
                  >
                    <div className="bt-live-marks">
                      <span className="bt-mini m1">X</span>
                      <span className={`bt-mini ${waiting ? 'is-empty' : 'm2'}`}>{waiting ? '?' : 'O'}</span>
                    </div>
                    <div className="bt-live-info">
                      <b>
                        #{g.id} · {isX ? 'Bạn' : nameOf(g.playerX)}
                        {!waiting && ` vs ${sameAddress(g.playerO, me) ? 'Bạn' : nameOf(g.playerO)}`}
                      </b>
                      <span>
                        <em className={`bt-status s${g.status}`}>{STATUS_LABEL[g.status]}</em> · Cược {formatEther(g.betAmount)} ETH
                      </span>
                    </div>
                    {waiting && isX && (
                      <button className="bt-live-btn is-cancel" onClick={() => onCancel(g.id)} disabled={busy}>
                        Huỷ
                      </button>
                    )}
                    {waiting && !isX && (
                      <button className="bt-live-btn is-join" onClick={() => onJoin(g)} disabled={!me || busy}>
                        🪑 Vào
                      </button>
                    )}
                    {!waiting && (
                      <button className="bt-live-btn" onClick={() => onOpen(g.id)}>
                        {mine && g.status === STATUS.Playing ? '🎮 Chơi' : '👀 Xem'}
                      </button>
                    )}
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
