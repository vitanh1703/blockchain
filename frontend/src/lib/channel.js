// Đánh cờ off-chain (state channel): mỗi nước được ký số rồi gửi qua backend cho đối thủ,
// cuối ván mới gửi cả chuỗi nước đi lên contract trong 1 giao dịch.
//
// Nước đi được ký bằng "khoá phiên": một ví tạm sinh ngẫu nhiên trong trình duyệt, đăng ký vào contract
// ngay trong giao dịch tạo/vào phòng. Nhờ vậy đánh cờ không hiện popup MetaMask nào. Khoá phiên chỉ
// ký được nước đi của chính ván đó, không chuyển được tiền. Nếu mất khoá (đổi máy, xoá dữ liệu trình duyệt)
// thì ký bằng MetaMask thay thế.
import { AbiCoder, Wallet, ZeroAddress, ZeroHash, getBytes, keccak256 } from 'ethers'
import deployment from '../contracts/CaroBetting.json'
import { SIZE, sameAddress } from './caro'
import { api } from './api'

const coder = AbiCoder.defaultAbiCoder()

/** Giống CaroBetting.moveDigest: digest nối chuỗi, chữ ký gắn với toàn bộ lịch sử trước nó. */
export function moveDigest(gameId, index, x, y, prevHash) {
  return keccak256(
    coder.encode(
      ['address', 'uint256', 'uint256', 'uint256', 'uint8', 'uint8', 'bytes32'],
      [deployment.address, deployment.chainId, gameId, index, x, y, prevHash],
    ),
  )
}

export function isFiveInRow(cells, x, y, mark) {
  const count = (dx, dy) => {
    let n = 0
    for (let cx = x + dx, cy = y + dy; n < 4 && cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE; cx += dx, cy += dy) {
      if (cells[cy * SIZE + cx] !== mark) break
      n++
    }
    return n
  }
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => 1 + count(dx, dy) + count(-dx, -dy) >= 5)
}

/**
 * Đặt lại bàn cờ từ danh sách nước đi. hashes[i] là digest sau i nước (hashes[0] = 0x0),
 * dùng để đối chiếu với stateHash trên chain.
 */
export function replay(gameId, moves) {
  const cells = new Array(SIZE * SIZE).fill(0)
  const hashes = [ZeroHash]
  let turn = 1
  let winnerMark = 0
  let lastIdx = null
  moves.forEach((m, i) => {
    lastIdx = m.y * SIZE + m.x
    cells[lastIdx] = turn
    hashes.push(moveDigest(gameId, i, m.x, m.y, hashes[i]))
    if (isFiveInRow(cells, m.x, m.y, turn)) winnerMark = turn
    turn = turn === 1 ? 2 : 1
  })
  return { cells, hash: hashes[moves.length], hashes, turn, winnerMark, lastIdx }
}

// ---------------- Khoá phiên ----------------

const memoryKeys = new Map() // dùng khi trình duyệt chặn localStorage
const storageKey = (owner) =>
  `caro.session.${deployment.chainId}.${deployment.address.toLowerCase()}.${owner.toLowerCase()}`

/** Khoá phiên của ví `owner` trên trình duyệt này; tạo mới nếu chưa có và `create` = true. */
export function getSessionWallet(owner, create = true) {
  const key = storageKey(owner)
  let pk = memoryKeys.get(key)
  try {
    pk = pk || localStorage.getItem(key)
  } catch {
    // localStorage bị chặn: chỉ giữ trong bộ nhớ tới khi tải lại trang
  }
  if (!pk && create) {
    pk = Wallet.createRandom().privateKey
    try {
      localStorage.setItem(key, pk)
    } catch {
      // như trên
    }
  }
  if (!pk) return null
  memoryKeys.set(key, pk)
  return new Wallet(pk)
}

/** Ký nước đi: dùng khoá phiên nếu khớp khoá đã đăng ký trong contract, không thì ký bằng MetaMask. */
export async function signMove({ game, mark, index, x, y, prevHash, signer }) {
  const digest = getBytes(moveDigest(game.id, index, x, y, prevHash))
  const owner = mark === 1 ? game.playerX : game.playerO
  const registered = mark === 1 ? game.sessionX : game.sessionO
  const session = registered !== ZeroAddress ? getSessionWallet(owner, false) : null
  if (session && sameAddress(session.address, registered)) return session.signMessage(digest)
  return signer.signMessage(digest) // hiện popup MetaMask
}

// ---------------- Relay (backend) ----------------

export async function fetchMoves(gameId) {
  const { moves, lastMoveAgo } = await api(`/games/${gameId}/moves`)
  return {
    moves,
    // quy đổi sang giờ máy mình (giây) để đếm ngược
    lastAt: lastMoveAgo == null ? null : Math.floor(Date.now() / 1000 - lastMoveAgo),
  }
}

export function postMove(gameId, move) {
  return api(`/games/${gameId}/moves`, { method: 'POST', body: move })
}
