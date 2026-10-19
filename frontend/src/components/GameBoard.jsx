import { useEffect, useState } from 'react'
import { formatEther } from 'ethers'
import { MOVE_TIMEOUT, SIZE, STATUS, ZERO_ADDRESS, findWinningLine, sameAddress, shortAddress } from '../lib/caro'

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function GameBoard({ game, board, me, busy, onMove, onResign, onClaimTimeout, onBack }) {
  const now = useNow()
  if (!game || !board) return <p className="hint">Đang tải bàn cờ…</p>

  const isX = sameAddress(game.playerX, me)
  const isO = sameAddress(game.playerO, me)
  const myMark = isX ? 1 : isO ? 2 : 0
  const playing = game.status === STATUS.Playing
  const myTurn = playing && myMark === game.turn
  const remaining = Math.max(0, game.lastMoveAt + MOVE_TIMEOUT - now)
  const timedOut = playing && remaining === 0
  const canClaim = timedOut && myMark !== 0 && myMark !== game.turn
  const pot = game.betAmount * 2n

  const winMark = sameAddress(game.winner, game.playerX) ? 1 : sameAddress(game.winner, game.playerO) ? 2 : 0
  const winLine = game.status === STATUS.Finished && winMark ? findWinningLine(board, winMark) : new Set()

  function playerLabel(addr, mark) {
    const name = sameAddress(addr, me) ? 'Bạn' : shortAddress(addr)
    const active = playing && game.turn === mark
    return (
      <div className={`player ${active ? 'active' : ''}`}>
        <span className={`mark m${mark}`}>{mark === 1 ? 'X' : 'O'}</span>
        <span title={addr}>{name}</span>
        {active && <span className="timer">{`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</span>}
      </div>
    )
  }

  let banner
  if (game.status === STATUS.Finished) {
    if (game.winner === ZERO_ADDRESS) banner = 'Hoà! Tiền cược đã được hoàn lại cho cả hai.'
    else if (sameAddress(game.winner, me)) banner = '🎉 Bạn thắng! Tiền thưởng đã được cộng vào ví game.'
    else banner = `Người thắng: ${shortAddress(game.winner)}`
  } else if (timedOut) {
    banner = canClaim ? 'Đối thủ đã hết giờ — bạn có thể nhận thắng.' : 'Đã hết giờ đi.'
  } else if (myTurn) {
    banner = 'Đến lượt bạn'
  } else if (myMark) {
    banner = 'Đang chờ đối thủ…'
  } else {
    banner = 'Bạn đang xem trận đấu'
  }

  return (
    <section className="game">
      <div className="game-side">
        <button onClick={onBack}>← Về sảnh</button>
        <h2>Phòng #{game.id}</h2>
        {playerLabel(game.playerX, 1)}
        {playerLabel(game.playerO, 2)}
        <div className="pot">
          Hũ cược đang khoá
          <b>{formatEther(pot)} ETH</b>
          <small>Người thắng nhận 98%, phí sàn 2%</small>
        </div>
        <p className={`banner ${game.status === STATUS.Finished ? 'done' : ''}`}>{banner}</p>
        {playing && myMark !== 0 && (
          <div className="game-actions">
            {canClaim && (
              <button className="primary" onClick={onClaimTimeout} disabled={busy}>
                Nhận thắng do hết giờ
              </button>
            )}
            <button className="danger" onClick={onResign} disabled={busy}>
              Đầu hàng
            </button>
          </div>
        )}
        <p className="hint">Số nước đã đi: {game.moveCount}</p>
      </div>

      <div className="board" style={{ '--size': SIZE }}>
        {board.map((cell, idx) => (
          <button
            key={idx}
            className={`cell m${cell} ${winLine.has(idx) ? 'win' : ''}`}
            disabled={!myTurn || timedOut || cell !== 0 || busy}
            onClick={() => onMove(idx % SIZE, Math.floor(idx / SIZE))}
            aria-label={`Ô ${idx % SIZE}, ${Math.floor(idx / SIZE)}`}
          >
            {cell === 1 ? 'X' : cell === 2 ? 'O' : ''}
          </button>
        ))}
      </div>
    </section>
  )
}
