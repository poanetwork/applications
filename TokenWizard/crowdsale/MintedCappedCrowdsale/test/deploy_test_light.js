let fs = require('fs')

// Abstract storage contract
let AbstractStorage = artifacts.require('./AbstractStorage')
let ScriptExec = artifacts.require('./RegistryExec')
// MintedCappedCrowdsale
let Token = artifacts.require('./Token')
let Sale = artifacts.require('./Sale')
let TokenManager = artifacts.require('./TokenManager')
let SaleManager = artifacts.require('./SaleManager')
let MintedCapped = artifacts.require('./MintedCappedIdx')
// Registry
let RegistryUtil = artifacts.require('./RegistryUtil')
let RegistryIdx = artifacts.require('./RegistryIdx')
let Provider = artifacts.require('./Provider')
// Util
let MintedCappedUtils = artifacts.require('./MintedCappedUtils')

let ProxiesRegistry = artifacts.require('./TokenWizardProxiesRegistry')

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

  let proxiesRegistry

  let appName = 'MintedCappedCrowdsale'
  let verName = 'v0.0.1'

  before(async () => {
    storage = await AbstractStorage.new().should.be.fulfilled

    regUtil = await RegistryUtil.new().should.be.fulfilled
    regProvider = await Provider.new().should.be.fulfilled
    regIdx = await RegistryIdx.new().should.be.fulfilled

    saleIdx = await MintedCapped.new().should.be.fulfilled
    token = await Token.new().should.be.fulfilled
    sale = await Sale.new().should.be.fulfilled
    tokenManager = await TokenManager.new().should.be.fulfilled
    saleManager = await SaleManager.new().should.be.fulfilled

    saleUtils = await MintedCappedUtils.new().should.be.fulfilled

    saleSelectors = await saleUtils.getSelectors.call().should.be.fulfilled
    saleSelectors.length.should.be.eq(19)

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

    let events = await storage.createRegistry(
      regIdx.address, regProvider.address, { from: exec }
    ).should.be.fulfilled.then((tx) => {
      return tx.logs
    })
    events.should.not.eq(null)
    events.length.should.be.eq(1)
    events[0].event.should.be.eq('ApplicationInitialized')
    regExecID = events[0].args['execution_id']
    web3.toDecimal(regExecID).should.not.eq(0)

    scriptExec = await ScriptExec.new().should.be.fulfilled
    await scriptExec.configure(
      execAdmin, storage.address, exec,
      { from: execAdmin }
    ).should.be.fulfilled
    await scriptExec.setRegistryExecID(regExecID, { from: execAdmin }).should.be.fulfilled

    //deploy proxies registry
    saleIdxMock = await MintedCapped.new().should.be.fulfilled
    proxiesRegistry = await ProxiesRegistry.new(storage.address, saleIdx.address, saleIdxMock.address).should.be.fulfilled

    networkID = await web3.version.network
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
    envVarsContent += `${reactAppPrefix}TW_PROXIES_REGISTRY${addrSuffix}='{"${networkID}":"${proxiesRegistry.address}"}'\n`
    envVarsContent += `${reactAppPrefix}PROXY_PROVIDER${addrSuffix}='{"${networkID}":"${exec}"}'\n`
    envVarsContent += `${reactAppPrefix}REGISTRY_EXEC_ID='${regExecID}'\n`
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
