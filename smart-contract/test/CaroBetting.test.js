const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const BET = ethers.parseEther('0.05');
const ZERO_HASH = ethers.ZeroHash;

describe('CaroBetting', () => {
  async function deployFixture() {
    const [owner, alice, bob, eve] = await ethers.getSigners();
    const caro = await ethers.deployContract('CaroBetting');
    // Khoá phiên: ví tạm trong trình duyệt, ký nước đi off-chain không cần MetaMask
    const sessionA = ethers.Wallet.createRandom();
    const sessionB = ethers.Wallet.createRandom();
    return { caro, owner, alice, bob, eve, sessionA, sessionB };
  }

  async function playingFixture() {
    const ctx = await deployFixture();
    const { caro, alice, bob, sessionA, sessionB } = ctx;
    await caro.connect(alice).createRoom(BET, sessionA.address, { value: BET });
    await caro.connect(bob).joinRoom(1, sessionB.address, { value: BET });
    return ctx;
  }

  /** Tính digest giống contract (để kiểm tra client và contract khớp nhau). */
  async function digestOf(caro, gameId, index, x, y, prevHash) {
    const { chainId } = await ethers.provider.getNetwork();
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'uint256', 'uint256', 'uint8', 'uint8', 'bytes32'],
        [await caro.getAddress(), chainId, gameId, index, x, y, prevHash],
      ),
    );
  }

  /**
   * Đánh off-chain: ký lần lượt các nước trong `moves`, nước thứ `index` do signers[index % 2] ký
   * (chỉ số chẵn là X, lẻ là O). Trả về dữ liệu để gửi submitMoves và digest của nước cuối.
   */
  async function signMoves(caro, gameId, moves, signers, { from = 0, prevHash = ZERO_HASH } = {}) {
    const xs = [];
    const ys = [];
    const sigs = [];
    let hash = prevHash;
    for (let i = 0; i < moves.length; i++) {
      const [x, y] = moves[i];
      const index = from + i;
      hash = await digestOf(caro, gameId, index, x, y, hash);
      sigs.push(await signers[index % 2].signMessage(ethers.getBytes(hash)));
      xs.push(x);
      ys.push(y);
    }
    return { xs, ys, sigs, hash };
  }

  /** X: (0..4, 0) hàng ngang, O: (0..3, 1) bên dưới. Nước thứ 9 (X tại (4,0)) thắng. */
  const ROW_WIN = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]];

  it('nạp và rút tiền', async () => {
    const { caro, alice } = await loadFixture(deployFixture);
    await caro.connect(alice).deposit({ value: BET });
    expect(await caro.balances(alice.address)).to.equal(BET);
    await expect(caro.connect(alice).withdraw(BET)).to.changeEtherBalance(alice, BET);
    expect(await caro.balances(alice.address)).to.equal(0);
    await expect(caro.connect(alice).withdraw(1)).to.be.revertedWith('So du khong du');
  });

  it('tạo phòng trừ số dư, không đủ tiền thì revert', async () => {
    const { caro, alice, sessionA } = await loadFixture(deployFixture);
    await expect(caro.connect(alice).createRoom(BET, sessionA.address)).to.be.revertedWith(
      'So du vi khong du de dat cuoc',
    );
    await caro.connect(alice).deposit({ value: BET * 2n });
    await expect(caro.connect(alice).createRoom(BET, sessionA.address))
      .to.emit(caro, 'RoomCreated')
      .withArgs(1, alice.address, BET);
    expect(await caro.balances(alice.address)).to.equal(BET);
  });

  it('chủ phòng huỷ phòng được hoàn tiền', async () => {
    const { caro, alice, bob } = await loadFixture(deployFixture);
    await caro.connect(alice).createRoom(BET, ethers.ZeroAddress, { value: BET });
    await expect(caro.connect(bob).cancelRoom(1)).to.be.revertedWith('Chi chu phong duoc huy');
    await caro.connect(alice).cancelRoom(1);
    expect(await caro.balances(alice.address)).to.equal(BET);
    await expect(caro.connect(bob).joinRoom(1, ethers.ZeroAddress, { value: BET })).to.be.revertedWith(
      'Phong da du nguoi hoac da dong',
    );
  });

  it('không thể tự vào phòng mình hoặc vào phòng đã đủ người', async () => {
    const { caro, alice, eve } = await loadFixture(playingFixture);
    await expect(caro.connect(eve).joinRoom(1, ethers.ZeroAddress, { value: BET })).to.be.revertedWith(
      'Phong da du nguoi hoac da dong',
    );
    await caro.connect(alice).createRoom(BET, ethers.ZeroAddress, { value: BET });
    await expect(caro.connect(alice).joinRoom(2, ethers.ZeroAddress)).to.be.revertedWith(
      'Khong the tu choi voi chinh minh',
    );
  });

  describe('Đánh cờ off-chain (state channel)', () => {
    it('lưu khoá phiên của hai người chơi', async () => {
      const { caro, sessionA, sessionB } = await loadFixture(playingFixture);
      const g = await caro.getGame(1);
      expect(g.sessionX).to.equal(sessionA.address);
      expect(g.sessionO).to.equal(sessionB.address);
      expect(g.stateHash).to.equal(ZERO_HASH);
      expect(g.disputed).to.equal(false);
    });

    it('digest nước đi tính ở client khớp với contract', async () => {
      const { caro } = await loadFixture(playingFixture);
      const prev = ethers.id('prev');
      expect(await caro.moveDigest(1, 3, 7, 8, prev)).to.equal(await digestOf(caro, 1, 3, 7, 8, prev));
    });

    it('cả ván chỉ 1 giao dịch: 5 quân hàng ngang thắng, nhận thưởng trừ 2% phí', async () => {
      const { caro, owner, alice, bob, sessionA, sessionB } = await loadFixture(playingFixture);
      const { xs, ys, sigs } = await signMoves(caro, 1, ROW_WIN, [sessionA, sessionB]);
      const reward = (BET * 2n * 98n) / 100n;
      await expect(caro.connect(alice).submitMoves(1, xs, ys, sigs))
        .to.emit(caro, 'GameEnded')
        .withArgs(1, alice.address, reward, 'five-in-a-row');
      const g = await caro.getGame(1);
      expect(g.winner).to.equal(alice.address);
      expect(g.status).to.equal(2);
      expect(g.moveCount).to.equal(9);
      expect(await caro.balances(alice.address)).to.equal(reward);
      expect(await caro.balances(owner.address)).to.equal(BET * 2n - reward);
      // bàn cờ trên chain được đặt lại đúng các nước đã đánh
      const board = (await caro.getBoard(1)).map(Number);
      expect(board.slice(0, 5)).to.deep.equal([1, 1, 1, 1, 1]);
      expect(board.slice(15, 19)).to.deep.equal([2, 2, 2, 2]);
      await expect(caro.connect(bob).submitMoves(1, [], [], [])).to.be.revertedWith('Tran dau khong dien ra');
    });

    it('5 quân đường chéo ngược, nước cuối đặt giữa hàng; người thua gửi thì tiền vẫn về người thắng', async () => {
      const { caro, alice, bob, sessionA, sessionB } = await loadFixture(playingFixture);
      // X tại (4,10),(5,9),(7,7),(8,6) rồi chốt ở (6,8); O đánh hàng trên cùng
      const moves = [[4, 10], [0, 0], [5, 9], [1, 0], [7, 7], [2, 0], [8, 6], [3, 0], [6, 8]];
      const { xs, ys, sigs } = await signMoves(caro, 1, moves, [sessionA, sessionB]);
      await caro.connect(bob).submitMoves(1, xs, ys, sigs);
      expect((await caro.getGame(1)).winner).to.equal(alice.address);
    });

    it('ký bằng ví chính (MetaMask) thay cho khoá phiên vẫn hợp lệ', async () => {
      const { caro, alice, bob } = await loadFixture(playingFixture);
      const { xs, ys, sigs } = await signMoves(caro, 1, ROW_WIN, [alice, bob]);
      await caro.connect(alice).submitMoves(1, xs, ys, sigs);
      expect((await caro.getGame(1)).winner).to.equal(alice.address);
    });

    it('chặn chữ ký sai người, chữ ký giả, nước đi bị sửa hoặc đổi thứ tự', async () => {
      const { caro, alice, eve, sessionA, sessionB } = await loadFixture(playingFixture);
      const BAD = 'Chu ky nuoc di khong hop le';
      // Eve ký thay O
      let m = await signMoves(caro, 1, ROW_WIN, [sessionA, eve]);
      await expect(caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith(BAD);
      // X ký bằng khoá phiên của O
      m = await signMoves(caro, 1, ROW_WIN, [sessionB, sessionB]);
      await expect(caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith(BAD);
      // Sửa toạ độ một nước của O sau khi đã ký
      m = await signMoves(caro, 1, ROW_WIN, [sessionA, sessionB]);
      m.xs[3] = 9;
      await expect(caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith(BAD);
      // Đổi thứ tự hai nước của X (chữ ký gắn với lịch sử trước nó)
      m = await signMoves(caro, 1, ROW_WIN, [sessionA, sessionB]);
      [m.xs[0], m.xs[2]] = [m.xs[2], m.xs[0]];
      [m.sigs[0], m.sigs[2]] = [m.sigs[2], m.sigs[0]];
      await expect(caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith(BAD);
      // Chữ ký sai độ dài
      await expect(caro.connect(alice).submitMoves(1, [7], [7], ['0x1234'])).to.be.revertedWith(BAD);
      // Người ngoài không được gửi
      m = await signMoves(caro, 1, ROW_WIN, [sessionA, sessionB]);
      await expect(caro.connect(eve).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith(
        'Ban khong phai nguoi choi',
      );
    });

    it('chặn ô đã có quân và toạ độ ngoài bàn cờ', async () => {
      const { caro, alice, sessionA, sessionB } = await loadFixture(playingFixture);
      let m = await signMoves(caro, 1, [[7, 7], [7, 7]], [sessionA, sessionB]);
      await expect(caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith('O nay da co quan');
      m = await signMoves(caro, 1, [[15, 0]], [sessionA, sessionB]);
      await expect(caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs)).to.be.revertedWith(
        'Toa do ngoai ban co',
      );
    });

    it('chưa ai thắng thì ván chuyển sang tranh chấp, sau đó đi từng nước trên chain', async () => {
      const { caro, alice, bob, sessionA, sessionB } = await loadFixture(playingFixture);
      const first = await signMoves(caro, 1, ROW_WIN.slice(0, 4), [sessionA, sessionB]);
      await caro.connect(alice).submitMoves(1, first.xs, first.ys, first.sigs);
      let g = await caro.getGame(1);
      expect(g.status).to.equal(1);
      expect(g.disputed).to.equal(true);
      expect(g.moveCount).to.equal(4);
      expect(g.turn).to.equal(1);
      expect(g.stateHash).to.equal(first.hash);
      await expect(caro.connect(alice).submitMoves(1, [], [], [])).to.be.revertedWith('Khong co nuoc di moi');

      let prevHash = first.hash;
      for (let i = 4; i < ROW_WIN.length; i++) {
        const m = await signMoves(caro, 1, [ROW_WIN[i]], [sessionA, sessionB], { from: i, prevHash });
        prevHash = m.hash;
        await caro.connect(i % 2 === 0 ? alice : bob).submitMoves(1, m.xs, m.ys, m.sigs);
      }
      g = await caro.getGame(1);
      expect(g.status).to.equal(2);
      expect(g.winner).to.equal(alice.address);
    });

    it('không thể nhận thắng do hết giờ khi ván còn đánh off-chain', async () => {
      const { caro, bob } = await loadFixture(playingFixture);
      await time.increase(60 * 60);
      await expect(caro.connect(bob).claimTimeout(1)).to.be.revertedWith(
        'Phai dua van len chain truoc khi nhan thang',
      );
    });

    it('đối thủ treo máy: đưa ván lên chain, quá 5 phút không đi thì nhận thắng', async () => {
      const { caro, alice, bob, sessionA, sessionB } = await loadFixture(playingFixture);
      const m = await signMoves(caro, 1, [[7, 7]], [sessionA, sessionB]);
      await caro.connect(alice).submitMoves(1, m.xs, m.ys, m.sigs);
      await expect(caro.connect(alice).claimTimeout(1)).to.be.revertedWith('Doi thu van con thoi gian');
      await time.increase(5 * 60 + 1);
      const late = await signMoves(caro, 1, [[8, 8]], [sessionA, sessionB], { from: 1, prevHash: m.hash });
      await expect(caro.connect(bob).submitMoves(1, late.xs, late.ys, late.sigs)).to.be.revertedWith(
        'Da het thoi gian di',
      );
      await expect(caro.connect(bob).claimTimeout(1)).to.be.revertedWith(
        'Chi doi thu cua nguoi het gio moi duoc nhan thang',
      );
      await expect(caro.connect(alice).claimTimeout(1)).to.emit(caro, 'GameEnded');
      expect((await caro.getGame(1)).winner).to.equal(alice.address);
    });

    it('bị đưa ván cũ lên chain: người còn lại gửi các nước mới hơn để chống lại', async () => {
      const { caro, alice, bob, sessionA, sessionB } = await loadFixture(playingFixture);
      // Off-chain đã có 5 nước, nước thứ 5 là của X nên đang chờ O.
      // O gian lận: chỉ đưa 4 nước đầu lên chain để giả như X chưa đi, rồi chờ X "hết giờ".
      const all = await signMoves(caro, 1, ROW_WIN.slice(0, 5), [sessionA, sessionB]);
      await caro.connect(bob).submitMoves(1, all.xs.slice(0, 4), all.ys.slice(0, 4), all.sigs.slice(0, 4));
      expect((await caro.getGame(1)).turn).to.equal(1); // trên chain: đang tính giờ cho X
      // X gửi nước thứ 5 đã ký từ trước: giờ chuyển sang O
      await caro.connect(alice).submitMoves(1, all.xs.slice(4), all.ys.slice(4), all.sigs.slice(4));
      const g = await caro.getGame(1);
      expect(g.moveCount).to.equal(5);
      expect(g.turn).to.equal(2);
      await time.increase(5 * 60 + 1);
      await expect(caro.connect(bob).claimTimeout(1)).to.be.revertedWith(
        'Chi doi thu cua nguoi het gio moi duoc nhan thang',
      );
      await caro.connect(alice).claimTimeout(1);
      expect((await caro.getGame(1)).winner).to.equal(alice.address);
    });
  });

  it('đầu hàng thì đối thủ thắng', async () => {
    const { caro, alice, bob } = await loadFixture(playingFixture);
    await caro.connect(alice).resign(1);
    expect((await caro.getGame(1)).winner).to.equal(bob.address);
  });

  it('getGames trả về danh sách phòng', async () => {
    const { caro, alice } = await loadFixture(playingFixture);
    await caro.connect(alice).createRoom(BET, ethers.ZeroAddress, { value: BET });
    const list = await caro.getGames(1, 10);
    expect(list.length).to.equal(2);
    expect(list[1].status).to.equal(0);
    expect((await caro.getGames(5, 10)).length).to.equal(0);
  });

  describe('Ví điện tử', () => {
    it('chuyển tiền giữa hai ví', async () => {
      const { caro, alice, bob } = await loadFixture(deployFixture);
      await caro.connect(alice).deposit({ value: BET * 2n });
      await expect(caro.connect(alice).transfer(bob.address, BET))
        .to.emit(caro, 'Transferred')
        .withArgs(alice.address, bob.address, BET);
      expect(await caro.balanceOf(alice.address)).to.equal(BET);
      expect(await caro.balanceOf(bob.address)).to.equal(BET);
      // Bob rút được tiền vừa nhận về MetaMask
      await expect(caro.connect(bob).withdraw(BET)).to.changeEtherBalance(bob, BET);
    });

    it('chặn chuyển tiền không hợp lệ', async () => {
      const { caro, alice, bob } = await loadFixture(deployFixture);
      await caro.connect(alice).deposit({ value: BET });
      await expect(caro.connect(alice).transfer(bob.address, BET + 1n)).to.be.revertedWith('So du khong du');
      await expect(caro.connect(alice).transfer(alice.address, 1)).to.be.revertedWith('Khong the chuyen cho chinh minh');
      await expect(caro.connect(alice).transfer(ethers.ZeroAddress, 1)).to.be.revertedWith(
        'Dia chi nguoi nhan khong hop le',
      );
      await expect(caro.connect(alice).transfer(bob.address, 0)).to.be.revertedWith('So tien chuyen phai lon hon 0');
    });

    it('ghi lịch sử nạp, chuyển, rút với số dư sau giao dịch', async () => {
      const { caro, alice, bob } = await loadFixture(deployFixture);
      await caro.connect(alice).deposit({ value: BET * 3n });
      await caro.connect(alice).transfer(bob.address, BET);
      await caro.connect(alice).withdraw(BET);

      expect(await caro.getHistoryCount(alice.address)).to.equal(3);
      const h = await caro.getHistory(alice.address, 0, 10);
      expect(h.map((t) => Number(t.txType))).to.deep.equal([0, 2, 1]); // Deposit, TransferOut, Withdraw
      expect(h.map((t) => t.balanceAfter)).to.deep.equal([BET * 3n, BET * 2n, BET]);
      expect(h[1].counterparty).to.equal(bob.address);
      expect(h[0].timestamp).to.be.greaterThan(0);

      const hb = await caro.getHistory(bob.address, 0, 10);
      expect(hb.length).to.equal(1);
      expect(Number(hb[0].txType)).to.equal(3); // TransferIn
      expect(hb[0].counterparty).to.equal(alice.address);

      // phân trang
      expect((await caro.getHistory(alice.address, 1, 1))[0].txType).to.equal(2);
      expect((await caro.getHistory(alice.address, 5, 10)).length).to.equal(0);
    });

    it('ghi lịch sử đặt cược, thắng, phí sàn và hoàn cược', async () => {
      const { caro, owner, alice, bob } = await loadFixture(playingFixture);
      await caro.connect(bob).resign(1);
      const ha = await caro.getHistory(alice.address, 0, 10);
      // createRoom gửi kèm ETH: Deposit rồi Bet; sau đó Win
      expect(ha.map((t) => Number(t.txType))).to.deep.equal([0, 4, 5]);
      expect(ha[1].gameId).to.equal(1);
      expect(ha[2].amount).to.equal((BET * 2n * 98n) / 100n);
      expect(ha[2].counterparty).to.equal(bob.address);
      const ho = await caro.getHistory(owner.address, 0, 10);
      expect(Number(ho[0].txType)).to.equal(7); // Fee

      await caro.connect(alice).createRoom(BET, ethers.ZeroAddress);
      await caro.connect(alice).cancelRoom(2);
      const last = await caro.getHistory(alice.address, 3, 10);
      expect(last.map((t) => Number(t.txType))).to.deep.equal([4, 6]); // Bet, Refund
    });
  });
});
