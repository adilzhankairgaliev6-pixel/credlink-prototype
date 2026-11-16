// Educational project. All data below is fictitious; no real people, no real funds.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const GOVERNANCE_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
const ISSUER_ROLE = ethers.id("ISSUER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

const Status = { NotFound: 0n, Valid: 1n, Revoked: 2n, Expired: 3n };
const tokens = (n) => ethers.parseUnits(String(n), 18);
const FEE = tokens(570); // 570 CLT per check -> 171 burned, 399 to treasury
const REQUIRED_DEPOSIT = tokens(1000);
const h = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

// Sorted-pair Merkle tree helper (same convention as OpenZeppelin MerkleProof).
const hashPair = (a, b) =>
  BigInt(a) < BigInt(b)
    ? ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [a, b])
    : ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [b, a]);

async function deployFixture() {
  const [admin, issuer, issuer2, verifier, treasury, outsider] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory("CLTTestToken")).deploy();
  const credlink = await (
    await ethers.getContractFactory("CredLink")
  ).deploy(await token.getAddress(), treasury.address, admin.address, FEE);

  // fictitious issuers: trust level 3 = accredited university, 1 = private provider
  await credlink.registerIssuer(issuer.address, h("Fictitious University"), 3, REQUIRED_DEPOSIT);
  await credlink.registerIssuer(issuer2.address, h("Fictitious IT School"), 1, REQUIRED_DEPOSIT);

  for (const s of [issuer, issuer2]) {
    await token.mint(s.address, tokens(5000));
  }
  await token.mint(verifier.address, tokens(5000));

  return { token, credlink, admin, issuer, issuer2, verifier, treasury, outsider };
}

async function stakedFixture() {
  const ctx = await deployFixture();
  const { token, credlink, issuer, issuer2 } = ctx;
  for (const s of [issuer, issuer2]) {
    await token.connect(s).approve(await credlink.getAddress(), REQUIRED_DEPOSIT);
    await credlink.connect(s).stakeDeposit(REQUIRED_DEPOSIT);
  }
  return ctx;
}

describe("CredLink (educational prototype)", function () {
  it("only governance can register an issuer", async function () {
    const { credlink, outsider } = await loadFixture(deployFixture);
    await expect(
      credlink.connect(outsider).registerIssuer(outsider.address, h("x"), 2, REQUIRED_DEPOSIT)
    )
      .to.be.revertedWithCustomError(credlink, "AccessControlUnauthorizedAccount")
      .withArgs(outsider.address, GOVERNANCE_ROLE);
  });

  it("issuing without a sufficient deposit reverts", async function () {
    const { credlink, issuer } = await loadFixture(deployFixture);
    await expect(credlink.connect(issuer).issueCredential(h("diploma-0001"), 0))
      .to.be.revertedWithCustomError(credlink, "InsufficientDeposit")
      .withArgs(REQUIRED_DEPOSIT, 0n);
  });

  it("issues a credential and verifies it as Valid", async function () {
    const { credlink, issuer } = await loadFixture(stakedFixture);
    const hash = h("diploma-0001");
    await expect(credlink.connect(issuer).issueCredential(hash, 0))
      .to.emit(credlink, "CredentialIssued")
      .withArgs(issuer.address, hash, 0n, false);

    const [status, by, trust] = await credlink.verifyCredential(hash);
    expect(status).to.equal(Status.Valid);
    expect(by).to.equal(issuer.address);
    expect(trust).to.equal(3n);

    const [unknownStatus] = await credlink.verifyCredential(h("never-issued"));
    expect(unknownStatus).to.equal(Status.NotFound);
  });

  it("the issuing issuer can revoke a credential", async function () {
    const { credlink, issuer } = await loadFixture(stakedFixture);
    const hash = h("diploma-0002");
    await credlink.connect(issuer).issueCredential(hash, 0);
    await expect(credlink.connect(issuer).revokeCredential(hash))
      .to.emit(credlink, "CredentialRevoked")
      .withArgs(issuer.address, hash);
    const [status] = await credlink.verifyCredential(hash);
    expect(status).to.equal(Status.Revoked);
  });

  it("another issuer cannot revoke it (broken access control is blocked)", async function () {
    const { credlink, issuer, issuer2, outsider } = await loadFixture(stakedFixture);
    const hash = h("diploma-0003");
    await credlink.connect(issuer).issueCredential(hash, 0);

    await expect(credlink.connect(issuer2).revokeCredential(hash))
      .to.be.revertedWithCustomError(credlink, "NotCredentialIssuer")
      .withArgs(hash, issuer2.address);

    await expect(credlink.connect(outsider).revokeCredential(hash))
      .to.be.revertedWithCustomError(credlink, "AccessControlUnauthorizedAccount")
      .withArgs(outsider.address, ISSUER_ROLE);

    const [status] = await credlink.verifyCredential(hash);
    expect(status).to.equal(Status.Valid);
  });

  it("a credential becomes Expired after its expiry time", async function () {
    const { credlink, issuer } = await loadFixture(stakedFixture);
    const hash = h("certificate-0004");
    const expiry = (await time.latest()) + 3600;
    await credlink.connect(issuer).issueCredential(hash, expiry);
    expect((await credlink.verifyCredential(hash))[0]).to.equal(Status.Valid);

    await time.increase(3601);
    expect((await credlink.verifyCredential(hash))[0]).to.equal(Status.Expired);

    // an expiry in the past is rejected at issuing time
    await expect(credlink.connect(issuer).issueCredential(h("certificate-0005"), expiry))
      .to.be.revertedWithCustomError(credlink, "InvalidExpiry")
      .withArgs(expiry);
  });

  it("a batch root verifies a member credential by Merkle proof and rejects a forged leaf", async function () {
    const { credlink, issuer } = await loadFixture(stakedFixture);
    const leaves = ["batch-1", "batch-2", "batch-3", "batch-4"].map(h);
    const n01 = hashPair(leaves[0], leaves[1]);
    const n23 = hashPair(leaves[2], leaves[3]);
    const root = hashPair(n01, n23);

    await credlink.connect(issuer).issueBatch(root, 0);

    // proof for leaf 2 (third credential) = [leaf3, n01]
    const proof = [leaves[3], n01];
    const [status, by] = await credlink.verifyProof(leaves[2], proof, root);
    expect(status).to.equal(Status.Valid);
    expect(by).to.equal(issuer.address);

    const [forged] = await credlink.verifyProof(h("forged-credential"), proof, root);
    expect(forged).to.equal(Status.NotFound);

    // a root that was never recorded as a batch is not accepted either
    const [noBatch] = await credlink.verifyProof(leaves[2], proof, h("unknown-root"));
    expect(noBatch).to.equal(Status.NotFound);
  });

  it("verification fee is split 30% burned and 70% to treasury", async function () {
    const { token, credlink, issuer, verifier, treasury } = await loadFixture(stakedFixture);
    const hash = h("diploma-0006");
    await credlink.connect(issuer).issueCredential(hash, 0);

    await token.connect(verifier).approve(await credlink.getAddress(), FEE);
    const supplyBefore = await token.totalSupply();
    const verifierBefore = await token.balanceOf(verifier.address);

    await expect(credlink.connect(verifier).payVerificationFee(hash))
      .to.emit(credlink, "VerificationFeePaid")
      .withArgs(verifier.address, hash, FEE, tokens(171), tokens(399));

    expect(await token.balanceOf(treasury.address)).to.equal(tokens(399));
    expect(supplyBefore - (await token.totalSupply())).to.equal(tokens(171)); // burned
    expect(verifierBefore - (await token.balanceOf(verifier.address))).to.equal(FEE);
    // the contract keeps only the issuers' deposits
    expect(await token.balanceOf(await credlink.getAddress())).to.equal(REQUIRED_DEPOSIT * 2n);

    // a fee cannot be paid for an unknown credential
    await expect(credlink.connect(verifier).payVerificationFee(h("nope")))
      .to.be.revertedWithCustomError(credlink, "CredentialNotFound");
  });

  it("slashing reduces the deposit, suspends the issuer and blocks issuing and withdrawal", async function () {
    const { token, credlink, admin, issuer, treasury, outsider } = await loadFixture(stakedFixture);
    const slash = tokens(400);

    await expect(credlink.connect(outsider).slashDeposit(issuer.address, slash))
      .to.be.revertedWithCustomError(credlink, "AccessControlUnauthorizedAccount");

    await expect(credlink.connect(admin).slashDeposit(issuer.address, slash))
      .to.emit(credlink, "DepositSlashed")
      .withArgs(issuer.address, slash, 2n); // trust level 3 -> 2

    expect(await credlink.depositOf(issuer.address)).to.equal(REQUIRED_DEPOSIT - slash);
    expect(await token.balanceOf(treasury.address)).to.equal(slash);

    await expect(credlink.connect(issuer).issueCredential(h("diploma-0007"), 0))
      .to.be.revertedWithCustomError(credlink, "IssuerSuspended")
      .withArgs(issuer.address);
    await expect(credlink.connect(issuer).withdrawDeposit())
      .to.be.revertedWithCustomError(credlink, "IssuerSuspended");

    await expect(credlink.connect(admin).slashDeposit(issuer.address, REQUIRED_DEPOSIT))
      .to.be.revertedWithCustomError(credlink, "SlashExceedsDeposit");
  });

  it("stakeDeposit resists reentrancy from a malicious token", async function () {
    const [admin, , , , treasury] = await ethers.getSigners();
    const mock = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    const credlink = await (
      await ethers.getContractFactory("CredLink")
    ).deploy(await mock.getAddress(), treasury.address, admin.address, FEE);

    // the mock acts as an issuer account itself
    await credlink.registerIssuer(await mock.getAddress(), h("Mock Issuer"), 1, tokens(100));
    await mock.mint(await mock.getAddress(), tokens(1000));
    await mock.approveFrom(await credlink.getAddress(), tokens(1000));
    await mock.setAttack(await credlink.getAddress(), 1);

    await mock.callTarget(credlink.interface.encodeFunctionData("stakeDeposit", [tokens(500)]));

    expect(await mock.reentryAttempted()).to.equal(true);
    expect(await mock.reentrySucceeded()).to.equal(false);
    const guardSelector = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);
    expect((await mock.lastRevertData()).slice(0, 10)).to.equal(guardSelector);

    // accounting stays correct: exactly one stake was recorded
    expect(await credlink.depositOf(await mock.getAddress())).to.equal(tokens(500));
    expect(await mock.balanceOf(await credlink.getAddress())).to.equal(tokens(500));
  });

  it("withdrawDeposit resists reentrancy from a malicious token", async function () {
    const [admin, , , , treasury] = await ethers.getSigners();
    const mock = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    const credlink = await (
      await ethers.getContractFactory("CredLink")
    ).deploy(await mock.getAddress(), treasury.address, admin.address, FEE);
    const mockAddr = await mock.getAddress();
    const credAddr = await credlink.getAddress();

    await credlink.registerIssuer(mockAddr, h("Mock Issuer"), 1, tokens(100));
    await mock.mint(mockAddr, tokens(1000));
    await mock.approveFrom(credAddr, tokens(1000));
    await mock.setAttack(credAddr, 0); // no attack while staking
    await mock.callTarget(credlink.interface.encodeFunctionData("stakeDeposit", [tokens(500)]));

    await mock.setAttack(credAddr, 2); // attack on transfer during withdrawal
    await mock.callTarget(credlink.interface.encodeFunctionData("withdrawDeposit", []));

    expect(await mock.reentryAttempted()).to.equal(true);
    expect(await mock.reentrySucceeded()).to.equal(false);
    const guardSelector = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);
    expect((await mock.lastRevertData()).slice(0, 10)).to.equal(guardSelector);

    // the deposit was paid out exactly once
    expect(await credlink.depositOf(mockAddr)).to.equal(0n);
    expect(await mock.balanceOf(credAddr)).to.equal(0n);
    expect(await mock.balanceOf(mockAddr)).to.equal(tokens(1000));
  });

  it("pause blocks issuing and fee payment; only the pauser can pause; unpause restores", async function () {
    const { token, credlink, admin, issuer, verifier, outsider } = await loadFixture(stakedFixture);
    const hash = h("diploma-0008");
    await credlink.connect(issuer).issueCredential(hash, 0);

    await expect(credlink.connect(outsider).pause())
      .to.be.revertedWithCustomError(credlink, "AccessControlUnauthorizedAccount")
      .withArgs(outsider.address, PAUSER_ROLE);

    await credlink.connect(admin).pause();
    await expect(credlink.connect(issuer).issueCredential(h("diploma-0009"), 0))
      .to.be.revertedWithCustomError(credlink, "EnforcedPause");
    await token.connect(verifier).approve(await credlink.getAddress(), FEE);
    await expect(credlink.connect(verifier).payVerificationFee(hash))
      .to.be.revertedWithCustomError(credlink, "EnforcedPause");
    // read-only verification still works while paused
    expect((await credlink.verifyCredential(hash))[0]).to.equal(Status.Valid);

    await credlink.connect(admin).unpause();
    await credlink.connect(issuer).issueCredential(h("diploma-0009"), 0);
    expect((await credlink.verifyCredential(h("diploma-0009")))[0]).to.equal(Status.Valid);
  });

  it("an issuer can withdraw its deposit once, and duplicates are rejected", async function () {
    const { token, credlink, issuer } = await loadFixture(stakedFixture);
    const hash = h("diploma-0010");
    await credlink.connect(issuer).issueCredential(hash, 0);
    await expect(credlink.connect(issuer).issueCredential(hash, 0))
      .to.be.revertedWithCustomError(credlink, "CredentialAlreadyExists")
      .withArgs(hash);

    const before = await token.balanceOf(issuer.address);
    await credlink.connect(issuer).withdrawDeposit();
    expect((await token.balanceOf(issuer.address)) - before).to.equal(REQUIRED_DEPOSIT);
    await expect(credlink.connect(issuer).withdrawDeposit())
      .to.be.revertedWithCustomError(credlink, "NothingToWithdraw");
  });
});
