// Đăng nhập chỉ bằng Google (OAuth redirect):
//   /api/auth/google → Google (chọn tài khoản) → GOOGLE_CALLBACK_URL (/auth/google/callback)
//   → về CLIENT_URL/#token=<session token>.
// Ví MetaMask không dùng để đăng nhập; chỉ được *liên kết* vào tài khoản bằng một chữ ký
// để chứng minh sở hữu (không ai gắn được ví của người khác vào tài khoản mình).
const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { getAddress, isAddress, verifyMessage } = require('ethers');
const { query } = require('./db');

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const NICKNAME_RE = /^[\p{L}\p{N}_]{3,20}$/u;

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const google = googleConfigured
  ? new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/auth/google/callback',
    })
  : null;

const pendingStates = new Map(); // state chống CSRF -> hạn dùng
const pendingLinks = new Map(); // user_id -> { address, message, expiresAt }

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatar_url,
    nickname: u.nickname,
    displayName: u.nickname || u.name,
    walletAddress: u.wallet_address ? getAddress(u.wallet_address) : null,
  };
}

async function findUser(id) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

/** Middleware: gắn req.user nếu header Authorization: Bearer <token> hợp lệ. */
async function requireAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const rows = token
    ? await query(
        'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
        [token, Date.now()],
      )
    : [];
  if (!rows[0]) return res.status(401).json({ message: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  req.user = rows[0];
  req.token = token;
  next();
}

// ---------------- Google OAuth ----------------

/** Bắt đầu đăng nhập: chuyển hướng sang trang chọn tài khoản Google. */
function startGoogleLogin(req, res) {
  if (!google) {
    return res.redirect(`${CLIENT_URL}/#error=${encodeURIComponent('Backend chưa cấu hình GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET')}`);
  }
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  const url = google.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account', // luôn hiện danh sách tài khoản để đổi qua lại được
  });
  res.redirect(url);
}

/** Google gọi lại với ?code&state — đường dẫn khớp GOOGLE_CALLBACK_URL nên không có tiền tố /api. */
async function googleCallback(req, res) {
  const fail = (msg) => res.redirect(`${CLIENT_URL}/#error=${encodeURIComponent(msg)}`);
  const { code, state, error } = req.query;
  if (error) return fail('Bạn đã huỷ đăng nhập Google');

  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expiresAt || expiresAt < Date.now()) return fail('Phiên đăng nhập đã hết hạn, hãy thử lại');

  try {
    const { tokens } = await google.getToken(code);
    const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return fail('Tài khoản Google chưa xác minh email');

    await query(
      `INSERT INTO users (google_id, email, name, avatar_url, last_login_at) VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name),
         avatar_url = VALUES(avatar_url), last_login_at = NOW()`,
      [p.sub, p.email, p.name || p.email, p.picture || null],
    );
    const [user] = await query('SELECT id FROM users WHERE google_id = ?', [p.sub]);

    const token = crypto.randomBytes(32).toString('hex');
    await query('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
      token,
      user.id,
      Date.now() + SESSION_TTL_MS,
    ]);
    await query('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
    res.redirect(`${CLIENT_URL}/#token=${token}`);
  } catch (err) {
    console.error('[auth] Đăng nhập Google thất bại:', err.message);
    fail('Đăng nhập Google thất bại');
  }
}

// ---------------- API ----------------

const router = express.Router();

router.get('/auth/google', startGoogleLogin);

router.get('/auth/config', (req, res) => {
  res.json({ googleConfigured });
});

router.post('/auth/logout', requireAuth, async (req, res) => {
  await query('DELETE FROM sessions WHERE token = ?', [req.token]);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.put('/me/nickname', requireAuth, async (req, res) => {
  const nickname = String(req.body?.nickname || '').trim();
  if (!NICKNAME_RE.test(nickname)) {
    return res.status(400).json({ message: 'Nickname dài 3–20 ký tự, chỉ gồm chữ, số và dấu _' });
  }
  const taken = await query('SELECT id FROM users WHERE nickname = ? AND id <> ?', [nickname, req.user.id]);
  if (taken[0]) return res.status(409).json({ message: 'Nickname đã có người dùng' });

  try {
    await query('UPDATE users SET nickname = ? WHERE id = ?', [nickname, req.user.id]);
  } catch (err) {
    // Hai người đặt cùng nickname cùng lúc: ràng buộc UNIQUE chặn người đến sau
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Nickname đã có người dùng' });
    throw err;
  }
  res.json({ user: publicUser(await findUser(req.user.id)) });
});

/** Bước 1 liên kết ví: lấy message để ký bằng MetaMask. */
router.get('/wallet/nonce', requireAuth, (req, res) => {
  const { address } = req.query;
  if (!isAddress(address)) return res.status(400).json({ message: 'Địa chỉ ví không hợp lệ' });
  const checksum = getAddress(address);
  const message = [
    'Liên kết ví với tài khoản Cờ Caro',
    '',
    'Ký message này để chứng minh bạn sở hữu ví. Việc ký không tốn phí và không tạo giao dịch.',
    '',
    `Tài khoản: ${req.user.email}`,
    `Ví: ${checksum}`,
    `Nonce: ${crypto.randomBytes(16).toString('hex')}`,
    `Thời gian: ${new Date().toISOString()}`,
  ].join('\n');
  pendingLinks.set(req.user.id, { address: checksum.toLowerCase(), message, expiresAt: Date.now() + NONCE_TTL_MS });
  res.json({ message });
});

/** Bước 2 liên kết ví: gửi chữ ký, backend kiểm tra rồi gắn ví vào tài khoản (thay ví cũ nếu có). */
router.post('/wallet/link', requireAuth, async (req, res) => {
  const { signature } = req.body || {};
  const pending = pendingLinks.get(req.user.id);
  pendingLinks.delete(req.user.id);
  if (!pending || pending.expiresAt < Date.now() || typeof signature !== 'string') {
    return res.status(400).json({ message: 'Yêu cầu liên kết đã hết hạn, hãy thử lại' });
  }

  let signer;
  try {
    signer = verifyMessage(pending.message, signature);
  } catch {
    return res.status(401).json({ message: 'Chữ ký không hợp lệ' });
  }
  if (signer.toLowerCase() !== pending.address) {
    return res.status(401).json({ message: 'Chữ ký không khớp với ví' });
  }

  const owner = await query('SELECT id, email FROM users WHERE wallet_address = ? AND id <> ?', [
    pending.address,
    req.user.id,
  ]);
  if (owner[0]) return res.status(409).json({ message: 'Ví này đã được liên kết với một tài khoản Google khác' });

  try {
    await query('UPDATE users SET wallet_address = ? WHERE id = ?', [pending.address, req.user.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Ví này đã được liên kết với một tài khoản Google khác' });
    }
    throw err;
  }
  res.json({ user: publicUser(await findUser(req.user.id)) });
});

/** Bảng địa chỉ ví -> tên hiển thị (nickname, hoặc tên Google) cho sảnh, bàn cờ, bảng xếp hạng. */
router.get('/users', async (req, res) => {
  const rows = await query(
    'SELECT wallet_address, COALESCE(nickname, name) AS display_name FROM users WHERE wallet_address IS NOT NULL',
  );
  res.json(Object.fromEntries(rows.map((r) => [r.wallet_address, r.display_name])));
});

module.exports = { router, requireAuth, googleCallback };
