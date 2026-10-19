# Ví điện tử & Cờ Caro đặt cược (Blockchain DApp)

Hợp đồng thông minh quản lý **ví điện tử đơn giản** (nạp, rút, chuyển, xem số dư, lịch sử giao dịch), dùng làm ví cho game **Cờ Caro 15×15 đặt cược**: contract giữ tiền cược (escrow), tự kiểm tra 5 quân liên tiếp và trả thưởng vào ví người thắng.

**Công nghệ:** Solidity 0.8.24 · Remix IDE · Ganache (hoặc Hardhat node) · Hardhat (test, deploy) · React + ethers.js · Express + MySQL.

## Đối chiếu yêu cầu đề bài

| Yêu cầu | Đáp ứng ở đâu |
|---|---|
| Nạp token | `deposit()` (payable) — nút **Nạp** trong popover 🪙 Ví game |
| Rút token | `withdraw(amount)` — nút **Rút** |
| Chuyển token | `transfer(to, amount)` — tab **Chuyển**, nhập nickname hoặc địa chỉ ví người nhận |
| Kiểm tra số dư | `balanceOf(user)` / `balances(user)` — chip 🪙 ở góc trên phải |
| Ghi lại lịch sử giao dịch | Mỗi giao dịch được lưu on-chain (`getHistoryCount`, `getHistory`) + phát event — nút 📜 **Lịch sử giao dịch** |
| Solidity | [smart-contract/contracts/CaroBetting.sol](smart-contract/contracts/CaroBetting.sol), một file, không import ngoài |
| Remix IDE | Xem mục [Chạy với Remix IDE](#chạy-với-remix-ide) |
| Ganache | `npm run ganache` + `npm run deploy:ganache`, hoặc Ganache GUI (cổng 7545) |

"Token" ở đây là **ETH** — đồng tiền gốc của blockchain (trên Ganache/Hardhat là ETH giả để test).

## Cấu trúc

```
smart-contract/   Solidity + Hardhat (contract, 15 test, script deploy cho Ganache/Hardhat)
frontend/         React + Vite + ethers.js, chạy ở http://localhost:5173
backend/          Express API + MySQL: đăng nhập Google, nickname, bảng xếp hạng (http://localhost:4000)
```

## Smart contract

### Ví điện tử

| Hàm | Mô tả |
|---|---|
| `deposit()` payable | Nạp ETH từ MetaMask vào ví |
| `withdraw(amount)` | Rút ETH về MetaMask (trừ số dư trước khi chuyển để chống reentrancy) |
| `transfer(to, amount)` | Chuyển cho ví khác; chặn người nhận `0x0`, tự chuyển cho mình, số dư không đủ |
| `balanceOf(user)` / `balances(user)` | Xem số dư |
| `getHistoryCount(user)` | Số giao dịch của một ví |
| `getHistory(user, start, count)` | Lấy danh sách giao dịch (phân trang, cũ → mới) |

Mỗi bản ghi lịch sử (`Transaction`) gồm: loại giao dịch, người đối ứng, số tiền, mã phòng (nếu có), **số dư sau giao dịch**, thời gian. Các loại: `Deposit`, `Withdraw`, `TransferOut`, `TransferIn`, `Bet` (khoá cược), `Win` (nhận thưởng), `Refund` (hoàn cược), `Fee` (phí sàn). Event: `Deposited`, `Withdrawn`, `Transferred`, `GameEnded`…

### Cờ Caro đặt cược

- `createRoom(bet)` / `joinRoom(id)`: trừ tiền cược từ ví (gửi kèm ETH để nạp phần thiếu trong cùng giao dịch). `cancelRoom(id)`: chủ phòng huỷ khi chưa có ai vào, được hoàn tiền.
- `makeMove(id, x, y)`: kiểm tra lượt, ô trống, rồi kiểm tra ≥ 5 quân liên tiếp.
- `claimTimeout(id)`: mỗi lượt 5 phút, quá giờ đối thủ nhận thắng. `resign(id)`: đầu hàng.
- Người thắng nhận 98% hũ, 2% phí sàn vào ví người deploy. Hoà (kín bàn) thì hoàn cược.

> Contract **không có** hàm kiểu `claimVictory(gameId, winner)` vì hàm đó cho phép bất kỳ ai tự chỉ định người thắng. Người thắng được xác định từ các nước đi lưu trên chain.

## Đăng nhập Google, nickname & bảng xếp hạng (backend + MySQL)

- **Database:** MySQL 8.4 chạy bằng Docker (`backend/docker-compose.yml`, cổng **3307** — vì 3306 thuộc MySQL cài sẵn trên máy). Cấu hình `DB_*` trong `backend/.env`; backend tự tạo database và bảng.
- **Chỉ đăng nhập bằng Google** (OAuth redirect): `/api/auth/google` → Google → `/auth/google/callback` → backend cấp session token (7 ngày). Chưa đăng nhập thì chỉ thấy trang Login.
- **Liên kết ví MetaMask:** ví vẫn cần để ký giao dịch tiền. Ví được gắn vào tài khoản Google bằng một chữ ký (không tốn gas) để chứng minh sở hữu; mỗi ví chỉ thuộc một tài khoản.
- **Chuyển qua lại tài khoản:** menu tài khoản → *Đổi tài khoản Google* (mở bảng chọn tài khoản của Google). Đổi tài khoản trong MetaMask thì app tự theo ví mới; nếu khác ví đã liên kết sẽ có cảnh báo và nút *Liên kết ví này*.
- **Nickname:** 3–20 ký tự, không trùng; nếu chưa đặt thì dùng tên Google. Hiển thị thay địa chỉ ví và dùng được khi chuyển tiền.
- **Bảng xếp hạng:** backend đọc sự kiện `GameEnded` từ contract nên kết quả không thể làm giả.
- Khi blockchain bị reset, backend tự xoá dữ liệu trận cũ; tài khoản và nickname được giữ lại.

| Bảng | Nội dung |
|---|---|
| `users` | tài khoản Google (google_id, email, tên, ảnh), nickname, ví đã liên kết |
| `sessions` | token đăng nhập, hạn dùng |
| `matches` | kết quả trận đồng bộ từ blockchain |
| `meta` | trạng thái đồng bộ (block cuối đã đọc) |

## Cài đặt

```bash
cd smart-contract && npm install
cd ../backend && npm install && cp .env.example .env   # rồi điền GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
cd ../frontend && npm install
```

## Cấu hình đăng nhập Google

Trong `backend/.env`:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback
```

OAuth client (Google Cloud Console → APIs & Services → Credentials, loại *Web application*) phải có `http://localhost:4000/auth/google/callback` trong **Authorized redirect URIs**. Có thể dùng chung client với dự án invite-party (đã đăng ký đúng URI này).

## Chạy dự án với Ganache

Mở 4 terminal:

1. **MySQL** (cần Docker Desktop):

   ```bash
   cd backend && docker compose up -d
   ```

2. **Ganache** (giữ terminal mở):

   ```bash
   cd smart-contract && npm run ganache
   ```

   Ganache chạy ở `http://127.0.0.1:7545`, chainId `1337`, in ra 10 tài khoản (1000 ETH mỗi tài khoản) kèm private key. Dùng **Ganache GUI** cũng được: tạo workspace với cổng 7545 (mặc định của GUI) rồi bỏ qua lệnh này.

   Deploy contract (terminal khác):

   ```bash
   cd smart-contract && npm run deploy:ganache
   ```

   Script ghi địa chỉ, ABI và RPC của mạng vào `frontend/src/contracts/` và `backend/src/contracts/`, nên frontend và backend tự kết nối đúng mạng.

3. **Backend:** `cd backend && npm run dev` (cổng 4000; tự khởi động lại khi sửa `src/` hoặc `.env`)
4. **Frontend:** `cd frontend && npm run dev` → mở http://localhost:5173

Trong MetaMask, import 2 private key của Ganache (vd. tài khoản 1 và 2; tài khoản 0 là ví deploy/nhận phí). Mở trang ở 2 trình duyệt/profile, bấm **Kết nối ví** (app tự thêm mạng "Ganache Local"), rồi **Đăng nhập** để chọn nickname.

> Dùng Hardhat node thay Ganache: `npm run node` + `npm run deploy` (cổng 8545, chainId 31337).
>
> Mỗi lần khởi động lại blockchain cần deploy lại, và trong MetaMask vào *Settings → Advanced → Clear activity tab data* để tránh lỗi nonce.

## Chạy với Remix IDE

Contract là một file Solidity không import thư viện ngoài, dán thẳng vào Remix được:

1. Mở https://remix.ethereum.org, tạo file `CaroBetting.sol`, dán nội dung [smart-contract/contracts/CaroBetting.sol](smart-contract/contracts/CaroBetting.sol).
2. Tab **Solidity Compiler**: chọn compiler `0.8.24`, bật *Optimization* (200 runs), bấm **Compile**.
3. Tab **Deploy & Run Transactions**, chọn Environment:
   - **Remix VM** để thử nhanh trong trình duyệt, hoặc
   - **Dev - Ganache Provider** (nhập `http://127.0.0.1:7545`) để deploy lên Ganache đang chạy, hoặc
   - **Injected Provider - MetaMask** khi MetaMask đang ở mạng Ganache Local.
4. Bấm **Deploy**, rồi thử các hàm ví:
   - `deposit`: nhập số ETH vào ô **Value** (vd. `1 ether`) rồi bấm `deposit`.
   - `balanceOf`: dán địa chỉ ví → xem số dư (wei).
   - `transfer`: nhập `to` (địa chỉ tài khoản khác trong danh sách Account) và `amount` (wei, vd. `300000000000000000` = 0.3 ETH).
   - `withdraw`: nhập `amount` (wei).
   - `getHistoryCount` / `getHistory(user, 0, 10)`: xem lịch sử giao dịch; khung terminal của Remix hiện cả event `Deposited`, `Transferred`, `Withdrawn`.
5. Muốn dùng contract vừa deploy bằng Remix với giao diện web: cập nhật `address` trong `frontend/src/contracts/CaroBetting.json` và `backend/src/contracts/CaroBetting.json` thành địa chỉ Remix trả về (cùng mạng Ganache).

## Demo chức năng ví (chạy thật trên Ganache)

```bash
cd smart-contract && npm run demo:ganache
```

Script [scripts/demo-wallet.js](smart-contract/scripts/demo-wallet.js) dùng 2 tài khoản Ganache (Alice, Bob) gọi contract đang deploy: nạp 1 ETH → xem số dư → chuyển 0.3 ETH → rút 0.1 ETH → thử 3 giao dịch sai (bị contract chặn) → đọc lịch sử giao dịch. In ra tx hash, block, event và số dư trước/sau từng bước. Giao dịch cũng hiện trong tab Transactions của Ganache GUI và nút 📜 trên web.

## Test contract

```bash
cd smart-contract && npm test
```

15 test, gồm: nạp/rút, chuyển tiền và các trường hợp bị chặn, lịch sử giao dịch (thứ tự, số dư sau, phân trang), luật thắng 5 quân, hết giờ, đầu hàng, phí sàn, hoàn cược.
