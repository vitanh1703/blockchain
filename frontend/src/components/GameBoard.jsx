import { useEffect, useRef, useState } from 'react'
import { formatEther } from 'ethers'
import confetti from 'canvas-confetti'
import { MOVE_TIMEOUT, SIZE, STATUS, ZERO_ADDRESS, findWinningLine, sameAddress } from '../lib/caro'

const COLORS = { 1: 'var(--bt-x)', 2: 'var(--bt-o)' }

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function PlayerCard({ mark, name, bet, active, lost, remaining, right }) {
  const pct = (remaining / MOVE_TIMEOUT) * 100
  return (
    <div
      className={`bt-player ${right ? 'is-right' : ''} ${active ? 'is-turn' : ''} ${lost ? 'is-lost' : ''}`}
      style={{ '--pc': COLORS[mark] }}
    >
      <div className="bt-player-avatar">{mark === 1 ? 'X' : 'O'}</div>
      <div className="bt-player-info">
        <div className="bt-player-name">{name}</div>
        {active ? (
          <div className={`bt-timer ${remaining <= 30 ? 'is-urgent' : ''}`}>
            <div className="bt-timer-bar" style={{ width: `${pct}%` }} />
            <span>
              ⏱ {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
            </span>
          </div>
        ) : (
          <div className="bt-player-cash">💵 {bet} ETH</div>
        )}
      </div>
    </div>
  )
}

export default function GameBoard({
  game,
  view,
  lastMove,
  me,
  nameOf,
  busy,
  onMove,
  onSettle,
  onDispute,
  onCatchUp,
  onResign,
  onClaimTimeout,
  onBack,
}) {
  const now = useNow()
  const [dismissedEnd, setDismissedEnd] = useState(null)
  const celebrated = useRef(new Set())

  const finished = game?.status === STATUS.Finished
  const iWon = finished && sameAddress(game.winner, me)

  useEffect(() => {
    if (iWon && !celebrated.current.has(game.id)) {
      celebrated.current.add(game.id)
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 }, disableForReducedMotion: true })
    }
  }, [iWon, game?.id])

  if (!game || !view) return <div className="bt-status-pill">Đang tải bàn cờ…</div>

  const isX = sameAddress(game.playerX, me)
  const isO = sameAddress(game.playerO, me)
  const myMark = isX ? 1 : isO ? 2 : 0
  const playing = game.status === STATUS.Playing
  const { cells: board, turn, offchain, pending, winnerMark: pendingWin } = view
  const disputed = playing && !offchain
  const boardFull = view.moveCount === SIZE * SIZE
  // Đã có kết quả off-chain (5 quân hoặc kín bàn) nhưng chưa gửi lên chain
  const awaitingSettle = playing && (pendingWin !== 0 || boardFull)
  const myTurn = playing && !awaitingSettle && myMark === turn
  // Giờ của block có thể nhanh hơn giờ máy vài giây (Hardhat tăng 1s/block), nên giới hạn ở MOVE_TIMEOUT
  const remaining = Math.min(MOVE_TIMEOUT, Math.max(0, view.lastAt + MOVE_TIMEOUT - now))
  const timedOut = playing && !awaitingSettle && remaining === 0
  // Off-chain: hết giờ chỉ là dấu hiệu đối thủ treo máy, phải đưa ván lên chain mới bắt đầu tính giờ thật
  const canDispute = offchain && timedOut && myMark !== 0 && myMark !== view.clockTurn
  const canClaim = disputed && timedOut && myMark !== 0 && myMark !== game.turn
  // Bị đưa ván cũ lên chain trong khi mình đã đi off-chain: gửi các nước còn thiếu để chống lại
  const canCatchUp = disputed && !timedOut && myMark !== 0 && pending.length > 0 && myMark !== turn
  const canSettle = awaitingSettle && myMark !== 0 && (boardFull || myMark === pendingWin)
  const pot = game.betAmount * 2n
  const bet = formatEther(game.betAmount)
  const isDraw = finished && game.winner === ZERO_ADDRESS

  const finishedMark = sameAddress(game.winner, game.playerX) ? 1 : sameAddress(game.winner, game.playerO) ? 2 : 0
  const winMark = finished ? finishedMark : pendingWin
  const winLine = winMark ? findWinningLine(board, winMark) : new Set()
  const label = (addr) => (sameAddress(addr, me) ? 'Bạn' : nameOf(addr))
  const nameOfMark = (mark) => label(mark === 1 ? game.playerX : game.playerO)
  const turnName = nameOfMark(turn)
  const clockName = nameOfMark(view.clockTurn)

  let status
  if (finished) {
    status = (
      <div className="bt-status-pill is-done">
        {isDraw ? '🤝 Hoà — tiền cược đã hoàn lại' : iWon ? '🏆 Bạn thắng!' : `🏆 ${label(game.winner)} thắng`}
      </div>
    )
  } else if (awaitingSettle) {
    status = (
      <div className="bt-status-pill is-turn">
        {boardFull && !pendingWin
          ? '🤝 Bàn cờ đã kín — gửi kết quả lên blockchain để hoàn cược'
          : canSettle
            ? '🏆 Bạn đã thắng! Gửi kết quả lên blockchain để nhận thưởng'
            : `⏳ ${nameOfMark(pendingWin)} đã thắng, đang chờ gửi kết quả lên blockchain…`}
      </div>
    )
  } else if (timedOut) {
    let text
    if (canDispute) text = `${clockName} không đi — đưa ván lên blockchain để bắt đầu tính giờ`
    else if (canClaim) text = 'Đối thủ hết giờ — bạn có thể nhận thắng!'
    else if (offchain && myMark === view.clockTurn) text = 'Bạn đã quá giờ — đối thủ có thể đưa ván lên blockchain'
    else text = `${clockName} đã hết giờ`
    status = <div className="bt-status-pill is-turn">⏰ {text}</div>
  } else if (canCatchUp) {
    status = <div className="bt-status-pill is-turn">⚠️ Đối thủ đưa ván cũ lên blockchain — hãy gửi các nước bạn đã đi</div>
  } else if (myTurn) {
    status = <div className="bt-status-pill is-turn">👉 Đến lượt bạn — chọn một ô</div>
  } else {
    status = (
      <div className="bt-status-pill" style={{ '--pc': COLORS[turn] }}>
        <span className="bt-dot" /> {myMark ? `Đang chờ ${turnName} đi…` : `${turnName} đang suy nghĩ…`}
      </div>
    )
  }

  return (
    <div className="bt-game">
      <div className="bt-game-top">
        <PlayerCard
          mark={1}
          name={label(game.playerX)}
          bet={bet}
          active={playing && !awaitingSettle && view.clockTurn === 1}
          lost={winMark === 2}
          remaining={remaining}
        />
        <div className="bt-topbar">
          <div className="bt-topbar-round">Phòng #{game.id}</div>
          <div className="bt-topbar-pot">💰 {formatEther(pot)} ETH</div>
          <div className="bt-topbar-log">Hũ cược · {view.moveCount} nước</div>
          {playing && (
            <div
              className="bt-topbar-log"
              title={
                offchain
                  ? 'Nước đi được ký số và gửi thẳng cho đối thủ, không tốn gas. Hết ván mới gửi 1 giao dịch.'
                  : 'Ván đã đưa lên blockchain: mỗi nước là một giao dịch, quá 5 phút thì thua.'
              }
            >
              {offchain ? '⚡ Off-chain · không tốn gas' : '⛓️ Đang đánh trên blockchain'}
            </div>
          )}
        </div>
        <PlayerCard
          mark={2}
          name={label(game.playerO)}
          bet={bet}
          active={playing && !awaitingSettle && view.clockTurn === 2}
          lost={winMark === 1}
          remaining={remaining}
          right
        />
      </div>

      <div className="bt-board" style={{ '--size': SIZE }}>
        {board.map((cell, idx) => {
          const playable = myTurn && !(disputed && timedOut) && !canCatchUp && cell === 0 && !busy
          return (
            <button
              key={idx}
              className={`bt-cell m${cell} ${playable ? 'can-play' : ''} ${winLine.has(idx) ? 'is-win' : ''} ${
                idx === lastMove && !winLine.size ? 'is-last' : ''
              }`}
              disabled={!playable}
              onClick={() => onMove(idx % SIZE, Math.floor(idx / SIZE))}
              aria-label={`Ô ${idx % SIZE}, ${Math.floor(idx / SIZE)}`}
            >
              {cell === 1 ? 'X' : cell === 2 ? 'O' : ''}
            </button>
          )
        })}
      </div>

      <div className="bt-game-bottom">
        {status}
        <div className="bt-game-actions">
          <button className="bt-btn is-ghost" onClick={onBack}>
            ← Về sảnh
          </button>
          {playing && myMark !== 0 && (
            <button className="bt-btn is-danger" onClick={onResign} disabled={busy}>
              🏳️ Đầu hàng
            </button>
          )}
        </div>
        {canClaim && (
          <button className="bt-cta is-green" onClick={onClaimTimeout} disabled={busy}>
            NHẬN THẮNG
          </button>
        )}
        {canSettle && (
          <button className="bt-cta is-green" onClick={onSettle} disabled={busy}>
            {boardFull && !pendingWin ? 'GỬI KẾT QUẢ HOÀ' : 'NHẬN THƯỞNG'}
          </button>
        )}
        {canDispute && (
          <button className="bt-cta" onClick={onDispute} disabled={busy}>
            ĐƯA VÁN LÊN BLOCKCHAIN
          </button>
        )}
        {canCatchUp && (
          <button className="bt-cta" onClick={onCatchUp} disabled={busy}>
            GỬI {pending.length} NƯỚC ĐÃ ĐI
          </button>
        )}
      </div>

      {finished && dismissedEnd !== game.id && (
        <div className="bt-modal-backdrop" onClick={() => setDismissedEnd(game.id)}>
          <div className="bt-panel bt-end" onClick={(e) => e.stopPropagation()}>
            <div className="bt-panel-head">Kết thúc trận #{game.id}</div>
            <div className="bt-panel-body">
              <div className="bt-end-trophy">{isDraw ? '🤝' : iWon ? '🏆' : myMark ? '😢' : '🏆'}</div>
              <h2>{isDraw ? 'Hoà!' : `${label(game.winner)} chiến thắng!`}</h2>
              {isDraw ? (
                <p className="bt-muted">Bàn cờ đã kín. Mỗi bên được hoàn {bet} ETH.</p>
              ) : (
                <>
                  <div className="bt-end-reward">+{formatEther((pot * 98n) / 100n)} ETH</div>
                  <p className="bt-muted">
                    {iWon ? 'Tiền thưởng đã được cộng vào ví game của bạn' : 'Tiền thưởng đã vào ví game của người thắng'} (98% hũ,
                    phí sàn 2%).
                  </p>
                </>
              )}
              <div className="bt-actions">
                <button className="bt-btn is-ghost" onClick={() => setDismissedEnd(game.id)}>
                  Xem bàn cờ
                </button>
                <button className="bt-btn is-primary" onClick={onBack}>
                  Về sảnh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
