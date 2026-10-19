import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers'
// File này được sinh ra bởi `npm run deploy` trong smart-contract/
import deployment from '../contracts/CaroBetting.json'

export const SIZE = 15
export const STATUS = { Waiting: 0, Playing: 1, Finished: 2, Cancelled: 3 }
export const STATUS_LABEL = ['Chờ đối thủ', 'Đang đánh', 'Đã kết thúc', 'Đã huỷ']
export const MOVE_TIMEOUT = 5 * 60 // giây, khớp với contract
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545'

// Đọc dữ liệu trực tiếp từ node (nhanh, không phụ thuộc MetaMask)
export const readProvider = new JsonRpcProvider(RPC_URL, deployment.chainId, { staticNetwork: true })
export const readContract = new Contract(deployment.address, deployment.abi, readProvider)

export function sameAddress(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

export function shortAddress(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}

export function toGame(id, raw) {
  return {
    id: Number(id),
    playerX: raw.playerX,
    playerO: raw.playerO,
    betAmount: raw.betAmount,
    winner: raw.winner,
    status: Number(raw.status),
    turn: Number(raw.turn),
    moveCount: Number(raw.moveCount),
    lastMoveAt: Number(raw.lastMoveAt),
  }
}

async function ensureChain() {
  const chainId = '0x' + deployment.chainId.toString(16)
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (err) {
    if (err.code !== 4902) throw err
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: 'Hardhat Local',
          rpcUrls: [RPC_URL],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        },
      ],
    })
  }
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error('Chưa cài MetaMask')
  await window.ethereum.request({ method: 'eth_requestAccounts' })
  await ensureChain()
  const signer = await new BrowserProvider(window.ethereum).getSigner()
  return {
    address: await signer.getAddress(),
    contract: new Contract(deployment.address, deployment.abi, signer),
  }
}

export function errorMessage(err) {
  if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) return 'Bạn đã huỷ giao dịch'
  return (
    err?.reason ||
    err?.info?.error?.data?.message ||
    err?.info?.error?.message ||
    err?.shortMessage ||
    err?.message ||
    String(err)
  )
}

/** Trả về tập chỉ số các ô thuộc hàng 5 thắng (để tô sáng). */
export function findWinningLine(board, mark) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y * SIZE + x] !== mark) continue
      for (const [dx, dy] of dirs) {
        const cells = []
        let cx = x
        let cy = y
        while (cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE && board[cy * SIZE + cx] === mark) {
          cells.push(cy * SIZE + cx)
          cx += dx
          cy += dy
        }
        if (cells.length >= 5) return new Set(cells)
      }
    }
  }
  return new Set()
}
