import { useCallback, useEffect, useState } from 'react'
import WalletBar from './components/WalletBar'
import Lobby from './components/Lobby'
import GameBoard from './components/GameBoard'
import { connectWallet, errorMessage, readContract, readProvider, toGame } from './lib/caro'
import './App.css'

const POLL_MS = 2000
const LOBBY_LIMIT = 50

function App() {
  const [wallet, setWallet] = useState(null) // { address, contract }
  const [ethBalance, setEthBalance] = useState(null)
  const [walletBalance, setWalletBalance] = useState(null)
  const [games, setGames] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [board, setBoard] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

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
        const cells = await readContract.getBoard(activeId)
        setBoard(cells.map(Number))
      }
    } catch (err) {
      setNotice({ type: 'error', text: `Không đọc được dữ liệu từ blockchain: ${errorMessage(err)}` })
    }
  }, [wallet, activeId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const connect = useCallback(async () => {
    try {
      setWallet(await connectWallet())
      setNotice(null)
    } catch (err) {
      setNotice({ type: 'error', text: errorMessage(err) })
    }
  }, [])

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

  async function send(successText, makeTx) {
    setBusy(true)
    setNotice(null)
    try {
      const tx = await makeTx(wallet.contract)
      await tx.wait()
      setNotice({ type: 'ok', text: successText })
      await refresh()
      return true
    } catch (err) {
      setNotice({ type: 'error', text: errorMessage(err) })
      return false
    } finally {
      setBusy(false)
    }
  }

  // Phần còn thiếu so với tiền cược sẽ gửi kèm giao dịch để nạp luôn
  const topUpFor = (bet) => (walletBalance != null && walletBalance < bet ? bet - walletBalance : 0n)

  const activeGame = games.find((g) => g.id === activeId)

  return (
    <>
      <WalletBar
        wallet={wallet}
        ethBalance={ethBalance}
        walletBalance={walletBalance}
        busy={busy}
        onConnect={connect}
        onDeposit={(v) => send('Nạp tiền thành công', (c) => c.deposit({ value: v }))}
        onWithdraw={(v) => send('Rút tiền thành công', (c) => c.withdraw(v))}
      />

      <main>
        {notice && (
          <div className={`notice ${notice.type}`} onClick={() => setNotice(null)}>
            {notice.text}
          </div>
        )}
        {busy && <div className="notice info">Đang chờ xác nhận giao dịch…</div>}

        {activeId ? (
          <GameBoard
            game={activeGame}
            board={board}
            me={wallet?.address}
            busy={busy}
            onMove={(x, y) => send(`Đã đánh (${x}, ${y})`, (c) => c.makeMove(activeId, x, y))}
            onResign={() => send('Bạn đã đầu hàng', (c) => c.resign(activeId))}
            onClaimTimeout={() => send('Đã nhận thắng do đối thủ hết giờ', (c) => c.claimTimeout(activeId))}
            onBack={() => {
              setActiveId(null)
              setBoard(null)
            }}
          />
        ) : (
          <Lobby
            games={games}
            me={wallet?.address}
            busy={busy}
            onCreate={(bet) => send('Tạo phòng thành công', (c) => c.createRoom(bet, { value: topUpFor(bet) }))}
            onJoin={async (g) => {
              if (await send(`Đã vào phòng #${g.id}`, (c) => c.joinRoom(g.id, { value: topUpFor(g.betAmount) }))) {
                setActiveId(g.id)
              }
            }}
            onCancel={(id) => send(`Đã huỷ phòng #${id}, tiền cược được hoàn vào ví game`, (c) => c.cancelRoom(id))}
            onOpen={setActiveId}
          />
        )}
      </main>
    </>
  )
}

export default App
