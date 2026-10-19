const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const NETWORK_LABELS = { localhost: 'Hardhat Local', ganache: 'Ganache Local' };

async function main() {
  const contract = await hre.ethers.deployContract('CaroBetting');
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const network = hre.network.name;
  console.log(`CaroBetting deployed tại ${address} trên ${network} (chainId ${chainId})`);

  // Ghi địa chỉ + ABI + RPC cho frontend (gọi contract) và backend (đồng bộ bảng xếp hạng)
  const artifact = await hre.artifacts.readArtifact('CaroBetting');
  const json = JSON.stringify(
    {
      address,
      chainId: Number(chainId),
      network,
      networkLabel: NETWORK_LABELS[network] || network,
      rpcUrl: hre.network.config.url || 'http://127.0.0.1:8545',
      abi: artifact.abi,
    },
    null,
    2,
  );
  for (const app of ['frontend', 'backend']) {
    const outDir = path.join(__dirname, '..', '..', app, 'src', 'contracts');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'CaroBetting.json'), json);
    console.log(`Đã ghi ${path.relative(process.cwd(), path.join(outDir, 'CaroBetting.json'))}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
