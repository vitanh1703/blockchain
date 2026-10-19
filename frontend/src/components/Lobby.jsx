import { useState } from 'react'
import { formatEther, parseEther } from 'ethers'
import { STATUS, STATUS_LABEL, sameAddress, shortAddress } from '../lib/caro'

export default function Lobby({ games, me, busy, onCreate, onJoin, onCancel, onOpen }) {
  const [bet, setBet] = useState('0.05')

  function create(e) {
    e.preventDefault()
    try {
      onCreate(parseEther(bet))
    } catch {
      // số tiền không hợp lệ
    }
  }

  return (
    <section className="lobby">
      <form className="create-room" onSubmit={create}>
        <h2>Tạo phòng mới</h2>
        <label>
          Tiền cược (ETH)
          <input type="number" min="0" step="0.01" value={bet} onChange={(e) => setBet(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={!me || busy}>
          Tạo phòng
        </button>
        <p className="hint">Nếu số dư ví game không đủ, phần thiếu sẽ được nạp từ MetaMask trong cùng giao dịch.</p>
      </form>

      <div className="room-list">
        <h2>Sảnh chờ</h2>
        {games.length === 0 ? (
          <p className="hint">Chưa có phòng nào. Hãy tạo phòng đầu tiên!</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Chủ phòng (X)</th>
                <th>Đối thủ (O)</th>
                <th>Cược</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const mine = sameAddress(g.playerX, me) || sameAddress(g.playerO, me)
                return (
                  <tr key={g.id} className={mine ? 'mine' : ''}>
                    <td>{g.id}</td>
                    <td title={g.playerX}>{sameAddress(g.playerX, me) ? 'Bạn' : shortAddress(g.playerX)}</td>
                    <td title={g.playerO}>
                      {g.status === STATUS.Waiting ? '—' : sameAddress(g.playerO, me) ? 'Bạn' : shortAddress(g.playerO)}
                    </td>
                    <td>{formatEther(g.betAmount)} ETH</td>
                    <td>
                      <span className={`status s${g.status}`}>{STATUS_LABEL[g.status]}</span>
                    </td>
                    <td className="actions">
                      {g.status === STATUS.Waiting && sameAddress(g.playerX, me) && (
                        <button onClick={() => onCancel(g.id)} disabled={busy}>
                          Huỷ
                        </button>
                      )}
                      {g.status === STATUS.Waiting && !sameAddress(g.playerX, me) && (
                        <button className="primary" onClick={() => onJoin(g)} disabled={!me || busy}>
                          Tham gia
                        </button>
                      )}
                      {g.status !== STATUS.Waiting && g.status !== STATUS.Cancelled && (
                        <button onClick={() => onOpen(g.id)}>{mine && g.status === STATUS.Playing ? 'Chơi' : 'Xem'}</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
