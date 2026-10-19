import { useState } from 'react'
import { formatEther, parseEther } from 'ethers'
import { shortAddress } from '../lib/caro'

export default function WalletBar({ wallet, ethBalance, walletBalance, busy, onConnect, onDeposit, onWithdraw }) {
  const [amount, setAmount] = useState('0.1')

  function submit(action) {
    let value
    try {
      value = parseEther(amount)
    } catch {
      return
    }
    action(value)
  }

  return (
    <header className="wallet-bar">
      <div className="brand">Cờ Caro ⛓ Đặt cược</div>
      {!wallet ? (
        <button className="primary" onClick={onConnect} disabled={busy}>
          Kết nối MetaMask
        </button>
      ) : (
        <div className="wallet-info">
          <span className="chip" title={wallet.address}>
            {shortAddress(wallet.address)}
          </span>
          <span className="stat">
            MetaMask <b>{ethBalance != null ? Number(formatEther(ethBalance)).toFixed(4) : '…'} ETH</b>
          </span>
          <span className="stat">
            Ví game <b>{walletBalance != null ? formatEther(walletBalance) : '…'} ETH</b>
          </span>
          <input
            className="amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Số ETH nạp/rút"
          />
          <button onClick={() => submit(onDeposit)} disabled={busy}>
            Nạp
          </button>
          <button onClick={() => submit(onWithdraw)} disabled={busy}>
            Rút
          </button>
        </div>
      )}
    </header>
  )
}
