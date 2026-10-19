# blockchain

Dự án web gồm frontend React (Vite) và backend Node.js (Express).

## Cấu trúc

```
frontend/   React + Vite, chạy ở http://localhost:5173
backend/    Express API, chạy ở http://localhost:5000
```

Khi chạy dev, frontend chuyển tiếp các request `/api/*` sang backend (cấu hình trong `frontend/vite.config.js`).

## Cài đặt

```bash
cd backend && npm install && cp .env.example .env
cd ../frontend && npm install
```

## Chạy dev

Mở 2 terminal:

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

Mở http://localhost:5173. Trang sẽ hiện "Backend đang chạy" nếu kết nối được API.
