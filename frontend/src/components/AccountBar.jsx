import { useState } from 'react'
import { formatEther, isAddress, parseEther } from 'ethers'
import { sameAddress, shortAddress } from '../lib/caro'

const QUICK_AMOUNTS = ['0.05', '0.1', '0.5', '1']

function fmt(wei, digits = 4) {
  return wei != null ? Number(formatEther(wei)).toFixed(digits).replace(/\.?0+$/, '') || '0' : '…'
}

/** Người nhận có thể nhập địa chỉ ví hoặc nickname. */
function resolveRecipient(input, names) {
  const v = input.trim()
  if (!v) return null
  if (isAddress(v)) return { address: v, label: names[v.toLowerCase()] || shortAddress(v) }
  const hit = Object.entries(names).find(([, nick]) => nick.toLowerCase() === v.toLowerCase())
  return hit ? { address: hit[0], label: hit[1] } : { error: 'Không tìm thấy nickname hoặc địa chỉ không hợp lệ' }
}

export default function AccountBar({
  user,
  wallet,
  names,
  ethBalance,
  walletBalance,
  busy,
  onConnect,
  onLinkWallet,
  onLogout,
  onSwitchAccount,
  onEditNickname,
  onOpenHistory,
  onDeposit,
  onWithdraw,
  onTransfer,
}) {
  const [open, setOpen] = useState(null) // 'wallet' | 'account' | null
  const [tab, setTab] = useState('cash') // 'cash' | 'transfer'
  const [amount, setAmount] = useState('0.1')
  const [recipient, setRecipient] = useState('')

  const toggle = (which) => setOpen((o) => (o === which ? null : which))
  const close = () => setOpen(null)
  const run = (fn) => () => {
    close()
    fn()
  }

  let value = null
  try {
    value = parseEther(amount || '0')
  } catch {
    // số tiền không hợp lệ
  }
  const validAmount = value != null && value > 0n
  const target = resolveRecipient(recipient, names)
  const selfTransfer = wallet && target?.address && sameAddress(target.address, wallet.address)
  const canLinkCurrent = wallet && !sameAddress(user.walletAddress, wallet.address)

  return (
    <>
      {open && <div className="bt-click-away" onClick={close} />}
      <div className="bt-topright">
        {wallet ? (
          <button className="bt-coin" onClick={() => toggle('wallet')} title={`Ví game của ${wallet.address}`}>
            🪙 <b>{fmt(walletBalance)}</b> ETH
          </button>
        ) : (
          <button className="bt-coin" onClick={onConnect} disabled={busy} title="Kết nối MetaMask để nạp tiền và đặt cược">
            🦊 Kết nối ví
          </button>
        )}
        <button className="bt-account" onClick={() => toggle('account')} title={user.email}>
          <span className="bt-account-avatar">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              user.displayName[0].toUpperCase()
            )}
          </span>
          <span className="bt-account-name">{user.displayName}</span>
          <span className="bt-account-caret">▾</span>
        </button>

        {open === 'wallet' && wallet && (
          <div className="bt-popover bt-wallet-pop">
            <div className="bt-panel-head">Ví game</div>
            <div className="bt-panel-body">
              <div className="bt-balance-row">
                Số dư ví game <b>{fmt(walletBalance, 6)} ETH</b>
              </div>
              <div className="bt-balance-row">
                MetaMask <b>{fmt(ethBalance)} ETH</b>
              </div>

              <div className="bt-tabs">
                <button className={tab === 'cash' ? 'is-active' : ''} onClick={() => setTab('cash')}>
                  Nạp / Rút
                </button>
                <button className={tab === 'transfer' ? 'is-active' : ''} onClick={() => setTab('transfer')}>
                  Chuyển
                </button>
              </div>

              {tab === 'transfer' && (
                <>
                  <input
                    className="bt-input bt-input-sm"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Nickname hoặc địa chỉ ví 0x…"
                    aria-label="Người nhận"
                  />
                  {target?.error && <p className="bt-field-error">{target.error}</p>}
                  {selfTransfer && <p className="bt-field-error">Không thể chuyển cho chính mình</p>}
                  {target?.address && !selfTransfer && (
                    <p className="bt-muted" title={target.address}>
                      Người nhận: <b>{target.label}</b>
                      {target.label !== shortAddress(target.address) && ` (${shortAddress(target.address)})`}
                    </p>
                  )}
                </>
              )}

              <input
                className="bt-input"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Số ETH"
              />
              <div className="bt-chips">
                {QUICK_AMOUNTS.map((a) => (
                  <button key={a} className={`bt-chip ${amount === a ? 'is-on' : ''}`} onClick={() => setAmount(a)}>
                    {a}
                  </button>
                ))}
              </div>

              {tab === 'cash' ? (
                <>
                  <div className="bt-actions">
                    <button className="bt-btn is-primary" onClick={() => onDeposit(value)} disabled={busy || !validAmount}>
                      Nạp
                    </button>
                    <button className="bt-btn is-gold" onClick={() => onWithdraw(value)} disabled={busy || !validAmount}>
                      Rút
                    </button>
                  </div>
                  <p className="bt-muted">Nạp: chuyển ETH từ MetaMask vào ví game. Rút: chuyển về MetaMask.</p>
                </>
              ) : (
                <>
                  <button
                    className="bt-btn is-primary"
                    onClick={() => onTransfer(target.address, value, target.label)}
                    disabled={busy || !validAmount || !target?.address || selfTransfer}
                  >
                    Chuyển {validAmount ? `${amount} ETH` : ''}
                  </button>
                  <p className="bt-muted">Chuyển từ ví game của bạn sang ví game người nhận, không mất phí sàn.</p>
                </>
              )}

              <button className="bt-link-btn" onClick={run(onOpenHistory)}>
                📜 Xem lịch sử giao dịch
              </button>
            </div>
          </div>
        )}

        {open === 'account' && (
          <div className="bt-popover bt-menu">
            <div className="bt-menu-info">
              <b>{user.displayName}</b>
              <span className="bt-muted">{user.email}</span>
              <span className="bt-menu-wallet">
                {user.walletAddress ? (
                  <>
                    🔗 Ví liên kết: <code title={user.walletAddress}>{shortAddress(user.walletAddress)}</code>
                  </>
                ) : (
                  'Chưa liên kết ví MetaMask'
                )}
              </span>
            </div>
            {canLinkCurrent && (
              <button onClick={run(onLinkWallet)} disabled={busy}>
                🔗 Liên kết ví đang chọn ({shortAddress(wallet.address)})
              </button>
            )}
            {!wallet && <button onClick={run(onConnect)}>🦊 Kết nối ví MetaMask</button>}
            <button onClick={run(onOpenHistory)}>📜 Lịch sử giao dịch</button>
            <button onClick={run(onEditNickname)}>✏️ {user.nickname ? 'Đổi nickname' : 'Đặt nickname'}</button>
            <button onClick={run(onSwitchAccount)}>🔄 Đổi tài khoản Google</button>
            <button className="is-danger" onClick={run(onLogout)}>
              🚪 Đăng xuất
            </button>
          </div>
        )}
      </div>
    </>
  )
}
