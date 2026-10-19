const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const BET = ethers.parseEther('0.05');

describe('CaroBetting', () => {
  async function deployFixture() {
    const [owner, alice, bob, eve] = await ethers.getSigners();
    const caro = await ethers.deployContract('CaroBetting');
    return { caro, owner, alice, bob, eve };
  }

  async function playingFixture() {
    const ctx = await deployFixture();
    const { caro, alice, bob } = ctx;
    await caro.connect(alice).createRoom(BET, { value: BET });
    await caro.connect(bob).joinRoom(1, { value: BET });
    return ctx;
  }

  it('nạp và rút tiền', async () => {
    const { caro, alice } = await loadFixture(deployFixture);
    await caro.connect(alice).deposit({ value: BET });
    expect(await caro.balances(alice.address)).to.equal(BET);
    await expect(caro.connect(alice).withdraw(BET)).to.changeEtherBalance(alice, BET);
    expect(await caro.balances(alice.address)).to.equal(0);
    await expect(caro.connect(alice).withdraw(1)).to.be.revertedWith('So du khong du');
  });

  it('tạo phòng trừ số dư, không đủ tiền thì revert', async () => {
    const { caro, alice } = await loadFixture(deployFixture);
    await expect(caro.connect(alice).createRoom(BET)).to.be.revertedWith('So du vi khong du de dat cuoc');
    await caro.connect(alice).deposit({ value: BET * 2n });
    await expect(caro.connect(alice).createRoom(BET)).to.emit(caro, 'RoomCreated').withArgs(1, alice.address, BET);
    expect(await caro.balances(alice.address)).to.equal(BET);
  });

  it('chủ phòng huỷ phòng được hoàn tiền', async () => {
    const { caro, alice, bob } = await loadFixture(deployFixture);
    await caro.connect(alice).createRoom(BET, { value: BET });
    await expect(caro.connect(bob).cancelRoom(1)).to.be.revertedWith('Chi chu phong duoc huy');
    await caro.connect(alice).cancelRoom(1);
    expect(await caro.balances(alice.address)).to.equal(BET);
    await expect(caro.connect(bob).joinRoom(1, { value: BET })).to.be.revertedWith('Phong da du nguoi hoac da dong');
  });

  it('không thể tự vào phòng mình hoặc vào phòng đã đủ người', async () => {
    const { caro, alice, eve } = await loadFixture(playingFixture);
    await expect(caro.connect(eve).joinRoom(1, { value: BET })).to.be.revertedWith('Phong da du nguoi hoac da dong');
    await caro.connect(alice).createRoom(BET, { value: BET });
    await expect(caro.connect(alice).joinRoom(2)).to.be.revertedWith('Khong the tu choi voi chinh minh');
  });

  it('kiểm tra lượt và ô trống', async () => {
    const { caro, alice, bob, eve } = await loadFixture(playingFixture);
    await expect(caro.connect(bob).makeMove(1, 7, 7)).to.be.revertedWith('Chua den luot ban');
    await expect(caro.connect(eve).makeMove(1, 7, 7)).to.be.revertedWith('Chua den luot ban');
    await caro.connect(alice).makeMove(1, 7, 7);
    await expect(caro.connect(bob).makeMove(1, 7, 7)).to.be.revertedWith('O nay da co quan');
    await expect(caro.connect(bob).makeMove(1, 15, 0)).to.be.revertedWith('Toa do ngoai ban co');
  });

  it('5 quân hàng ngang thì thắng, nhận thưởng trừ 2% phí', async () => {
    const { caro, owner, alice, bob } = await loadFixture(playingFixture);
    for (let i = 0; i < 4; i++) {
      await caro.connect(alice).makeMove(1, i, 0);
      await caro.connect(bob).makeMove(1, i, 1);
    }
    const reward = (BET * 2n * 98n) / 100n;
    await expect(caro.connect(alice).makeMove(1, 4, 0))
      .to.emit(caro, 'GameEnded')
      .withArgs(1, alice.address, reward, 'five-in-a-row');
    const g = await caro.getGame(1);
    expect(g.winner).to.equal(alice.address);
    expect(g.status).to.equal(2);
    expect(await caro.balances(alice.address)).to.equal(reward);
    expect(await caro.balances(owner.address)).to.equal(BET * 2n - reward);
    await expect(caro.connect(bob).makeMove(1, 9, 9)).to.be.revertedWith('Tran dau khong dien ra');
  });

  it('5 quân đường chéo ngược, nước cuối đặt giữa hàng', async () => {
    const { caro, alice, bob } = await loadFixture(playingFixture);
    // X tại (4,10),(5,9),(7,7),(8,6) rồi chốt ở (6,8)
    const xs = [[4, 10], [5, 9], [7, 7], [8, 6]];
    for (let i = 0; i < xs.length; i++) {
      await caro.connect(alice).makeMove(1, ...xs[i]);
      await caro.connect(bob).makeMove(1, i, 0);
    }
    await caro.connect(alice).makeMove(1, 6, 8);
    expect((await caro.getGame(1)).winner).to.equal(alice.address);
  });

  it('4 quân chưa thắng', async () => {
    const { caro, alice, bob } = await loadFixture(playingFixture);
    for (let i = 0; i < 4; i++) {
      await caro.connect(alice).makeMove(1, 0, i);
      await caro.connect(bob).makeMove(1, 5, i);
    }
    expect((await caro.getGame(1)).status).to.equal(1);
  });

  it('đối thủ hết giờ thì người kia nhận thắng', async () => {
    const { caro, alice, bob } = await loadFixture(playingFixture);
    await caro.connect(alice).makeMove(1, 7, 7);
    await expect(caro.connect(alice).claimTimeout(1)).to.be.revertedWith('Doi thu van con thoi gian');
    await time.increase(5 * 60 + 1);
    await expect(caro.connect(bob).makeMove(1, 8, 8)).to.be.revertedWith('Da het thoi gian di');
    await expect(caro.connect(bob).claimTimeout(1)).to.be.revertedWith(
      'Chi doi thu cua nguoi het gio moi duoc nhan thang',
    );
    await expect(caro.connect(alice).claimTimeout(1)).to.emit(caro, 'GameEnded');
    expect((await caro.getGame(1)).winner).to.equal(alice.address);
  });

  it('đầu hàng thì đối thủ thắng', async () => {
    const { caro, alice, bob } = await loadFixture(playingFixture);
    await caro.connect(alice).resign(1);
    expect((await caro.getGame(1)).winner).to.equal(bob.address);
  });

  it('getGames trả về danh sách phòng', async () => {
    const { caro, alice } = await loadFixture(playingFixture);
    await caro.connect(alice).createRoom(BET, { value: BET });
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

      await caro.connect(alice).createRoom(BET);
      await caro.connect(alice).cancelRoom(2);
      const last = await caro.getHistory(alice.address, 3, 10);
      expect(last.map((t) => Number(t.txType))).to.deep.equal([4, 6]); // Bet, Refund
    });
  });
});
