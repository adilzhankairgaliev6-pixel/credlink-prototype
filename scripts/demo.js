// Demo for the 3-minute video. Runs on the in-process Hardhat network with test accounts only.
// All data is fictitious. Run: npx hardhat run scripts/demo.js
const { ethers } = require("hardhat");

const tokens = (n) => ethers.parseUnits(String(n), 18);
const fmt = (n) => ethers.formatUnits(n, 18);
const STATUS = ["NotFound", "Valid", "Revoked", "Expired"];
const step = (n, text) => console.log(`\n=== Step ${n}: ${text}`);

async function main() {
  console.log("CredLink prototype demo (educational project, local network, test accounts only)");
  const [governance, university, employer, treasury] = await ethers.getSigners();

  step(1, "Deploy the hypothetical CLT test token and the CredLink contract");
  const token = await (await ethers.getContractFactory("CLTTestToken")).deploy();
  const fee = tokens(570);
  const credlink = await (
    await ethers.getContractFactory("CredLink")
  ).deploy(await token.getAddress(), treasury.address, governance.address, fee);
  console.log("CLT token:   ", await token.getAddress());
  console.log("CredLink:    ", await credlink.getAddress());
  console.log("Fee per check:", fmt(fee), "CLT (30% burned, 70% to treasury)");

  step(2, "Governance registers a fictitious university (trust level 3, deposit 1000 CLT)");
  const required = tokens(1000);
  await credlink.registerIssuer(
    university.address,
    ethers.id("Fictitious University"),
    3,
    required
  );
  console.log("Issuer registered:", university.address);

  step(3, "The university locks its deposit");
  await token.mint(university.address, tokens(2000)); // test tokens only
  await token.connect(university).approve(await credlink.getAddress(), required);
  await credlink.connect(university).stakeDeposit(required);
  console.log("Deposit:", fmt(await credlink.depositOf(university.address)), "CLT");

  step(4, "The university records the hash of a fictitious diploma (no personal data on-chain)");
  const hash = ethers.id("fictitious-diploma-0001");
  await credlink.connect(university).issueCredential(hash, 0);
  console.log("Recorded hash:", hash);

  step(5, "An employer verifies it (read-only call, free)");
  let [status, by, trust] = await credlink.verifyCredential(hash);
  console.log(`Result: ${STATUS[Number(status)]}, issuer ${by}, trust level ${trust}`);

  step(6, "The employer pays the verification fee");
  await token.mint(employer.address, tokens(1000)); // test tokens only
  await token.connect(employer).approve(await credlink.getAddress(), fee);
  const supplyBefore = await token.totalSupply();
  await credlink.connect(employer).payVerificationFee(hash);
  console.log("Burned:   ", fmt(supplyBefore - (await token.totalSupply())), "CLT");
  console.log("Treasury: ", fmt(await token.balanceOf(treasury.address)), "CLT");

  step(7, "The university revokes the credential");
  await credlink.connect(university).revokeCredential(hash);
  [status] = await credlink.verifyCredential(hash);
  console.log("Result after revocation:", STATUS[Number(status)]);

  step(8, "An unknown hash is not found");
  [status] = await credlink.verifyCredential(ethers.id("forged-diploma"));
  console.log("Result for a forged hash:", STATUS[Number(status)]);

  console.log("\nDemo finished. Run `npx hardhat test` to see the unit tests pass.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
