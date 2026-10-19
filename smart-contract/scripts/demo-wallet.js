// Demo các chức năng ví điện tử trên contract đã deploy (đọc địa chỉ từ frontend/src/contracts/CaroBetting.json).
//   npm run demo:ganache   (hoặc: npx hardhat run scripts/demo-wallet.js --network localhost)
const path = require('path');
const hre = require('hardhat');

const { ethers } = hre;
const TX_TYPES = ['Nạp tiền', 'Rút tiền', 'Chuyển đi', 'Nhận tiền', 'Đặt cược', 'Thắng cược', 'Hoàn cược', 'Phí sàn'];
const eth = (wei) => `${ethers.formatEther(wei)} ETH`;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Lý do revert: Ganache trả về dữ liệu Error(string) thô thay vì err.reason. */
function revertReason(err) {
  if (err.reason) return err.reason;
  const data = err.data || err.error?.data;
  if (typeof data === 'string' && data.startsWith('0x08c379a0')) {
    return ethers.AbiCoder.defaultAbiCoder().decode(['string'], `0x${data.slice(10)}`)[0];
  }
  return /revert (.+)$/.exec(err.message || '')?.[1] || err.shortMessage || err.message;
}

async function showTx(label, txPromise, caro) {
  const tx = await txPromise;
  const r = await tx.wait();
  console.log(`  ✔ ${label}`);
  console.log(`    tx hash : ${r.hash}`);
  console.log(`    block   : #${r.blockNumber}   gas: ${r.gasUsed}`);
  for (const log of r.logs) {
    const ev = caro.interface.parseLog(log);
    if (ev) console.log(`    event   : ${ev.name}(${ev.args.map((a) => (typeof a === 'bigint' ? eth(a) : a)).join(', ')})`);
  }
}

async function balances(caro, users) {
  for (const [name, u] of users) {
    const inWallet = await caro.balanceOf(u.address);
    const onChain = await ethers.provider.getBalance(u.address);
    console.log(`    ${name.padEnd(5)} ${short(u.address)}  ví game: ${eth(inWallet).padEnd(16)} MetaMask: ${Number(ethers.formatEther(onChain)).toFixed(4)} ETH`);
  }
}

async function main() {
  const deployment = require(path.join(__dirname, '..', '..', 'frontend', 'src', 'contracts', 'CaroBetting.json'));
  const [, alice, bob] = await ethers.getSigners();
  const caro = await ethers.getContractAt('CaroBetting', deployment.address);
  const net = await ethers.provider.getNetwork();
  const users = [['Alice', alice], ['Bob', bob]];

  console.log(`\n=== DEMO VÍ ĐIỆN TỬ — contract ${deployment.address} trên ${hre.network.name} (chainId ${net.chainId}) ===\n`);

  console.log('0) Số dư ban đầu');
  await balances(caro, users);

  console.log('\n1) NẠP: Alice nạp 1 ETH từ MetaMask vào ví — deposit()');
  await showTx('deposit 1 ETH', caro.connect(alice).deposit({ value: ethers.parseEther('1') }), caro);

  console.log('\n2) KIỂM TRA SỐ DƯ — balanceOf()');
  await balances(caro, users);

  console.log('\n3) CHUYỂN: Alice chuyển 0.3 ETH cho Bob — transfer()');
  await showTx('transfer 0.3 ETH', caro.connect(alice).transfer(bob.address, ethers.parseEther('0.3')), caro);
  await balances(caro, users);

  console.log('\n4) RÚT: Bob rút 0.1 ETH về MetaMask — withdraw()');
  await showTx('withdraw 0.1 ETH', caro.connect(bob).withdraw(ethers.parseEther('0.1')), caro);
  await balances(caro, users);

  console.log('\n5) CHẶN GIAO DỊCH SAI (contract revert, không mất tiền)');
  for (const [label, fn] of [
    ['Bob rút 100 ETH (quá số dư)', () => caro.connect(bob).withdraw.staticCall(ethers.parseEther('100'))],
    ['Alice chuyển cho chính mình', () => caro.connect(alice).transfer.staticCall(alice.address, 1n)],
    ['Alice chuyển tới địa chỉ 0x0', () => caro.connect(alice).transfer.staticCall(ethers.ZeroAddress, 1n)],
  ]) {
    try {
      await fn();
      console.log(`  ✗ ${label}: KHÔNG bị chặn`);
    } catch (err) {
      console.log(`  ✔ ${label}: bị chặn — "${revertReason(err)}"`);
    }
  }

  console.log('\n6) LỊCH SỬ GIAO DỊCH lưu trên blockchain — getHistoryCount() / getHistory()');
  for (const [name, u] of users) {
    const count = await caro.getHistoryCount(u.address);
    const list = await caro.getHistory(u.address, count > 5n ? count - 5n : 0n, 5);
    console.log(`  ${name} (${count} giao dịch, hiện tối đa 5 gần nhất):`);
    for (const t of list) {
      const who = t.counterparty === ethers.ZeroAddress ? '' : `  đối ứng ${short(t.counterparty)}`;
      const time = new Date(Number(t.timestamp) * 1000).toLocaleString('vi-VN');
      console.log(`    - ${TX_TYPES[Number(t.txType)].padEnd(10)} ${eth(t.amount).padEnd(12)} số dư sau: ${eth(t.balanceAfter).padEnd(12)} ${time}${who}`);
    }
  }
  console.log('\n=== HOÀN TẤT ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
