// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Ví điện tử + Cờ Caro đặt cược (escrow)
/// @notice Ví: nạp, rút, chuyển ETH giữa người dùng, xem số dư và lịch sử giao dịch.
///         Game (state channel): hai người đánh off-chain, mỗi nước được ký số; cuối ván chỉ gửi
///         chuỗi nước đi kèm chữ ký lên contract trong 1 giao dịch. Contract kiểm tra từng chữ ký,
///         đặt lại bàn cờ và tự xác định người thắng, nên không ai có thể "tuyên bố" thắng để lấy tiền cược.
/// @dev Không import thư viện ngoài, có thể dán thẳng vào Remix IDE để biên dịch.
contract CaroBetting {
    uint8 public constant SIZE = 15;
    uint16 public constant CELLS = 225; // SIZE * SIZE
    uint256 public constant MOVE_TIMEOUT = 5 minutes;
    uint256 public constant FEE_BPS = 200; // phí sàn 2%

    enum Status {
        Waiting,   // đã tạo phòng, chờ đối thủ
        Playing,   // đang đánh
        Finished,  // có người thắng hoặc hoà
        Cancelled  // chủ phòng huỷ khi chưa có ai vào
    }

    enum TxType {
        Deposit,     // nạp từ MetaMask vào ví
        Withdraw,    // rút từ ví về MetaMask
        TransferOut, // chuyển cho người khác
        TransferIn,  // nhận từ người khác
        Bet,         // khoá tiền cược khi tạo/vào phòng
        Win,         // nhận thưởng khi thắng
        Refund,      // hoàn cược (huỷ phòng / hoà)
        Fee          // phí sàn (chỉ ví nhận phí)
    }

    struct Game {
        address playerX;    // người tạo phòng, đi trước
        address playerO;    // người vào phòng
        uint256 betAmount;  // tiền cược của mỗi bên
        address winner;     // address(0) nếu hoà / chưa xong
        Status status;
        uint8 turn;         // 1 = X, 2 = O
        uint16 moveCount;   // số nước đã ghi lên chain
        uint64 lastMoveAt;  // mốc thời gian để tính hết giờ (chỉ dùng khi tranh chấp)
        address sessionX;   // khoá phiên của X: ký nước đi off-chain thay cho ví chính, không hiện popup
        address sessionO;   // khoá phiên của O
        bytes32 stateHash;  // digest của nước cuối đã ghi lên chain (0 nếu chưa có nước nào)
        bool disputed;      // đã đưa ván lên chain: từ đó nước đi phải gửi lên chain và bắt đầu tính giờ
    }

    struct Transaction {
        TxType txType;
        address counterparty;  // người nhận/gửi khi chuyển tiền, address(0) nếu không có
        uint256 amount;
        uint256 gameId;        // 0 nếu không liên quan tới ván cờ
        uint256 balanceAfter;  // số dư ví sau giao dịch
        uint64 timestamp;
    }

    address public immutable feeRecipient;
    mapping(address => uint256) public balances;
    mapping(uint256 => Game) public games;
    mapping(uint256 => uint8[CELLS]) private boards; // 0 trống, 1 X, 2 O
    mapping(address => Transaction[]) private histories;
    uint256 public gameCount;

    event Deposited(address indexed player, uint256 amount);
    event Withdrawn(address indexed player, uint256 amount);
    event Transferred(address indexed from, address indexed to, uint256 amount);
    event RoomCreated(uint256 indexed gameId, address indexed playerX, uint256 betAmount);
    event RoomCancelled(uint256 indexed gameId);
    event RoomJoined(uint256 indexed gameId, address indexed playerO);
    event MoveMade(uint256 indexed gameId, address indexed player, uint8 x, uint8 y);
    event GameEnded(uint256 indexed gameId, address winner, uint256 reward, string reason);

    constructor() {
        feeRecipient = msg.sender;
    }

    // ---------------- Ví ----------------

    function deposit() public payable {
        require(msg.value > 0, "So tien nap phai lon hon 0");
        _deposit();
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "So tien rut phai lon hon 0");
        require(balances[msg.sender] >= amount, "So du khong du");
        balances[msg.sender] -= amount; // trừ trước khi chuyển để chống reentrancy
        _record(msg.sender, TxType.Withdraw, address(0), amount, 0);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Chuyen tien that bai");
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Chuyển tiền trong ví game sang ví game của người khác (không tốn phí sàn).
    function transfer(address to, uint256 amount) external {
        require(to != address(0), "Dia chi nguoi nhan khong hop le");
        require(to != msg.sender, "Khong the chuyen cho chinh minh");
        require(amount > 0, "So tien chuyen phai lon hon 0");
        require(balances[msg.sender] >= amount, "So du khong du");

        balances[msg.sender] -= amount;
        balances[to] += amount;
        _record(msg.sender, TxType.TransferOut, to, amount, 0);
        _record(to, TxType.TransferIn, msg.sender, amount, 0);
        emit Transferred(msg.sender, to, amount);
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    function getHistoryCount(address user) external view returns (uint256) {
        return histories[user].length;
    }

    /// @notice Lấy lịch sử giao dịch [start, start + count) của một ví (cũ -> mới).
    function getHistory(address user, uint256 start, uint256 count) external view returns (Transaction[] memory list) {
        Transaction[] storage all = histories[user];
        if (start >= all.length) return new Transaction[](0);
        uint256 end = start + count;
        if (end > all.length) end = all.length;
        list = new Transaction[](end - start);
        for (uint256 i = start; i < end; i++) {
            list[i - start] = all[i];
        }
    }

    // ---------------- Phòng chơi ----------------

    /// @notice Tạo phòng. Có thể gửi kèm ETH để nạp luôn vào ví trước khi trừ cược.
    /// @param sessionKey Khoá phiên ký nước đi off-chain (address(0): chỉ ký bằng ví chính).
    function createRoom(uint256 betAmount, address sessionKey) external payable returns (uint256 gameId) {
        require(betAmount > 0, "Tien cuoc phai lon hon 0");
        if (msg.value > 0) _deposit();
        require(balances[msg.sender] >= betAmount, "So du vi khong du de dat cuoc");
        balances[msg.sender] -= betAmount;

        gameId = ++gameCount;
        Game storage g = games[gameId];
        g.playerX = msg.sender;
        g.sessionX = sessionKey;
        g.betAmount = betAmount;
        g.status = Status.Waiting;
        _record(msg.sender, TxType.Bet, address(0), betAmount, gameId);
        emit RoomCreated(gameId, msg.sender, betAmount);
    }

    function cancelRoom(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.status == Status.Waiting && g.playerX != address(0), "Phong khong o trang thai cho");
        require(msg.sender == g.playerX, "Chi chu phong duoc huy");
        g.status = Status.Cancelled;
        balances[g.playerX] += g.betAmount;
        _record(g.playerX, TxType.Refund, address(0), g.betAmount, gameId);
        emit RoomCancelled(gameId);
    }

    /// @notice Vào phòng. Có thể gửi kèm ETH để nạp luôn vào ví trước khi trừ cược.
    function joinRoom(uint256 gameId, address sessionKey) external payable {
        Game storage g = games[gameId];
        require(g.playerX != address(0), "Phong khong ton tai");
        require(g.status == Status.Waiting, "Phong da du nguoi hoac da dong");
        require(msg.sender != g.playerX, "Khong the tu choi voi chinh minh");
        if (msg.value > 0) _deposit();
        require(balances[msg.sender] >= g.betAmount, "So du vi khong du de theo cuoc");

        balances[msg.sender] -= g.betAmount;
        g.playerO = msg.sender;
        g.sessionO = sessionKey;
        g.status = Status.Playing;
        g.turn = 1;
        g.lastMoveAt = uint64(block.timestamp);
        _record(msg.sender, TxType.Bet, g.playerX, g.betAmount, gameId);
        emit RoomJoined(gameId, msg.sender);
    }

    // ---------------- Đánh cờ (state channel) ----------------
    //
    // Nước thứ i được ký trên digest = keccak256(contract, chainId, gameId, i, x, y, digest nước i-1).
    // Digest nối nhau thành chuỗi, nên chữ ký của một nước chỉ hợp lệ với đúng lịch sử trước nó:
    // không thể đổi thứ tự, bỏ bớt hay chèn nước đi vào giữa.

    /// @notice Digest mà người chơi ký cho nước thứ `index` (ký dạng personal_sign / EIP-191).
    function moveDigest(uint256 gameId, uint256 index, uint8 x, uint8 y, bytes32 prevHash) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, gameId, index, x, y, prevHash));
    }

    /// @notice Gửi các nước đã đánh off-chain (tiếp theo các nước đã có trên chain) kèm chữ ký.
    ///         - Nước cuối tạo 5 quân liên tiếp: trả thưởng ngay (thường chỉ cần 1 giao dịch cho cả ván).
    ///         - Chưa phân thắng bại: ván chuyển sang chế độ tranh chấp, người đến lượt có MOVE_TIMEOUT
    ///           để đi nước tiếp theo (cũng bằng hàm này), nếu không đối thủ được claimTimeout.
    function submitMoves(uint256 gameId, uint8[] calldata xs, uint8[] calldata ys, bytes[] calldata sigs) external {
        Game storage g = games[gameId];
        require(g.status == Status.Playing, "Tran dau khong dien ra");
        require(msg.sender == g.playerX || msg.sender == g.playerO, "Ban khong phai nguoi choi");
        require(xs.length == ys.length && xs.length == sigs.length, "Du lieu nuoc di khong hop le");
        require(xs.length > 0 || !g.disputed, "Khong co nuoc di moi");
        require(!g.disputed || block.timestamp <= g.lastMoveAt + MOVE_TIMEOUT, "Da het thoi gian di");

        for (uint256 i = 0; i < xs.length; i++) {
            if (_applyMove(gameId, xs[i], ys[i], sigs[i])) return; // ván đã kết thúc
        }

        // Chưa ai thắng: tính giờ trên chain cho người đến lượt
        g.disputed = true;
        g.lastMoveAt = uint64(block.timestamp);
    }

    /// @notice Sau khi ván đã đưa lên chain, người đến lượt quá MOVE_TIMEOUT không đi thì đối thủ nhận thắng.
    /// @dev Khi còn đánh off-chain, giờ trên chain không phản ánh ván thật, nên bắt buộc phải tranh chấp trước.
    function claimTimeout(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.status == Status.Playing, "Tran dau khong dien ra");
        require(g.disputed, "Phai dua van len chain truoc khi nhan thang");
        require(block.timestamp > g.lastMoveAt + MOVE_TIMEOUT, "Doi thu van con thoi gian");
        address waiting = g.turn == 1 ? g.playerO : g.playerX;
        require(msg.sender == waiting, "Chi doi thu cua nguoi het gio moi duoc nhan thang");
        _payWinner(gameId, msg.sender, "timeout");
    }

    function resign(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.status == Status.Playing, "Tran dau khong dien ra");
        require(msg.sender == g.playerX || msg.sender == g.playerO, "Ban khong phai nguoi choi");
        address winner = msg.sender == g.playerX ? g.playerO : g.playerX;
        _payWinner(gameId, winner, "resign");
    }

    // ---------------- View ----------------

    function getBoard(uint256 gameId) external view returns (uint8[CELLS] memory) {
        return boards[gameId];
    }

    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    /// @notice Lấy danh sách phòng [start, start + count) để hiển thị sảnh chờ.
    function getGames(uint256 start, uint256 count) external view returns (Game[] memory list) {
        if (start == 0) start = 1;
        if (start > gameCount) return new Game[](0);
        uint256 end = start + count - 1;
        if (end > gameCount) end = gameCount;
        list = new Game[](end - start + 1);
        for (uint256 i = start; i <= end; i++) {
            list[i - start] = games[i];
        }
    }

    // ---------------- Nội bộ ----------------

    function _deposit() private {
        balances[msg.sender] += msg.value;
        _record(msg.sender, TxType.Deposit, address(0), msg.value, 0);
        emit Deposited(msg.sender, msg.value);
    }

    /// @dev Gọi SAU khi đã cập nhật balances để lưu đúng số dư sau giao dịch.
    function _record(address user, TxType txType, address counterparty, uint256 amount, uint256 gameId) private {
        histories[user].push(
            Transaction(txType, counterparty, amount, gameId, balances[user], uint64(block.timestamp))
        );
    }

    /// @dev Kiểm tra chữ ký rồi ghi một nước đi lên bàn cờ. Trả về true nếu ván kết thúc (thắng hoặc hoà).
    function _applyMove(uint256 gameId, uint8 x, uint8 y, bytes calldata sig) private returns (bool) {
        Game storage g = games[gameId];
        require(x < SIZE && y < SIZE, "Toa do ngoai ban co");
        uint8[CELLS] storage board = boards[gameId];
        uint16 idx = uint16(y) * SIZE + x;
        require(board[idx] == 0, "O nay da co quan");

        uint8 mark = g.turn;
        address player = mark == 1 ? g.playerX : g.playerO;
        bytes32 digest = moveDigest(gameId, g.moveCount, x, y, g.stateHash);
        address signer = _recover(digest, sig);
        require(
            signer != address(0) && (signer == player || signer == (mark == 1 ? g.sessionX : g.sessionO)),
            "Chu ky nuoc di khong hop le"
        );

        board[idx] = mark;
        g.moveCount++;
        g.stateHash = digest;
        emit MoveMade(gameId, player, x, y);

        if (_isFiveInRow(board, x, y, mark)) {
            _payWinner(gameId, player, "five-in-a-row");
            return true;
        }
        if (g.moveCount == CELLS) {
            _refundDraw(gameId);
            return true;
        }
        g.turn = mark == 1 ? 2 : 1;
        return false;
    }

    /// @dev Khôi phục địa chỉ đã ký `digest` theo chuẩn personal_sign ("\x19Ethereum Signed Message:\n32").
    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(ethHash, v, r, s);
    }

    function _payWinner(uint256 gameId, address winner, string memory reason) private {
        Game storage g = games[gameId];
        g.status = Status.Finished;
        g.winner = winner;

        uint256 pot = g.betAmount * 2;
        uint256 fee = (pot * FEE_BPS) / 10_000;
        uint256 reward = pot - fee;
        address loser = winner == g.playerX ? g.playerO : g.playerX;
        balances[winner] += reward;
        balances[feeRecipient] += fee;
        _record(winner, TxType.Win, loser, reward, gameId);
        _record(feeRecipient, TxType.Fee, address(0), fee, gameId);
        emit GameEnded(gameId, winner, reward, reason);
    }

    function _refundDraw(uint256 gameId) private {
        Game storage g = games[gameId];
        g.status = Status.Finished;
        balances[g.playerX] += g.betAmount;
        balances[g.playerO] += g.betAmount;
        _record(g.playerX, TxType.Refund, g.playerO, g.betAmount, gameId);
        _record(g.playerO, TxType.Refund, g.playerX, g.betAmount, gameId);
        emit GameEnded(gameId, address(0), 0, "draw");
    }

    function _isFiveInRow(uint8[CELLS] storage board, uint8 x, uint8 y, uint8 mark) private view returns (bool) {
        int8[4] memory dx = [int8(1), 0, 1, 1];
        int8[4] memory dy = [int8(0), 1, 1, -1];
        for (uint256 d = 0; d < 4; d++) {
            uint256 n = 1 + _count(board, x, y, dx[d], dy[d], mark) + _count(board, x, y, -dx[d], -dy[d], mark);
            if (n >= 5) return true;
        }
        return false;
    }

    function _count(uint8[CELLS] storage board, uint8 x, uint8 y, int8 dx, int8 dy, uint8 mark) private view returns (uint256 n) {
        int16 cx = int16(uint16(x)) + dx;
        int16 cy = int16(uint16(y)) + dy;
        while (n < 4 && cx >= 0 && cy >= 0 && cx < int16(uint16(SIZE)) && cy < int16(uint16(SIZE))) {
            if (board[uint16(cy) * SIZE + uint16(cx)] != mark) break;
            n++;
            cx += dx;
            cy += dy;
        }
    }
}
