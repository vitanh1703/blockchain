// Chuyển tiếp nước đi off-chain (state channel) giữa hai người chơi.
// Mỗi nước được ký bằng khoá phiên (hoặc ví chính) của người đi; backend kiểm tra chữ ký giống hệt contract
// rồi lưu lại để đối thủ đọc. Khi kết thúc, client gửi cả chuỗi nước đi lên contract trong 1 giao dịch.
// Backend không giữ tiền và không quyết định thắng thua: contract kiểm tra lại mọi chữ ký.
const express = require('express');
const { AbiCoder, ZeroAddress, ZeroHash, getBytes, keccak256, verifyMessage } = require('ethers');
const { query } = require('./db');
const { getDeployment } = require('./indexer');

const SIZE = 15;
const CELLS = SIZE * SIZE;
const STATUS_PLAYING = 1;
const coder = AbiCoder.defaultAbiCoder();

/** Giống CaroBetting.moveDigest: digest nối chuỗi, chữ ký gắn với toàn bộ lịch sử trước nó. */
function moveDigest({ address, chainId }, gameId, index, x, y, prevHash) {
  return keccak256(
    coder.encode(
      ['address', 'uint256', 'uint256', 'uint256', 'uint8', 'uint8', 'bytes32'],
      [address, chainId, gameId, index, x, y, prevHash],
    ),
  );
}

function isFiveInRow(cells, x, y, mark) {
  const count = (dx, dy) => {
    let n = 0;
    for (let cx = x + dx, cy = y + dy; n < 4 && cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE; cx += dx, cy += dy) {
      if (cells[cy * SIZE + cx] !== mark) break;
      n++;
    }
    return n;
  };
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => 1 + count(dx, dy) + count(-dx, -dy) >= 5);
}

/** Đặt lại bàn cờ từ danh sách nước đi đã lưu. */
function replay(dep, gameId, moves) {
  const cells = new Array(CELLS).fill(0);
  let hash = ZeroHash;
  let turn = 1;
  let winnerMark = 0;
  moves.forEach((m, i) => {
    cells[m.y * SIZE + m.x] = turn;
    hash = moveDigest(dep, gameId, i, m.x, m.y, hash);
    if (isFiveInRow(cells, m.x, m.y, turn)) winnerMark = turn;
    turn = turn === 1 ? 2 : 1;
  });
  return { cells, hash, turn, winnerMark };
}

const isUint = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

async function loadMoves(gameId) {
  return query('SELECT x, y, signature, created_at FROM offchain_moves WHERE game_id = ? ORDER BY move_index', [
    gameId,
  ]);
}

const router = express.Router();

router.get('/games/:id/moves', async (req, res) => {
  const gameId = Number(req.params.id);
  if (!isUint(gameId, 2 ** 32)) return res.status(400).json({ message: 'Mã phòng không hợp lệ' });
  const rows = await loadMoves(gameId);
  const last = rows[rows.length - 1];
  res.json({
    moves: rows.map((r) => ({ x: r.x, y: r.y, sig: r.signature })),
    // Số giây kể từ nước gần nhất, theo giờ máy chủ (client tự quy đổi để tránh lệch đồng hồ)
    lastMoveAgo: last ? (Date.now() - Number(last.created_at)) / 1000 : null,
  });
});

router.post('/games/:id/moves', async (req, res) => {
  const gameId = Number(req.params.id);
  const { index, x, y, sig } = req.body || {};
  if (!isUint(gameId, 2 ** 32) || !isUint(index, CELLS - 1) || !isUint(x, SIZE - 1) || !isUint(y, SIZE - 1)) {
    return res.status(400).json({ message: 'Nước đi không hợp lệ' });
  }
  if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    return res.status(400).json({ message: 'Chữ ký không hợp lệ' });
  }

  const dep = getDeployment();
  if (!dep) return res.status(503).json({ message: 'Chưa deploy smart contract' });
  const g = await dep.contract.getGame(gameId);
  if (Number(g.status) !== STATUS_PLAYING) return res.status(409).json({ message: 'Trận đấu không diễn ra' });
  if (g.disputed) {
    return res.status(409).json({ message: 'Ván đã được đưa lên blockchain, hãy đi nước trên chain' });
  }

  const rows = await loadMoves(gameId);
  if (index !== rows.length) {
    return res.status(409).json({ message: 'Bàn cờ đã thay đổi, hãy thử lại' });
  }
  const state = replay(dep, gameId, rows);
  if (state.winnerMark) return res.status(409).json({ message: 'Ván đã có người thắng' });
  if (state.cells[y * SIZE + x] !== 0) return res.status(400).json({ message: 'Ô này đã có quân' });

  let signer;
  try {
    signer = verifyMessage(getBytes(moveDigest(dep, gameId, index, x, y, state.hash)), sig);
  } catch {
    return res.status(400).json({ message: 'Chữ ký không hợp lệ' });
  }
  const player = state.turn === 1 ? g.playerX : g.playerO;
  const session = state.turn === 1 ? g.sessionX : g.sessionO;
  if (!same(signer, player) && !(session !== ZeroAddress && same(signer, session))) {
    return res.status(403).json({ message: 'Chưa đến lượt bạn hoặc chữ ký không đúng người chơi' });
  }

  try {
    await query(
      'INSERT INTO offchain_moves (game_id, move_index, x, y, signature, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [gameId, index, x, y, sig, Date.now()],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Bàn cờ đã thay đổi, hãy thử lại' });
    throw err;
  }
  res.status(201).json({ index });
});

module.exports = { router };
