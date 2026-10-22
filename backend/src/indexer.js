// Đồng bộ kết quả trận từ blockchain vào DB.
// Bảng xếp hạng chỉ dựa trên sự kiện GameEnded do contract phát ra, nên client không thể gửi kết quả giả.
const fs = require('fs');
const path = require('path');
const { Contract, JsonRpcProvider } = require('ethers');
const { query, getMeta, setMeta } = require('./db');

const DEFAULT_RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const DEPLOYMENT_FILE = path.join(__dirname, 'contracts', 'CaroBetting.json');
const POLL_MS = 3000;
const MAX_RANGE = 2000; // số block tối đa mỗi lần query log

let provider = null;
let contract = null;
let chainId = null;
let deploymentMtime = 0;
let lastError = null;

function loadDeployment() {
  let stat;
  try {
    stat = fs.statSync(DEPLOYMENT_FILE);
  } catch {
    return null;
  }
  // `npm run deploy` ghi đè file này, nên đọc lại khi file thay đổi
  if (!contract || stat.mtimeMs !== deploymentMtime) {
    // Dùng RPC của mạng đã deploy (Hardhat 8545 hoặc Ganache 7545)
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
    const { address, abi, rpcUrl } = deployment;
    provider?.destroy();
    provider = new JsonRpcProvider(rpcUrl || DEFAULT_RPC_URL, undefined, { staticNetwork: true, polling: false });
    contract = new Contract(address, abi, provider);
    chainId = deployment.chainId;
    console.log(`[indexer] Theo dõi contract ${address} tại ${rpcUrl || DEFAULT_RPC_URL}`);
    deploymentMtime = stat.mtimeMs;
  }
  return contract;
}

async function resetMatches(reason) {
  console.log(`[indexer] Xoá dữ liệu trận cũ: ${reason}`);
  await query('DELETE FROM matches');
  await query('DELETE FROM offchain_moves');
  await setMeta('lastBlock', null);
  await setMeta('lastBlockHash', null);
}

const INSERT_MATCH = `
  REPLACE INTO matches
    (game_id, player_x, player_o, bet_wei, winner, reward_wei, reason, block_number, tx_hash, ended_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

async function syncOnce() {
  const caro = loadDeployment();
  if (!caro) return;
  const address = (await caro.getAddress()).toLowerCase();

  if ((await getMeta('contract')) !== address) {
    await resetMatches(`contract mới ${address}`);
    await setMeta('contract', address);
  }

  // Hardhat node khởi động lại => chain mới: block cũ không còn hoặc hash khác
  const lastBlock = await getMeta('lastBlock');
  let from = lastBlock == null ? 0 : Number(lastBlock) + 1;
  if (lastBlock != null) {
    const block = await provider.getBlock(Number(lastBlock));
    if (!block || block.hash !== (await getMeta('lastBlockHash'))) {
      await resetMatches('blockchain đã bị reset');
      from = 0;
    }
  }

  const latest = await provider.getBlockNumber();

  while (from <= latest) {
    const to = Math.min(latest, from + MAX_RANGE - 1);
    const events = await caro.queryFilter(caro.filters.GameEnded(), from, to);
    for (const ev of events) {
      const [gameId, winner, reward, reason] = ev.args;
      const g = await caro.getGame(gameId);
      const block = await ev.getBlock();
      await query(INSERT_MATCH, [
        Number(gameId),
        g.playerX.toLowerCase(),
        g.playerO.toLowerCase(),
        g.betAmount.toString(),
        winner === '0x0000000000000000000000000000000000000000' ? null : winner.toLowerCase(),
        reward.toString(),
        reason,
        ev.blockNumber,
        ev.transactionHash,
        block.timestamp,
      ]);
    }
    const toBlock = await provider.getBlock(to);
    await setMeta('lastBlock', to);
    await setMeta('lastBlockHash', toBlock.hash);
    from = to + 1;
  }
}

function startIndexer() {
  const tick = async () => {
    try {
      await syncOnce();
      if (lastError) console.log('[indexer] Đã kết nối lại blockchain');
      lastError = null;
    } catch (err) {
      const msg = err.shortMessage || err.message;
      if (msg !== lastError) console.warn(`[indexer] Lỗi đồng bộ: ${msg}`);
      lastError = msg;
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  tick();
}

async function indexerStatus() {
  const lastBlock = await getMeta('lastBlock');
  return {
    contract: await getMeta('contract'),
    lastBlock: lastBlock == null ? null : Number(lastBlock),
    error: lastError,
  };
}

/** Contract đang theo dõi (để API kiểm tra trạng thái ván), null nếu chưa deploy. */
function getDeployment() {
  const caro = loadDeployment();
  return caro ? { contract: caro, address: caro.target, chainId } : null;
}

module.exports = { startIndexer, indexerStatus, getDeployment };
