const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function main() {
  const contract = await hre.ethers.deployContract('CaroBetting');
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  console.log(`CaroBetting deployed tại ${address} (chainId ${chainId})`);

  // Ghi địa chỉ + ABI cho frontend dùng
  const artifact = await hre.artifacts.readArtifact('CaroBetting');
  const outDir = path.join(__dirname, '..', '..', 'frontend', 'src', 'contracts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'CaroBetting.json'),
    JSON.stringify({ address, chainId: Number(chainId), abi: artifact.abi }, null, 2),
  );
  console.log(`Đã ghi ${path.relative(process.cwd(), path.join(outDir, 'CaroBetting.json'))}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
