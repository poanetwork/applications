let fs = require('fs')

// Script exec and storage contracts
let ScriptExec = artifacts.require('./RegistryExec')
let AbstractStorage = artifacts.require('./AbstractStorage')
// Registry
let RegistryUtil = artifacts.require('./RegistryUtil')
let RegistryIdx = artifacts.require('./RegistryIdx')
let Provider = artifacts.require('./Provider')
// MintedCappedCrowdsale
let Token = artifacts.require('./Token')
let Sale = artifacts.require('./Sale')
let TokenManager = artifacts.require('./TokenManager')
let SaleManager = artifacts.require('./SaleManager')
let MintedCapped = artifacts.require('./MintedCappedIdx')
// Util
let MintedCappedUtils = artifacts.require('./MintedCappedUtils')

function hexStrEquals(hex, expected) {
  return web3.toAscii(hex).substring(0, expected.length) == expected;
}

function getTime() {
  let block = web3.eth.getBlock('latest')
  return block.timestamp;
}

contract('MintedCappedCrowdsale', function (accounts) {

  let storage
  let scriptExec
  let networkID

  let exec = accounts[0]
  let execAdmin = accounts[1]

  let regExecID
  let regUtil
  let regProvider
  let regIdx

  let saleUtils
  let saleSelectors
  let saleAddrs

  let saleIdx
  let token
  let sale
  let tokenManager
  let saleManager

  let appName = 'MintedCappedCrowdsale'
  let verName = 'v1.0.0'

  before(async () => {
    storage = await AbstractStorage.new().should.be.fulfilled
    console.log('storage is deployed', storage.address)

    regUtil = await RegistryUtil.new().should.be.fulfilled
    console.log('regUtil is deployed', regUtil.address)
    regProvider = await Provider.new().should.be.fulfilled
    console.log('regProvider is deployed', regProvider.address)
    regIdx = await RegistryIdx.new().should.be.fulfilled
    console.log('regIdx is deployed', regIdx.address)

    saleIdx = await MintedCapped.new().should.be.fulfilled
    console.log('saleIdx is deployed', saleIdx.address)
    token = await Token.new().should.be.fulfilled
    console.log('token is deployed', token.address)
    sale = await Sale.new().should.be.fulfilled
    console.log('sale is deployed', sale.address)
    tokenManager = await TokenManager.new().should.be.fulfilled
    console.log('tokenManager is deployed', tokenManager.address)
    saleManager = await SaleManager.new().should.be.fulfilled
    console.log('saleManager is deployed', saleManager.address)

    saleUtils = await MintedCappedUtils.new().should.be.fulfilled
    console.log('saleUtils is deployed', saleUtils.address)

    saleSelectors = await saleUtils.getSelectors.call().should.be.fulfilled
    saleSelectors.length.should.be.eq(19)
    console.log('saleSelectors are checked')

    saleAddrs = [
      saleManager.address, saleManager.address, saleManager.address,
      saleManager.address, saleManager.address, saleManager.address,

      tokenManager.address, tokenManager.address, tokenManager.address,
      tokenManager.address, tokenManager.address, tokenManager.address,
      tokenManager.address,

      sale.address,

      token.address, token.address, token.address, token.address, token.address
    ]
    saleAddrs.length.should.be.eq(saleSelectors.length)
    console.log('saleAddrs length is checked')

    let events = await storage.createRegistry(
      regIdx.address, regProvider.address, { from: exec }
    ).should.be.fulfilled.then((tx) => {
      return tx.logs
    })
    console.log('createRegistry is called')
    events.should.not.eq(null)
    events.length.should.be.eq(1)
    events[0].event.should.be.eq('ApplicationInitialized')
    regExecID = events[0].args['execution_id']
    web3.toDecimal(regExecID).should.not.eq(0)
    console.log('regExecID is checked')

    scriptExec = await ScriptExec.new().should.be.fulfilled
    console.log('scriptExec is deployed', scriptExec.address)
    await scriptExec.configure(
      execAdmin, storage.address, exec,
      { from: execAdmin }
    ).should.be.fulfilled
    console.log('scriptExec is configured')
    await scriptExec.setRegistryExecID(regExecID, { from: execAdmin }).should.be.fulfilled
    console.log('setRegistryExecID is called')

    networkID = await new Promise((resolve, reject) => {
      web3.version.getNetwork((err, netID) => {
        resolve(netID)
      })
    })
  })

  it.only('should correctly set up script exec', async () => {
    let storedAdmin = await scriptExec.exec_admin.call().should.be.fulfilled
    let defaultStorage = await scriptExec.app_storage.call().should.be.fulfilled
    let defaultRegistryExecID = await scriptExec.registry_exec_id.call().should.be.fulfilled
    let defaultProvider = await scriptExec.provider.call().should.be.fulfilled

    storedAdmin.should.be.eq(execAdmin)
    defaultStorage.should.be.eq(storage.address)
    defaultRegistryExecID.should.be.eq(regExecID)
    defaultProvider.should.be.eq(exec)

    //generates .env variables:
    const reactAppPrefix = 'REACT_APP_'
    const mintedCappedPrefix = 'MINTED_CAPPED_'
    const dutchPrefix = 'DUTCH_'
    const addrSuffix = '_ADDRESS'
    let envVarsContent = ''
    envVarsContent += `${reactAppPrefix}ABSTRACT_STORAGE${addrSuffix}='{"${networkID}":"${storage.address}"}'\n`
    envVarsContent += `${reactAppPrefix}REGISTRY_IDX${addrSuffix}='{"${networkID}":"${regIdx.address}"}'\n`
    envVarsContent += `${reactAppPrefix}PROVIDER${addrSuffix}='{"${networkID}":"${regProvider.address}"}'\n`
    envVarsContent += `${reactAppPrefix}REGISTRY_EXEC${addrSuffix}='{"${networkID}":"${scriptExec.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}IDX${addrSuffix}='{"${networkID}":"${saleIdx.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}CROWDSALE${addrSuffix}='{"${networkID}":"${sale.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}CROWDSALE_MANAGER${addrSuffix}='{"${networkID}":"${saleManager.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN${addrSuffix}='{"${networkID}":"${token.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN_MANAGER${addrSuffix}='{"${networkID}":"${tokenManager.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}IDX${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}CROWDSALE${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}TOKEN${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}PROXY_PROVIDER${addrSuffix}='{"${networkID}":"${exec}"}'\n`
    envVarsContent += `${reactAppPrefix}REGISTRY_EXEC_ID='{"${networkID}":"${regExecID}"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}APP_NAME='MintedCappedCrowdsale'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}APP_NAME='DutchCrowdsale'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}APP_NAME_HASH='0x4d696e74656443617070656443726f776473616c650000000000000000000000'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}APP_NAME_HASH='0x447574636843726f776473616c65000000000000000000000000000000000000'\n`
    envVarsContent += `${reactAppPrefix}INFURA_TOKEN='kEpzZR9fIyO3a8gTqJcI'\n`
    console.log("envVarsContent:")
    console.log(envVarsContent)
    fs.writeFileSync("./.env", envVarsContent)
  })

  it.only('crowdsale application registration', async () => {

    let registerAppCalldata = await regUtil.registerApp.call(
      appName, saleIdx.address, saleSelectors, saleAddrs
    ).should.be.fulfilled
    registerAppCalldata.should.not.eq('0x')

    let events = await storage.exec(
      exec, regExecID, registerAppCalldata,
      { from: exec }
    ).then((tx) => {
      return tx.logs
    })
    events.should.not.eq(null)
    events.length.should.be.eq(1)
    events[0].event.should.be.eq('ApplicationExecution')
  })
})
