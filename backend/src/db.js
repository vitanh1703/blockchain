const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'caro',
  password: process.env.DB_PASSWORD || 'caro',
};
const DB_NAME = process.env.DB_NAME || 'caro_betting';

let pool = null;

const SCHEMA = [
  // Tài khoản = tài khoản Google; ví MetaMask được liên kết bằng chữ ký
  `CREATE TABLE IF NOT EXISTS users (
    id             INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
    google_id      VARCHAR(64)   NOT NULL UNIQUE,         -- "sub" trong ID token của Google
    email          VARCHAR(255)  NOT NULL,
    name           VARCHAR(255)  NOT NULL,
    avatar_url     VARCHAR(1024) NULL,
    nickname       VARCHAR(20)   NULL UNIQUE,             -- collation _ci: không phân biệt hoa thường
    wallet_address CHAR(42)      NULL UNIQUE,             -- ví đã liên kết (chữ thường)
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at  DATETIME      NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token      CHAR(64)     NOT NULL PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    expires_at BIGINT       NOT NULL,                     -- unix ms
    INDEX idx_sessions_user (user_id),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // Kết quả trận, được đồng bộ từ sự kiện GameEnded trên blockchain
  `CREATE TABLE IF NOT EXISTS matches (
    game_id      INT UNSIGNED   NOT NULL PRIMARY KEY,
    player_x     CHAR(42)       NOT NULL,
    player_o     CHAR(42)       NOT NULL,
    bet_wei      DECIMAL(65, 0) NOT NULL,
    winner       CHAR(42)       NULL,                     -- NULL nếu hoà
    reward_wei   DECIMAL(65, 0) NOT NULL,
    reason       VARCHAR(32)    NOT NULL,
    block_number BIGINT         NOT NULL,
    tx_hash      CHAR(66)       NOT NULL,
    ended_at     BIGINT         NOT NULL,                 -- unix giây (timestamp của block)
    INDEX idx_matches_x (player_x),
    INDEX idx_matches_o (player_o)
  )`,
  // Nước đi off-chain (state channel), mỗi nước kèm chữ ký của người đi. Chỉ gửi lên blockchain khi kết thúc
  // hoặc tranh chấp. Backend chỉ chuyển tiếp: contract kiểm tra lại chữ ký nên backend không làm giả được.
  `CREATE TABLE IF NOT EXISTS offchain_moves (
    game_id    INT UNSIGNED      NOT NULL,
    move_index SMALLINT UNSIGNED NOT NULL,                -- 0, 1, 2… (chẵn: X, lẻ: O)
    x          TINYINT UNSIGNED  NOT NULL,
    y          TINYINT UNSIGNED  NOT NULL,
    signature  CHAR(132)         NOT NULL,                -- 0x + 65 byte
    created_at BIGINT            NOT NULL,                -- unix ms, để tính giờ khi đánh off-chain
    PRIMARY KEY (game_id, move_index)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    meta_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
    meta_value VARCHAR(255) NULL
  )`,
];

/** Tạo database (nếu chưa có), pool kết nối và các bảng. Gọi một lần khi khởi động. */
async function initDb() {
  const conn = await mysql.createConnection(config);
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.end();

  pool = mysql.createPool({ ...config, database: DB_NAME, charset: 'utf8mb4', connectionLimit: 10 });

  // Bảng users kiểu cũ (đăng nhập bằng ví, khoá chính là address) → bỏ để tạo lại theo tài khoản Google
  const [old] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'users' AND column_name = 'address'`,
    [DB_NAME],
  );
  if (old.length) {
    console.log('[db] Chuyển bảng users/sessions cũ (đăng nhập bằng ví) sang tài khoản Google');
    await pool.query('DROP TABLE IF EXISTS sessions');
    await pool.query('DROP TABLE IF EXISTS users');
  }

  for (const sql of SCHEMA) await pool.query(sql);
}

/** Chạy câu lệnh có tham số, trả về rows (SELECT) hoặc kết quả (INSERT/UPDATE/DELETE). */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getMeta(key) {
  const rows = await query('SELECT meta_value FROM meta WHERE meta_key = ?', [key]);
  return rows[0]?.meta_value ?? null;
}

async function setMeta(key, value) {
  await query(
    'INSERT INTO meta (meta_key, meta_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)',
    [key, value == null ? null : String(value)],
  );
}

module.exports = { initDb, query, getMeta, setMeta, DB_NAME, dbConfig: config };
