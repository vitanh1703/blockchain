import { AbiCoder, BrowserProvider, Contract, JsonRpcProvider, formatEther } from 'ethers'
// File này được sinh ra bởi `npm run deploy` trong smart-contract/
import deployment from '../contracts/CaroBetting.json'

export const SIZE = 15
export const STATUS = { Waiting: 0, Playing: 1, Finished: 2, Cancelled: 3 }
export const STATUS_LABEL = ['Chờ đối thủ', 'Đang đánh', 'Đã kết thúc', 'Đã huỷ']
export const MOVE_TIMEOUT = 5 * 60 // giây, khớp với contract
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Mạng được chọn lúc deploy (Hardhat hoặc Ganache); VITE_RPC_URL dùng để ghi đè nếu cần
const RPC_URL = import.meta.env.VITE_RPC_URL || deployment.rpcUrl || 'http://127.0.0.1:8545'
export const NETWORK_LABEL = deployment.networkLabel || 'Hardhat Local'

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
          chainName: NETWORK_LABEL,
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
    signer,
    address: await signer.getAddress(),
    contract: new Contract(deployment.address, deployment.abi, signer),
  }
}

/**
 * Tìm lý do revert của contract trong lỗi. Tuỳ node (Hardhat/Ganache) và ví (MetaMask bọc thêm lớp
 * "Internal JSON-RPC error"), lý do nằm ở các chỗ khác nhau nên duyệt qua các lớp lồng nhau.
 */
function findRevertReason(err, depth = 0) {
  if (!err || typeof err !== 'object' || depth > 5) return null
  if (typeof err.reason === 'string' && err.reason && err.reason !== 'revert') return err.reason
  for (const value of [err.data, err.result]) {
    if (typeof value === 'string' && value.startsWith('0x08c379a0')) {
      try {
        return AbiCoder.defaultAbiCoder().decode(['string'], `0x${value.slice(10)}`)[0]
      } catch {
        // dữ liệu không đúng định dạng Error(string)
      }
    }
  }
  for (const child of [err.info?.error, err.error, err.data, err.cause]) {
    const found = findRevertReason(child, depth + 1)
    if (found) return found
  }
  // Chỉ nhận đúng mẫu thông báo revert của node (tránh khớp nhầm "missing revert data" của ethers)
  const m = /(?:VM Exception while processing transaction: revert|execution reverted:|reverted with reason string) '?(.+?)'?$/.exec(
    typeof err.message === 'string' ? err.message : '',
  )
  return m ? m[1] : null
}

export function errorMessage(err) {
  if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) return 'Bạn đã huỷ giao dịch'
  return findRevertReason(err) || err?.shortMessage || err?.message || String(err)
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

/** Loại giao dịch trong lịch sử ví, khớp enum TxType của contract. sign: +1 tiền vào, -1 tiền ra. */
export const TX_TYPES = [
  { icon: '📥', label: 'Nạp tiền', sign: 1 },
  { icon: '📤', label: 'Rút tiền', sign: -1 },
  { icon: '➡️', label: 'Chuyển đi', sign: -1 },
  { icon: '⬅️', label: 'Nhận tiền', sign: 1 },
  { icon: '🎲', label: 'Đặt cược', sign: -1 },
  { icon: '🏆', label: 'Thắng cược', sign: 1 },
  { icon: '↩️', label: 'Hoàn cược', sign: 1 },
  { icon: '🏦', label: 'Phí sàn', sign: 1 },
]

/** Lời/lỗ (wei, chuỗi) -> "+0.096" / "−0.100" (3 chữ số thập phân). */
export function formatProfit(wei) {
  const v = BigInt(wei)
  const eth = Number(formatEther(v < 0n ? -v : v)).toFixed(3)
  return v > 0n ? `+${eth}` : v < 0n ? `−${eth}` : eth
}
