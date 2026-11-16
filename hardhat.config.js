require("@nomicfoundation/hardhat-toolbox");

// Educational project: local in-process Hardhat network only.
// No public network, no RPC URLs and no private keys are configured on purpose.
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
  },
};
