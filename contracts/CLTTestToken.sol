// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title CLTTestToken
 * @notice HYPOTHETICAL test token used only to demonstrate the CredLink prototype.
 * @dev Educational project. The token has no value, is never sold, listed or
 *      distributed, and is deployed ONLY on a local Hardhat network with test accounts.
 *      `mint` is deliberately public so that tests can fund test accounts; a real
 *      token would never allow this.
 */
contract CLTTestToken is ERC20, ERC20Burnable {
    constructor() ERC20("CredLink Test Token", "CLT") {}

    /// @notice Mint test tokens to any address (test-only, unrestricted on purpose).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
