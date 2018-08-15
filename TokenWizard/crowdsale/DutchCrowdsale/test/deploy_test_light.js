const previouslyDeployed = require('./previously_deployed')
let fs = require('fs')

// Script exec and storage contracts
let ScriptExec = artifacts.require('./RegistryExec')
let AbstractStorage = artifacts.require('./AbstractStorage')
// Registry
let RegistryUtil = artifacts.require('./RegistryUtil')
let RegistryIdx = artifacts.require('./RegistryIdx')
let Provider = artifacts.require('./Provider')
// DutchAuction
let Token = artifacts.require('./Token')
let Sale = artifacts.require('./Sale')
let Admin = artifacts.require('./Admin')
let DutchSale = artifacts.require('./DutchCrowdsaleIdx')
// Utils
let DutchUtils = artifacts.require('./utils/DutchUtils')

let ProxiesRegistry = artifacts.require('./TokenWizardProxiesRegistry')

function hexStrEquals(hex, expected) {
  return web3.toAscii(hex).substring(0, expected.length) == expected;
}

function getTime() {
  let block = web3.eth.getBlock('latest')
  return block.timestamp;
}

contract('DutchCrowdsale', function (accounts) {

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
  let admin

  let proxiesRegistry

  let appName = 'DutchCrowdsale'

  before(async () => {
    storage = await AbstractStorage.at(previouslyDeployed.storage).should.be.fulfilled
    console.log('storage was previously deployed', storage.address)

    regUtil = await RegistryUtil.at(previouslyDeployed.regUtil).should.be.fulfilled
    console.log('regUtil was previously deployed', regUtil.address)
    regProvider = await Provider.at(previouslyDeployed.regProvider).should.be.fulfilled
    console.log('regProvider was previously deployed', regProvider.address)
    regIdx = await RegistryIdx.at(previouslyDeployed.regIdx).should.be.fulfilled
    console.log('regIdx was previously deployed', regIdx.address)

    saleIdx = await DutchSale.new().should.be.fulfilled
    console.log('saleIdx is deployed', saleIdx.address)
    token = await Token.new().should.be.fulfilled
    console.log('token is deployed', token.address)
    sale = await Sale.new().should.be.fulfilled
    console.log('sale is deployed', sale.address)
    admin = await Admin.new().should.be.fulfilled
    console.log('admin is deployed', admin.address)

    saleUtils = await DutchUtils.new().should.be.fulfilled
    console.log('saleUtils is deployed', saleUtils.address)

    saleSelectors = await saleUtils.getSelectors.call().should.be.fulfilled
    saleSelectors.length.should.be.eq(13)
    console.log('saleSelectors are checked')

    saleAddrs = [
      // admin
      admin.address, admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address,

      // sale
      sale.address,

      // token
      token.address, token.address, token.address, token.address, token.address
    ]
    saleAddrs.length.should.be.eq(saleSelectors.length)
    console.log('saleAddrs length is checked')

    regExecID = previouslyDeployed.regExecID

    scriptExec = await ScriptExec.at(previouslyDeployed.scriptExec).should.be.fulfilled
    console.log('scriptExec was previously deployed', scriptExec.address)
    
    networkID = await web3.version.getNetwork
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
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}IDX${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}CROWDSALE${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}CROWDSALE_MANAGER${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN_MANAGER${addrSuffix}='{"${networkID}":"0x0"}'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}IDX${addrSuffix}='{"${networkID}":"${saleIdx.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}CROWDSALE${addrSuffix}='{"${networkID}":"${sale.address}"}'\n`
    envVarsContent += `${reactAppPrefix}${dutchPrefix}TOKEN${addrSuffix}='{"${networkID}":"${token.address}"}'\n`
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