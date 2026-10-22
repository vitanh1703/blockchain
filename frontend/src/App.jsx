import { useCallback, useEffect, useRef, useState } from 'react'
import { formatEther } from 'ethers'
import AccountBar from './components/AccountBar'
import Lobby from './components/Lobby'
import GameBoard from './components/GameBoard'
import InstallMetaMask from './components/InstallMetaMask'
import Leaderboard from './components/Leaderboard'
import LoginPage from './components/LoginPage'
import NicknameDialog from './components/NicknameDialog'
import RulesModal from './components/RulesModal'
import TxHistory from './components/TxHistory'
import {
  SIZE,
  STATUS,
  connectWallet,
  errorMessage,
  readContract,
  readProvider,
  sameAddress,
  shortAddress,
  toGame,
} from './lib/caro'
import { api, goToGoogleLogin, linkWallet, loadToken, saveToken, takeAuthResultFromUrl } from './lib/api'
import { fetchMoves, getSessionWallet, isFiveInRow, postMove, replay, signMove } from './lib/channel'
import { useTheme } from './lib/theme'
import './App.css'

const POLL_MS = 2000
const GAME_POLL_MS = 1000
const LOBBY_LIMIT = 50
const NAMES_POLL_MS = 5000
const NOTICE_MS = 3500

/**
 * Ghép trạng thái ván từ chain và các nước off-chain (relay) thành thứ hiển thị trên bàn cờ.
 * Các nước off-chain chỉ được dùng nếu nối tiếp đúng trạng thái trên chain (so digest).
 */
function buildView(game, chainCells, relay) {
  const moves = relay?.moves || []
  const r = replay(game.id, moves)
  const consistent = moves.length >= game.moveCount && r.hashes[game.moveCount] === game.stateHash
  const useRelay = consistent && moves.length > game.moveCount
  const playing = game.status === STATUS.Playing
  const offchain = playing && !game.disputed
  return {
    cells: useRelay ? r.cells : chainCells,
    turn: useRelay ? r.turn : game.turn,
    moveCount: useRelay ? moves.length : game.moveCount,
    hash: useRelay ? r.hash : game.stateHash,
    // Đã có 5 quân off-chain nhưng chưa gửi kết quả lên chain
    winnerMark: playing && useRelay ? r.winnerMark : 0,
    // Nước đã đánh off-chain mà chain chưa biết (gửi kèm khi chốt ván / tranh chấp)
    pending: consistent ? moves.slice(game.moveCount) : [],
    offchain,
    // Đánh off-chain: tính giờ theo relay (chỉ để báo đối thủ treo máy). Tranh chấp: giờ trên chain.
    clockTurn: offchain ? (useRelay ? r.turn : game.turn) : game.turn,
    lastAt: offchain ? (relay?.lastAt ?? game.lastMoveAt) : game.lastMoveAt,
  }
}

const submitArgs = (gameId, moves) => [gameId, moves.map((m) => m.x), moves.map((m) => m.y), moves.map((m) => m.sig)]

// Đọc kết quả Google redirect (#token / #error) một lần khi tải trang
const AUTH_FROM_URL = takeAuthResultFromUrl()
if (AUTH_FROM_URL.token) saveToken(AUTH_FROM_URL.token)

function App() {
  const theme = useTheme()
  const [token, setToken] = useState(() => loadToken())
  const [user, setUser] = useState(null) // tài khoản Google: { email, name, avatarUrl, nickname, displayName, walletAddress }
  const [authError, setAuthError] = useState(AUTH_FROM_URL.error)
  const [wallet, setWallet] = useState(null) // { signer, address, contract }
  const [names, setNames] = useState({}) // địa chỉ ví (chữ thường) -> tên hiển thị
  const [ethBalance, setEthBalance] = useState(null)
  const [walletBalance, setWalletBalance] = useState(null)
  const [games, setGames] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [activeGame, setActiveGame] = useState(null)
  const [view, setView] = useState(null) // bàn cờ đang mở: ghép chain + nước off-chain
  const [lastMove, setLastMove] = useState(null)
  const [modal, setModal] = useState(null) // 'leaderboard' | 'rules' | 'nickname' | 'history' | 'install' | null
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const boardRef = useRef({ id: null, cells: null })

  // Lấy thông tin tài khoản từ token đã lưu
  useEffect(() => {
    if (!token) return
    api('/me', { token })
      .then(({ user }) => {
        setUser(user)
        if (AUTH_FROM_URL.token && !user.nickname) setModal('nickname')
      })
      .catch((err) => {
        if (err.status === 401) {
          saveToken(null)
          setToken(null)
          setAuthError('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại')
        } else {
          setAuthError(`Không kết nối được backend: ${err.message}`)
          setToken(null)
        }
      })
  }, [token])

  const refresh = useCallback(async () => {
    try {
      const count = Number(await readContract.gameCount())
      const start = Math.max(1, count - LOBBY_LIMIT + 1)
      const list = count ? await readContract.getGames(start, LOBBY_LIMIT) : []
      setGames(list.map((raw, i) => toGame(start + i, raw)).reverse())

      if (wallet) {
        const [eth, bal] = await Promise.all([
          readProvider.getBalance(wallet.address),
          readContract.balances(wallet.address),
        ])
        setEthBalance(eth)
        setWalletBalance(bal)
      }
      if (activeId) {
        const [raw, chainCells, relay] = await Promise.all([
          readContract.getGame(activeId),
          readContract.getBoard(activeId),
          fetchMoves(activeId).catch(() => null), // backend tắt: vẫn xem được phần đã lên chain
        ])
        const game = toGame(activeId, raw)
        const next = buildView(game, chainCells.map(Number), relay)
        // So với lần đọc trước để tô sáng nước vừa đi
        const prev = boardRef.current
        if (prev.id === activeId && prev.cells) {
          const changed = next.cells.findIndex((c, i) => c !== prev.cells[i])
          if (changed !== -1) setLastMove(changed)
        }
        boardRef.current = { id: activeId, cells: next.cells }
        setActiveGame(game)
        setView(next)
      }
    } catch (err) {
      setNotice({ type: 'error', text: `Không đọc được dữ liệu từ blockchain: ${errorMessage(err)}` })
    }
  }, [wallet, activeId])

  const inGame = activeId != null
  useEffect(() => {
    if (!user) return
    // Đọc blockchain ngay rồi lặp lại; đang mở bàn cờ thì đọc nhanh hơn để thấy nước off-chain của đối thủ
    const first = setTimeout(refresh, 0)
    const id = setInterval(refresh, inGame ? GAME_POLL_MS : POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [refresh, user, inGame])

  // Tên hiển thị của mọi ví đã liên kết, lấy từ backend
  useEffect(() => {
    if (!user) return
    const load = () => api('/users').then(setNames).catch(() => {})
    load()
    const id = setInterval(load, NAMES_POLL_MS)
    return () => clearInterval(id)
  }, [user])

  // Thông báo thành công tự ẩn; thông báo lỗi giữ đến khi bấm vào
  useEffect(() => {
    if (notice?.type !== 'ok') return
    const id = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(id)
  }, [notice])

  const nameOf = (addr) => names[addr?.toLowerCase()] || shortAddress(addr)

  const connect = useCallback(async () => {
    try {
      setWallet(await connectWallet())
    } catch (err) {
      if (err.code === 'METAMASK_MISSING') setModal('install')
      else setNotice({ type: 'error', text: errorMessage(err) })
    }
  }, [])

  // Đổi tài khoản trong MetaMask -> app tự theo ví mới
  useEffect(() => {
    if (!window.ethereum) return
    const onAccounts = (accounts) => (accounts.length ? connect() : setWallet(null))
    const onChain = () => window.location.reload()
    window.ethereum.on('accountsChanged', onAccounts)
    window.ethereum.on('chainChanged', onChain)
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccounts)
      window.ethereum.removeListener('chainChanged', onChain)
    }
  }, [connect])

  async function logout() {
    await api('/auth/logout', { method: 'POST', token }).catch(() => {})
    saveToken(null)
    setToken(null)
    setUser(null)
    setActiveId(null)
    setModal(null)
  }

  async function switchGoogleAccount() {
    await logout()
    goToGoogleLogin()
  }

  async function linkCurrentWallet() {
    setBusy(true)
    try {
      const { user } = await linkWallet(wallet.signer, token)
      setUser(user)
      setNames((n) => ({ ...n, [user.walletAddress.toLowerCase()]: user.displayName }))
      setNotice({ type: 'ok', text: `Đã liên kết ví ${shortAddress(user.walletAddress)} với tài khoản` })
    } catch (err) {
      setNotice({ type: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function saveNickname(nickname) {
    const { user } = await api('/me/nickname', { method: 'PUT', token, body: { nickname } })
    setUser(user)
    if (user.walletAddress) setNames((n) => ({ ...n, [user.walletAddress.toLowerCase()]: user.displayName }))
    setModal(null)
    setNotice({ type: 'ok', text: `Xin chào, ${user.nickname}!` })
  }

  async function send(successText, makeTx) {
    setBusy(true)
    setNotice(null)
    try {
      const tx = await makeTx(wallet.contract)
      await tx.wait()
      if (successText) setNotice({ type: 'ok', text: successText })
      await refresh()
      return true
    } catch (err) {
      setNotice({ type: 'error', text: errorMessage(err) })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Gửi các nước off-chain (kèm chữ ký) lên contract: chốt kết quả, đưa ván lên chain hoặc đi nước khi tranh chấp. */
  function submitMoves(successText, moves) {
    return send(successText, (c) => c.submitMoves(...submitArgs(activeId, moves)))
  }

  async function playMove(x, y) {
    const g = activeGame
    const v = view
    const index = v.moveCount
    setBusy(true)
    setNotice(null)
    try {
      const sig = await signMove({ game: g, mark: v.turn, index, x, y, prevHash: v.hash, signer: wallet.signer })
      const move = { x, y, sig }
      if (!v.offchain) {
        // Ván đã đưa lên chain: mỗi nước là một giao dịch (kèm các nước off-chain chain chưa có)
        setBusy(false)
        await submitMoves(null, [...v.pending, move])
        return
      }
      await postMove(g.id, { index, ...move })
      const cells = [...v.cells]
      cells[y * SIZE + x] = v.turn
      await refresh()
      // Thắng hoặc kín bàn: gửi cả ván lên contract trong 1 giao dịch để nhận thưởng / hoàn cược
      if (isFiveInRow(cells, x, y, v.turn) || index + 1 === SIZE * SIZE) {
        setBusy(false)
        await submitMoves('Đã gửi kết quả ván lên blockchain', [...v.pending, move])
      }
    } catch (err) {
      setNotice({ type: 'error', text: errorMessage(err) })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  function openGame(id) {
    setView(null)
    setActiveGame(null)
    setLastMove(null)
    boardRef.current = { id: null, cells: null }
    setActiveId(id)
  }

  // Chưa đăng nhập: chỉ hiện trang đăng nhập Google
  if (!token || !user) {
    return (
      <div className="bt-root">
        {token && !authError ? <div className="bt-pending">Đang tải tài khoản…</div> : <LoginPage error={authError} />}
      </div>
    )
  }

  // Phần còn thiếu so với tiền cược sẽ gửi kèm giao dịch để nạp luôn
  const topUpFor = (bet) => (walletBalance != null && walletBalance < bet ? bet - walletBalance : 0n)
  // Khoá phiên đăng ký vào contract khi tạo/vào phòng để ký nước đi không cần popup
  const sessionKey = () => getSessionWallet(wallet.address).address
  const walletMismatch = wallet && !sameAddress(user.walletAddress, wallet.address)
  // Nhận ra "bạn" trên bảng xếp hạng kể cả khi chưa mở MetaMask (dùng ví đã liên kết)
  const myAddress = wallet?.address || user.walletAddress

  return (
    <div className="bt-root">
      <AccountBar
        user={user}
        wallet={wallet}
        names={names}
        ethBalance={ethBalance}
        walletBalance={walletBalance}
        busy={busy}
        onConnect={connect}
        onLinkWallet={linkCurrentWallet}
        onLogout={logout}
        onSwitchAccount={switchGoogleAccount}
        onEditNickname={() => setModal('nickname')}
        onOpenHistory={() => setModal('history')}
        onDeposit={(v) => send('Nạp tiền thành công', (c) => c.deposit({ value: v }))}
        onWithdraw={(v) => send('Rút tiền thành công', (c) => c.withdraw(v))}
        onTransfer={(to, v, label) => send(`Đã chuyển ${formatEther(v)} ETH cho ${label}`, (c) => c.transfer(to, v))}
      />

      <div className="bt-side">
        <button className="bt-round-btn" onClick={() => setModal('leaderboard')} title="Bảng xếp hạng">
          🏆
        </button>
        <button className="bt-round-btn" onClick={() => setModal('history')} title="Lịch sử giao dịch">
          📜
        </button>
        <button className="bt-round-btn" onClick={() => setModal('rules')} title="Luật chơi">
          📖
        </button>
        <button
          className="bt-round-btn"
          onClick={theme.toggle}
          title={theme.mode === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}
        >
          {theme.mode === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      {walletMismatch && (
        <div className="bt-banner">
          <span>
            {user.walletAddress
              ? `Ví đang chọn (${shortAddress(wallet.address)}) khác ví đã liên kết (${shortAddress(user.walletAddress)}). Đổi tài khoản trong MetaMask, hoặc liên kết ví này thay thế.`
              : 'Ví MetaMask này chưa liên kết với tài khoản. Liên kết để tên của bạn hiện trên sảnh và bảng xếp hạng.'}
          </span>
          <button className="bt-btn is-gold" onClick={linkCurrentWallet} disabled={busy}>
            🔗 Liên kết ví này
          </button>
        </div>
      )}

      {activeId ? (
        <GameBoard
          game={activeGame?.id === activeId ? activeGame : null}
          view={view}
          lastMove={lastMove}
          me={wallet?.address}
          nameOf={nameOf}
          busy={busy}
          onMove={playMove}
          onSettle={() => submitMoves('Đã gửi kết quả ván lên blockchain', view.pending)}
          onDispute={() => submitMoves('Đã đưa ván lên blockchain, đối thủ có 5 phút để đi', view.pending)}
          onCatchUp={() => submitMoves('Đã gửi các nước đã đi lên blockchain', view.pending)}
          onResign={() => {
            if (window.confirm('Đầu hàng sẽ mất tiền cược. Bạn chắc chứ?')) {
              send('Bạn đã đầu hàng', (c) => c.resign(activeId))
            }
          }}
          onClaimTimeout={() => send('Đã nhận thắng do đối thủ hết giờ', (c) => c.claimTimeout(activeId))}
          onBack={() => setActiveId(null)}
        />
      ) : (
        <Lobby
          games={games}
          me={wallet?.address}
          nameOf={nameOf}
          busy={busy}
          onCreate={(bet) => send('Tạo phòng thành công, đang chờ đối thủ…', (c) => c.createRoom(bet, sessionKey(), { value: topUpFor(bet) }))}
          onJoin={async (g) => {
            if (await send(`Đã vào phòng #${g.id}`, (c) => c.joinRoom(g.id, sessionKey(), { value: topUpFor(g.betAmount) }))) {
              openGame(g.id)
            }
          }}
          onCancel={(id) => send(`Đã huỷ phòng #${id}, tiền cược được hoàn vào ví game`, (c) => c.cancelRoom(id))}
          onOpen={openGame}
          onShowLeaderboard={() => setModal('leaderboard')}
          rankingAddress={myAddress}
        />
      )}

      {notice && (
        <div className="bt-alert-layer">
          <button className={`bt-alert is-${notice.type}`} onClick={() => setNotice(null)}>
            {notice.type === 'error' ? '⚠️ ' : '✅ '}
            {notice.text}
          </button>
        </div>
      )}
      {busy && <div className="bt-pending">Đang chờ xác nhận…</div>}

      {modal === 'leaderboard' && <Leaderboard me={myAddress} onClose={() => setModal(null)} />}
      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} />}
      {modal === 'install' && <InstallMetaMask onClose={() => setModal(null)} />}
      {modal === 'history' && <TxHistory me={wallet?.address} nameOf={nameOf} onClose={() => setModal(null)} />}
      {modal === 'nickname' && (
        <NicknameDialog current={user.nickname} onSave={saveNickname} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

export default App
