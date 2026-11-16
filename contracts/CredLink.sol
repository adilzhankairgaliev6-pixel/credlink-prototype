// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Minimal burn interface of the (hypothetical) CLT token.
interface IBurnableToken {
    function burn(uint256 amount) external;
}

/**
 * @title CredLink
 * @notice Educational prototype of a shared register of credential hashes.
 *         Issuers (universities, training providers) record hashes of credentials;
 *         verifiers check them and pay a fee in the hypothetical CLT token.
 * @dev Educational project. Not a real product. Only hashes are stored: no names,
 *      IIN, grades or other personal data ever enter the contract.
 *      In a real network the governance role would belong to a 2-of-3 multisignature
 *      wallet of the founding validators, not to a single key.
 */
contract CredLink is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- roles
    /// @notice Network governance (same as DEFAULT_ADMIN_ROLE): registers issuers, slashes, sets fee.
    bytes32 public constant GOVERNANCE_ROLE = 0x00;
    /// @notice Registered credential issuers.
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    /// @notice May pause and unpause the contract in an emergency (and nothing else).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ---------------------------------------------------------------- types
    enum Status {
        NotFound,
        Valid,
        Revoked,
        Expired
    }

    struct Issuer {
        bool registered;
        bool suspended;
        uint8 trustLevel; // 1 = private provider checked by CredLink ... 3 = accredited university
        bytes32 nameHash; // hash of the legal name, not the name itself
        uint256 requiredDeposit;
        uint256 deposit;
    }

    struct Record {
        bool exists;
        bool revoked;
        bool isBatch;
        uint64 expiry; // 0 = never expires
        address issuer;
    }

    // -------------------------------------------------------------- storage
    /// @notice Token used for deposits and fees (hypothetical CLT).
    IERC20 public immutable token;
    /// @notice Receives 70% of every verification fee and slashed deposits.
    address public immutable treasury;
    /// @notice Fee per verification, in token units.
    uint256 public verificationFee;
    /// @notice Share of each fee that is burned, in basis points (30%).
    uint256 public constant BURN_BPS = 3000;
    uint256 private constant BPS = 10_000;
    uint8 public constant MAX_TRUST_LEVEL = 3;

    mapping(address => Issuer) public issuers;
    mapping(bytes32 => Record) public records;

    // --------------------------------------------------------------- events
    event IssuerRegistered(address indexed issuer, bytes32 nameHash, uint8 trustLevel, uint256 requiredDeposit);
    event IssuerReinstated(address indexed issuer);
    event DepositStaked(address indexed issuer, uint256 amount, uint256 newDeposit);
    event DepositWithdrawn(address indexed issuer, uint256 amount);
    event DepositSlashed(address indexed issuer, uint256 amount, uint8 newTrustLevel);
    event CredentialIssued(address indexed issuer, bytes32 indexed hash, uint64 expiry, bool isBatch);
    event CredentialRevoked(address indexed issuer, bytes32 indexed hash);
    event VerificationFeePaid(address indexed verifier, bytes32 indexed hash, uint256 fee, uint256 burned, uint256 toTreasury);
    event VerificationFeeChanged(uint256 newFee);

    // --------------------------------------------------------------- errors
    error ZeroAddress();
    error ZeroAmount();
    error ZeroHash();
    error InvalidTrustLevel(uint8 trustLevel);
    error IssuerAlreadyRegistered(address issuer);
    error IssuerNotRegistered(address issuer);
    error IssuerSuspended(address issuer);
    error InsufficientDeposit(uint256 required, uint256 actual);
    error CredentialAlreadyExists(bytes32 hash);
    error CredentialNotFound(bytes32 hash);
    error NotCredentialIssuer(bytes32 hash, address caller);
    error AlreadyRevoked(bytes32 hash);
    error InvalidExpiry(uint64 expiry);
    error SlashExceedsDeposit(uint256 amount, uint256 deposit);
    error NothingToWithdraw();

    // ---------------------------------------------------------- constructor
    /**
     * @param token_ CLT token address.
     * @param treasury_ Treasury address.
     * @param admin_ Initial governance and pauser (a multisig in production).
     * @param fee_ Verification fee in token units.
     */
    constructor(IERC20 token_, address treasury_, address admin_, uint256 fee_) {
        if (address(token_) == address(0) || treasury_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        token = token_;
        treasury = treasury_;
        verificationFee = fee_;
        _grantRole(GOVERNANCE_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
    }

    // ------------------------------------------------------------ governance
    /// @notice Add a checked institution to the network and grant it ISSUER_ROLE.
    function registerIssuer(address issuer, bytes32 nameHash, uint8 trustLevel, uint256 requiredDeposit)
        external
        onlyRole(GOVERNANCE_ROLE)
    {
        if (issuer == address(0)) revert ZeroAddress();
        if (trustLevel == 0 || trustLevel > MAX_TRUST_LEVEL) revert InvalidTrustLevel(trustLevel);
        if (issuers[issuer].registered) revert IssuerAlreadyRegistered(issuer);

        issuers[issuer] = Issuer({
            registered: true,
            suspended: false,
            trustLevel: trustLevel,
            nameHash: nameHash,
            requiredDeposit: requiredDeposit,
            deposit: 0
        });
        _grantRole(ISSUER_ROLE, issuer);
        emit IssuerRegistered(issuer, nameHash, trustLevel, requiredDeposit);
    }

    /// @notice Take part of an issuer's deposit after proven fraud; suspends the issuer
    ///         and lowers its trust level. The slashed amount goes to the treasury.
    function slashDeposit(address issuer, uint256 amount) external nonReentrant onlyRole(GOVERNANCE_ROLE) {
        Issuer storage i = issuers[issuer];
        if (!i.registered) revert IssuerNotRegistered(issuer);
        if (amount == 0) revert ZeroAmount();
        if (amount > i.deposit) revert SlashExceedsDeposit(amount, i.deposit);

        // effects
        i.deposit -= amount;
        i.suspended = true;
        if (i.trustLevel > 1) i.trustLevel -= 1;
        emit DepositSlashed(issuer, amount, i.trustLevel);

        // interaction
        token.safeTransfer(treasury, amount);
    }

    /// @notice Lift the suspension of an issuer (it still needs a sufficient deposit to issue).
    function reinstateIssuer(address issuer) external onlyRole(GOVERNANCE_ROLE) {
        if (!issuers[issuer].registered) revert IssuerNotRegistered(issuer);
        issuers[issuer].suspended = false;
        emit IssuerReinstated(issuer);
    }

    /// @notice Change the fee per verification.
    function setVerificationFee(uint256 newFee) external onlyRole(GOVERNANCE_ROLE) {
        verificationFee = newFee;
        emit VerificationFeeChanged(newFee);
    }

    // ---------------------------------------------------------------- pause
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // --------------------------------------------------------------- issuers
    /// @notice Lock CLT as a guarantee of honest behaviour. Needs a prior token approval.
    function stakeDeposit(uint256 amount) external nonReentrant onlyRole(ISSUER_ROLE) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Issuer storage i = issuers[msg.sender];
        if (!i.registered) revert IssuerNotRegistered(msg.sender);

        i.deposit += amount; // effect before interaction
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit DepositStaked(msg.sender, amount, i.deposit);
    }

    /// @notice Withdraw the whole deposit. Not possible while suspended.
    function withdrawDeposit() external nonReentrant onlyRole(ISSUER_ROLE) {
        Issuer storage i = issuers[msg.sender];
        if (i.suspended) revert IssuerSuspended(msg.sender);
        uint256 amount = i.deposit;
        if (amount == 0) revert NothingToWithdraw();

        i.deposit = 0; // effect before interaction (checks-effects-interactions)
        emit DepositWithdrawn(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    /// @notice Record the hash of one credential. expiry = 0 means no expiry.
    function issueCredential(bytes32 hash, uint64 expiry)
        external
        onlyRole(ISSUER_ROLE)
        whenNotPaused
    {
        _issue(hash, expiry, false);
    }

    /// @notice Record the Merkle root of a batch of credential hashes (e.g. one graduation).
    function issueBatch(bytes32 merkleRoot, uint64 expiry)
        external
        onlyRole(ISSUER_ROLE)
        whenNotPaused
    {
        _issue(merkleRoot, expiry, true);
    }

    /// @notice Cancel a credential (e.g. issued by mistake). Only the issuer that recorded it.
    ///         Deliberately allowed while paused, so that mistakes can always be corrected.
    function revokeCredential(bytes32 hash) external onlyRole(ISSUER_ROLE) {
        Record storage r = records[hash];
        if (!r.exists) revert CredentialNotFound(hash);
        if (r.issuer != msg.sender) revert NotCredentialIssuer(hash, msg.sender);
        if (r.revoked) revert AlreadyRevoked(hash);
        r.revoked = true;
        emit CredentialRevoked(msg.sender, hash);
    }

    // ------------------------------------------------------------- verifiers
    /// @notice Read-only check of a credential hash (or batch root). Costs no fee and no gas off-chain.
    function verifyCredential(bytes32 hash) public view returns (Status status, address issuer, uint8 trustLevel) {
        Record storage r = records[hash];
        if (!r.exists) return (Status.NotFound, address(0), 0);
        issuer = r.issuer;
        trustLevel = issuers[issuer].trustLevel;
        if (r.revoked) return (Status.Revoked, issuer, trustLevel);
        if (r.expiry != 0 && block.timestamp > r.expiry) return (Status.Expired, issuer, trustLevel);
        return (Status.Valid, issuer, trustLevel);
    }

    /// @notice Check one credential that belongs to a recorded batch.
    ///         `leaf` is the credential hash; `proof` is its Merkle proof (sorted-pair keccak256).
    function verifyProof(bytes32 leaf, bytes32[] calldata proof, bytes32 root)
        external
        view
        returns (Status status, address issuer, uint8 trustLevel)
    {
        if (!records[root].isBatch || !MerkleProof.verifyCalldata(proof, root, leaf)) {
            return (Status.NotFound, address(0), 0);
        }
        return verifyCredential(root);
    }

    /// @notice Pay the fee for a verification: 30% is burned, 70% goes to the treasury.
    ///         Needs a prior token approval of at least `verificationFee`.
    function payVerificationFee(bytes32 hash) external nonReentrant whenNotPaused {
        if (!records[hash].exists) revert CredentialNotFound(hash);
        uint256 fee = verificationFee;
        uint256 burned = (fee * BURN_BPS) / BPS;
        uint256 toTreasury = fee - burned;

        emit VerificationFeePaid(msg.sender, hash, fee, burned, toTreasury);

        token.safeTransferFrom(msg.sender, address(this), fee);
        if (burned > 0) IBurnableToken(address(token)).burn(burned);
        if (toTreasury > 0) token.safeTransfer(treasury, toTreasury);
    }

    /// @notice Deposit of an issuer.
    function depositOf(address issuer) external view returns (uint256) {
        return issuers[issuer].deposit;
    }

    // -------------------------------------------------------------- internal
    function _issue(bytes32 hash, uint64 expiry, bool isBatch) private {
        if (hash == bytes32(0)) revert ZeroHash();
        Issuer storage i = issuers[msg.sender];
        if (!i.registered) revert IssuerNotRegistered(msg.sender);
        if (i.suspended) revert IssuerSuspended(msg.sender);
        if (i.deposit < i.requiredDeposit) revert InsufficientDeposit(i.requiredDeposit, i.deposit);
        if (records[hash].exists) revert CredentialAlreadyExists(hash);
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry(expiry);

        records[hash] = Record({exists: true, revoked: false, isBatch: isBatch, expiry: expiry, issuer: msg.sender});
        emit CredentialIssued(msg.sender, hash, expiry, isBatch);
    }
}
