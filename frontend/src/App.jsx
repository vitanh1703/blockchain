import { useCallback, useEffect, useRef, useState } from 'react'
import { formatEther } from 'ethers'
import AccountBar from './components/AccountBar'
import Lobby from './components/Lobby'
import GameBoard from './components/GameBoard'
import Leaderboard from './components/Leaderboard'
import LoginPage from './components/LoginPage'
import NicknameDialog from './components/NicknameDialog'
import RulesModal from './components/RulesModal'
import TxHistory from './components/TxHistory'
import { connectWallet, errorMessage, readContract, readProvider, sameAddress, shortAddress, toGame } from './lib/caro'
import { api, goToGoogleLogin, linkWallet, loadToken, saveToken, takeAuthResultFromUrl } from './lib/api'
import { useTheme } from './lib/theme'
import './App.css'

const POLL_MS = 2000
const LOBBY_LIMIT = 50
const NAMES_POLL_MS = 5000
const NOTICE_MS = 3500

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
  const [board, setBoard] = useState(null)
  const [lastMove, setLastMove] = useState(null)
  const [modal, setModal] = useState(null) // 'leaderboard' | 'rules' | 'nickname' | 'history' | null
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
        const cells = (await readContract.getBoard(activeId)).map(Number)
        // So với lần đọc trước để tô sáng nước vừa đi
        const prev = boardRef.current
        if (prev.id === activeId && prev.cells) {
          const changed = cells.findIndex((c, i) => c !== prev.cells[i])
          if (changed !== -1) setLastMove(changed)
        }
        boardRef.current = { id: activeId, cells }
        setBoard(cells)
      }
    } catch (err) {
      setNotice({ type: 'error', text: `Không đọc được dữ liệu từ blockchain: ${errorMessage(err)}` })
    }
  }, [wallet, activeId])

  useEffect(() => {
    if (!user) return
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh, user])

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
      setNotice({ type: 'error', text: errorMessage(err) })
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

  function openGame(id) {
    setBoard(null)
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
  const activeGame = games.find((g) => g.id === activeId)
  const walletMismatch = wallet && !sameAddress(user.walletAddress, wallet.address)

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
          game={activeGame}
          board={board}
          lastMove={lastMove}
          me={wallet?.address}
          nameOf={nameOf}
          busy={busy}
          onMove={(x, y) => send(null, (c) => c.makeMove(activeId, x, y))}
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
          onCreate={(bet) => send('Tạo phòng thành công, đang chờ đối thủ…', (c) => c.createRoom(bet, { value: topUpFor(bet) }))}
          onJoin={async (g) => {
            if (await send(`Đã vào phòng #${g.id}`, (c) => c.joinRoom(g.id, { value: topUpFor(g.betAmount) }))) {
              openGame(g.id)
            }
          }}
          onCancel={(id) => send(`Đã huỷ phòng #${id}, tiền cược được hoàn vào ví game`, (c) => c.cancelRoom(id))}
          onOpen={openGame}
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

      {modal === 'leaderboard' && <Leaderboard me={wallet?.address} onClose={() => setModal(null)} />}
      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} />}
      {modal === 'history' && <TxHistory me={wallet?.address} nameOf={nameOf} onClose={() => setModal(null)} />}
      {modal === 'nickname' && (
        <NicknameDialog current={user.nickname} onSave={saveNickname} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

export default App
