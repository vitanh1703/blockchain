# Cờ Caro đặt cược (Blockchain DApp)

Hai người chơi đặt cược ETH, đánh cờ Caro 15×15 trực tiếp trên smart contract. Contract giữ tiền cược (escrow), tự kiểm tra 5 quân liên tiếp và trả thưởng vào ví game của người thắng.

## Cấu trúc

```
smart-contract/   Hardhat + Solidity (contract CaroBetting, test, script deploy)
frontend/         React + Vite + ethers.js, chạy ở http://localhost:5173
backend/          Express API (chưa dùng cho game), chạy ở http://localhost:5000
```

## Luật & cơ chế contract

- **Ví game**: `deposit()` nạp ETH từ MetaMask vào contract, `withdraw()` rút về. Số dư lưu trong `balances`.
- **Tạo phòng** `createRoom(bet)`: trừ tiền cược từ ví game. Có thể gửi kèm ETH để nạp phần còn thiếu trong cùng giao dịch.
- **Huỷ phòng** `cancelRoom(id)`: chủ phòng huỷ khi chưa có ai vào, được hoàn tiền.
- **Vào phòng** `joinRoom(id)`: đặt đúng số tiền cược, trận bắt đầu, X đi trước.
- **Đánh cờ** `makeMove(id, x, y)`: contract kiểm tra lượt, ô trống, rồi kiểm tra ≥ 5 quân liên tiếp (ngang, dọc, 2 đường chéo).
- **Hết giờ** `claimTimeout(id)`: mỗi lượt có 5 phút; quá giờ thì đối thủ nhận thắng.
- **Đầu hàng** `resign(id)`.
- **Trả thưởng**: người thắng nhận 98% hũ (2 × cược), 2% phí sàn vào ví game của người deploy. Hoà (kín bàn) thì hoàn cược cho cả hai.

> Khác với bản thiết kế ban đầu, contract **không có** hàm `claimVictory(gameId, winner)`, vì hàm đó cho phép bất kỳ ai tự chỉ định người thắng và lấy hết tiền cược. Người thắng được xác định từ các nước đi lưu trên chain.

## Cài đặt

```bash
cd smart-contract && npm install
cd ../frontend && npm install
```

## Chạy dev

1. Chạy blockchain local (giữ terminal này mở):

   ```bash
   cd smart-contract && npm run node
   ```

   Terminal sẽ in ra 20 tài khoản test, mỗi tài khoản có 10000 ETH kèm private key.

2. Deploy contract (terminal khác). Script tự ghi địa chỉ + ABI vào `frontend/src/contracts/CaroBetting.json`:

   ```bash
   cd smart-contract && npm run deploy
   ```

3. Chạy frontend:

   ```bash
   cd frontend && npm run dev
   ```

4. Trong MetaMask, import 2 private key từ bước 1 (vd. Account #1 và #2) để đóng vai 2 người chơi. Mở http://localhost:5173 ở 2 trình duyệt/profile khác nhau, bấm **Kết nối MetaMask** (app sẽ tự thêm mạng Hardhat Local, chainId 31337).

**Lưu ý:** mỗi lần khởi động lại `npm run node`, blockchain bị reset — cần chạy lại `npm run deploy`, và trong MetaMask vào *Settings → Advanced → Clear activity tab data* để tránh lỗi nonce.

## Test contract

```bash
cd smart-contract && npm test
```
