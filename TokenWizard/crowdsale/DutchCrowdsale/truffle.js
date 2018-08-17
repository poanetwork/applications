const HDWalletProvider = require("truffle-hdwallet-provider-privkey");
const privKeys = require('../pwd.js') // private keys
const SokolProvider = new HDWalletProvider(privKeys, "https://sokol.poa.network/");
const KovanProvider = new HDWalletProvider(privKeys, "https://kovan.infura.io/");
const RinkebyProvider = new HDWalletProvider(privKeys, "https://rinkeby.infura.io/");
const RopstenProvider = new HDWalletProvider(privKeys, "https://ropsten.infura.io/");

module.exports = {
  networks: {
    development: {
      host: "localhost",
      port: 8545,
      gas: 6600000,
      network_id: "*" // Match any network id
    },
    sokol: {
      provider: function() {
        return SokolProvider
      },
      network_id: '77',
    },
    kovan: {
      provider: function() {
        return KovanProvider
      },
      network_id: '42',
    },
    rinkeby: {
      provider: function() {
        return RinkebyProvider
      },
      network_id: '4',
    },
    ropsten: {
      provider: function() {
        return RopstenProvider
      },
      network_id: '3',
    }
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 200
    }
  }
};
