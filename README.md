Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# CredLink prototype

CredLink is a hypothetical shared register for educational credentials. Issuers (universities, training providers) record only **hashes** of credentials in a smart contract; employers verify a hash and pay a small fee in a hypothetical test token (CLT). No personal data is ever stored on-chain, and all data in this repository is fictitious.

- **Demo video (up to 3 min):** [DEMO VIDEO LINK]
- **Testnet contract address:** Not deployed to any public network. The prototype runs on the local Hardhat network only.

## What the prototype does

| Contract | Purpose |
|---|---|
| `contracts/CredLink.sol` | Issuer registry with deposits, credential and batch (Merkle root) recording, revocation, verification, fee payment (30% burned / 70% treasury), slashing, pause |
| `contracts/CLTTestToken.sol` | Hypothetical ERC-20 test token with an open `mint` for test accounts (never real) |
| `contracts/mocks/ReentrantToken.sol` | Test-only malicious token used to prove the reentrancy protection |

Main use case: governance registers an issuer → issuer locks a deposit → issuer records a credential hash → verifier checks it (`verifyCredential`, free read) and pays the fee → issuer can revoke it.

## How to run (local network only)

Requires Node.js 18+ and internet access once, to download the packages.

```bash
npm install
npx hardhat test                    # runs the unit tests
npx hardhat run scripts/demo.js     # step-by-step demo used in the video
```

Both commands start a temporary in-process Hardhat network with test accounts created by the tool. No wallet, key or `.env` file is needed.

## Roles

| Role | Held by | Can |
|---|---|---|
| `GOVERNANCE_ROLE` (= `DEFAULT_ADMIN_ROLE`) | Network governance (a 2-of-3 multisig in a real deployment) | register / reinstate issuers, slash deposits, set the fee, manage roles |
| `ISSUER_ROLE` | Registered institutions | stake / withdraw own deposit, issue credentials and batches (with enough deposit, not suspended), revoke **own** credentials |
| `PAUSER_ROLE` | Governance or an emergency account | pause / unpause (nothing else) |
| Anyone | Verifiers | read `verifyCredential` / `verifyProof`, pay the verification fee |

## Security notes

- **Reentrancy:** `stakeDeposit`, `withdrawDeposit`, `slashDeposit` and `payVerificationFee` use OpenZeppelin `ReentrancyGuard`, follow checks-effects-interactions and use `SafeERC20`. Two tests attack the contract with a malicious token.
- **Access control:** role-based via OpenZeppelin `AccessControl`; an issuer can revoke only the credentials it issued.
- **Key loss/theft:** governance and pauser keys must be multisig/hardware-protected in a real deployment; here only test accounts exist.
- **Known limits of the prototype:** the fee is fixed and the token is a simple test token; a Merkle leaf must be a hash of a document (not a raw 64-byte pair) to avoid second-preimage confusion; deposits can be withdrawn while old credentials stay valid; no external audit has been done.
- Never commit a private key or seed phrase. `.env` is listed in `.gitignore`.

## Credits and licence

Built on [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5 (MIT licence). This project is also released under the MIT licence (see `LICENSE`).

## AI disclosure

Claude Sonnet 5.5 (Anthropic) helped draft the contract, mock, tests and scripts. The design decisions are the team's, and every team member must be able to explain the code.
