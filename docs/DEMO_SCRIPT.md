# Demo video script (up to 3 minutes)

Educational project. Local Hardhat network, test accounts only. Never show a `.env` file, a private key, a seed phrase or personal data.
Record the screen (terminal + editor) and speak over it, or add captions.

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | README first line, then `npm install` already done | "CredLink is an educational prototype: a shared register of credential hashes. Everything runs on a local Hardhat network with test accounts." |
| 0:15–0:35 | `npx hardhat run scripts/demo.js`, step 1 | "We deploy the test token and the CredLink contract. The fee is 570 test tokens, 30% burned." |
| 0:35–1:00 | steps 2–3 | "Governance registers a fictitious university and the university locks its deposit." |
| 1:00–1:25 | step 4 | "The university records only the hash of a fictitious diploma. No personal data is on-chain." |
| 1:25–1:50 | steps 5–6 | "An employer verifies the hash for free, gets Valid with the issuer and trust level, and pays the fee: 30% is burned, the rest goes to the treasury." |
| 1:50–2:10 | steps 7–8 | "The university revokes the credential, and the next check returns Revoked. A forged hash returns Not found." |
| 2:10–2:50 | `npx hardhat test` | "Now the 13 unit tests: access control, expiry, Merkle proof, fee split, slashing, pause and two reentrancy attacks with a malicious token. All pass." |
| 2:50–3:00 | repository page | "Code and README are on GitHub. Thank you." |

Before recording: run `npx hardhat test` once and check that all 13 tests pass. If any test fails, fix it before recording and paste the real output into Appendix D.3 of the report.
