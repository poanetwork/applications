rm -rf ../flats/*
../node_modules/.bin/truffle-flattener ../contracts/classes/admin/Admin.sol > ../flats/Admin.sol
../node_modules/.bin/truffle-flattener ../contracts/classes/sale/Sale.sol > ../flats/Sale.sol
../node_modules/.bin/truffle-flattener ../contracts/classes/token/Token.sol > ../flats/Token.sol
../node_modules/.bin/truffle-flattener ../contracts/DutchCrowdsaleIdx.sol > ../flats/DutchCrowdsaleIdx.sol
../node_modules/.bin/truffle-flattener ../contracts/DutchProxy.sol > ../flats/DutchProxy.sol
../node_modules/.bin/truffle-flattener ../contracts/ProxiesRegistry.sol > ../flats/ProxiesRegistry.sol