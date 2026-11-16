# CredLink contract interface and tests (for the report appendix)

Solidity ^0.8.24, OpenZeppelin Contracts v5 (AccessControl, Pausable, ReentrancyGuard, MerkleProof, SafeERC20).

## Roles
- `GOVERNANCE_ROLE` (= `DEFAULT_ADMIN_ROLE`, 0x00): governance (2-of-3 multisig in production)
- `ISSUER_ROLE`: registered issuers
- `PAUSER_ROLE`: emergency pause only

## Enum
`Status { NotFound, Valid, Revoked, Expired }`

## Functions
| Function | Access | Description |
|---|---|---|
| `constructor(IERC20 token_, address treasury_, address admin_, uint256 fee_)` | deploy | sets token, treasury, fee; grants governance and pauser to admin |
| `registerIssuer(address issuer, bytes32 nameHash, uint8 trustLevel, uint256 requiredDeposit)` | governance | registers an issuer (trust 1-3) and grants ISSUER_ROLE |
| `reinstateIssuer(address issuer)` | governance | lifts a suspension |
| `slashDeposit(address issuer, uint256 amount)` | governance, nonReentrant | takes part of the deposit to the treasury, suspends the issuer, trust level -1 |
| `setVerificationFee(uint256 newFee)` | governance | changes the fee |
| `pause()` / `unpause()` | pauser | emergency stop |
| `stakeDeposit(uint256 amount)` | issuer, nonReentrant, not paused | locks CLT as a deposit |
| `withdrawDeposit()` | issuer, nonReentrant, not suspended | returns the whole deposit |
| `issueCredential(bytes32 hash, uint64 expiry)` | issuer, not paused | records a credential hash (expiry 0 = never) |
| `issueBatch(bytes32 merkleRoot, uint64 expiry)` | issuer, not paused | records a batch Merkle root |
| `revokeCredential(bytes32 hash)` | issuing issuer only | marks as revoked |
| `verifyCredential(bytes32 hash) view returns (Status, address issuer, uint8 trustLevel)` | anyone | free check |
| `verifyProof(bytes32 leaf, bytes32[] proof, bytes32 root) view returns (Status, address, uint8)` | anyone | checks a credential inside a batch |
| `payVerificationFee(bytes32 hash)` | anyone, nonReentrant, not paused | pays the fee: 30% burned, 70% to treasury |
| `depositOf(address issuer) view returns (uint256)` | anyone | issuer deposit |

## Events
`IssuerRegistered`, `IssuerReinstated`, `DepositStaked`, `DepositWithdrawn`, `DepositSlashed`, `CredentialIssued`, `CredentialRevoked`, `VerificationFeePaid`, `VerificationFeeChanged`

## Custom errors
`ZeroAddress`, `ZeroAmount`, `ZeroHash`, `InvalidTrustLevel`, `IssuerAlreadyRegistered`, `IssuerNotRegistered`, `IssuerSuspended`, `InsufficientDeposit`, `CredentialAlreadyExists`, `CredentialNotFound`, `NotCredentialIssuer`, `AlreadyRevoked`, `InvalidExpiry`, `SlashExceedsDeposit`, `NothingToWithdraw` (plus OpenZeppelin `AccessControlUnauthorizedAccount`, `EnforcedPause`, `ReentrancyGuardReentrantCall`)

## Unit tests (test/CredLink.test.js, 13 tests)
1. only governance can register an issuer
2. issuing without a sufficient deposit reverts
3. issues a credential and verifies it as Valid
4. the issuing issuer can revoke a credential
5. another issuer cannot revoke it (broken access control is blocked)
6. a credential becomes Expired after its expiry time
7. a batch root verifies a member credential by Merkle proof and rejects a forged leaf
8. verification fee is split 30% burned and 70% to treasury
9. slashing reduces the deposit, suspends the issuer and blocks issuing and withdrawal
10. stakeDeposit resists reentrancy from a malicious token
11. withdrawDeposit resists reentrancy from a malicious token
12. pause blocks issuing and fee payment; only the pauser can pause; unpause restores
13. an issuer can withdraw its deposit once, and duplicates are rejected

Test status: NOT executed in the authoring environment (no network, no Solidity toolchain). Run `npx hardhat test` locally and paste the real output into Appendix D.
