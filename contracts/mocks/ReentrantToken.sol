// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ReentrantToken
 * @notice TEST-ONLY malicious token. After a transfer it tries to call back into the
 *         target contract, to show that CredLink's reentrancy guard stops the attack.
 * @dev mode 1: re-enter stakeDeposit during transferFrom; mode 2: re-enter withdrawDeposit
 *      during transfer. The mock itself acts as the issuer (see tests).
 */
contract ReentrantToken is ERC20 {
    address public target;
    uint8 public mode;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes public lastRevertData;
    bool private _inAttack;

    constructor() ERC20("Reentrant Test Token", "RTT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function setAttack(address target_, uint8 mode_) external {
        target = target_;
        mode = mode_;
        reentryAttempted = false;
        reentrySucceeded = false;
        delete lastRevertData;
    }

    /// @dev Lets this contract approve a spender (it acts as an issuer account in tests).
    function approveFrom(address spender, uint256 amount) external {
        _approve(address(this), spender, amount);
    }

    /// @dev Lets this contract call the target as an issuer (test helper).
    function callTarget(bytes calldata data) external {
        (bool ok, ) = target.call(data);
        require(ok, "target call failed");
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        if (mode == 1) _tryReenter(abi.encodeWithSignature("stakeDeposit(uint256)", uint256(1)));
        return ok;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (mode == 2) _tryReenter(abi.encodeWithSignature("withdrawDeposit()"));
        return ok;
    }

    function _tryReenter(bytes memory data) private {
        if (_inAttack) return;
        _inAttack = true;
        reentryAttempted = true;
        (bool ok, bytes memory ret) = target.call(data);
        reentrySucceeded = ok;
        lastRevertData = ret;
        _inAttack = false;
    }
}
