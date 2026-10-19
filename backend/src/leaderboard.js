const express = require('express');
const { getAddress } = require('ethers');
const { query } = require('./db');
const { indexerStatus } = require('./indexer');

/** Tổng hợp thống kê theo từng ví. Tiền tính bằng BigInt (wei) nên làm trong JS thay vì SQL. */
async function computeStats() {
  const stats = new Map();
  const get = (addr) => {
    if (!stats.has(addr)) stats.set(addr, { address: addr, games: 0, wins: 0, losses: 0, draws: 0, profit: 0n });
    return stats.get(addr);
  };

  for (const m of await query('SELECT * FROM matches')) {
    const bet = BigInt(m.bet_wei);
    for (const addr of [m.player_x, m.player_o]) {
      const s = get(addr);
      s.games++;
      if (m.winner == null) s.draws++;
      else if (m.winner === addr) {
        s.wins++;
        s.profit += BigInt(m.reward_wei) - bet;
      } else {
        s.losses++;
        s.profit -= bet;
      }
    }
  }
  return stats;
}

const router = express.Router();

router.get('/leaderboard', async (req, res) => {
  const users = await query(
    'SELECT wallet_address, COALESCE(nickname, name) AS display_name, avatar_url FROM users WHERE wallet_address IS NOT NULL',
  );
  const byWallet = Object.fromEntries(users.map((u) => [u.wallet_address, u]));
  const rows = [...(await computeStats()).values()]
    .sort((a, b) => b.wins - a.wins || (b.profit > a.profit ? 1 : b.profit < a.profit ? -1 : 0) || a.games - b.games)
    .slice(0, 100)
    .map((s, i) => ({
      rank: i + 1,
      address: getAddress(s.address),
      nickname: byWallet[s.address]?.display_name || null,
      avatarUrl: byWallet[s.address]?.avatar_url || null,
      games: s.games,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      winRate: s.games ? s.wins / s.games : 0,
      profitWei: s.profit.toString(),
    }));
  res.json({ rows, indexer: await indexerStatus() });
});

module.exports = { router };
