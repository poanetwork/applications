rm -rf ../flats/*
../node_modules/.bin/truffle-flattener ../contracts/classes/sale/Sale.sol > ../flats/Sale.sol
../node_modules/.bin/truffle-flattener ../contracts/classes/sale_manager/SaleManager.sol > ../flats/SaleManager.sol
../node_modules/.bin/truffle-flattener ../contracts/classes/token/Token.sol > ../flats/Token.sol
../node_modules/.bin/truffle-flattener ../contracts/classes/token_manager/TokenManager.sol > ../flats/TokenManager.sol
../node_modules/.bin/truffle-flattener ../contracts/MintedCappedIdx.sol > ../flats/MintedCappedIdx.sol
../node_modules/.bin/truffle-flattener ../contracts/MintedCappedProxy.sol > ../flats/MintedCappedProxy.sol