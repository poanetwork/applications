// Script exec and storage contracts
let ScriptExec = artifacts.require('./ScriptExec')
let AbstractStorage = artifacts.require('./AbstractStorage')
// Script registry
let InitRegistry = artifacts.require('./InitRegistry')
let AppConsole = artifacts.require('./AppConsole')
let VersionConsole = artifacts.require('./VersionConsole')
let ImplConsole = artifacts.require('./ImplementationConsole')
// DutchAuction
let InitDutch = artifacts.require('./InitCrowdsale')
let DutchBuy = artifacts.require('./CrowdsaleBuyTokens')
let DutchCrowdsaleConsole = artifacts.require('./CrowdsaleConsole')
let DutchTokenConsole = artifacts.require('./TokenConsole')
let DutchTokenTransfer = artifacts.require('./TokenTransfer')
let DutchTokenTransferFrom = artifacts.require('./TokenTransferFrom')
let DutchTokenApprove = artifacts.require('./TokenApprove')

let fs = require('fs')

// Utils
let RegistryUtils = artifacts.require('./utils/TestUtils')

function hexStrEquals(hex, expected) {
  return web3.toAscii(hex).substring(0, expected.length) == expected;
}

function getTime() {
  let block = web3.eth.getBlock('latest')
  return block.timestamp;
}

contract('DutchCrowdsale', function (accounts) {

  let storage
  let exec
  let networkID

  let execAdmin = accounts[0]
  let updater = accounts[1]
  let registryExecID
  let updaterContext
  let updaterID

  let registryUtils

  let initRegistry
  let initRegistryCalldata = '0xe1c7392a'
  let appConsole
  let versionConsole
  let implConsole

  let initCrowdsale
  let initCrowdsaleSelector = '0xdb7b87ff'
  let initCrowdsaleDesc = 'Initializes a DutchCrowdsale'
  let crowdsaleBuy
  let crowdsaleConsole
  let tokenConsole
  let tokenTransfer
  let tokenTransferFrom
  let tokenApprove

  let appName = 'DutchCrowdsale'
  let appDesc = 'A crowdsale application utilizing a dutch auction framework'
  let verName = 'v0.0.1'
  let verDesc = 'Initial version'

  // Event signatures
  let initHash = web3.sha3('ApplicationInitialized(bytes32,address,address,address)')
  let finalHash = web3.sha3('ApplicationFinalization(bytes32,address)')
  let execHash = web3.sha3('ApplicationExecution(bytes32,address)')
  let payHash = web3.sha3('DeliveredPayment(bytes32,address,uint256)')

  let transferHash = web3.sha3('Transfer(address,address,uint256)')
  let approvalHash = web3.sha3('Approval(address,address,uint256)')

  before(async () => {
    storage = await AbstractStorage.new().should.be.fulfilled
    registryUtils = await RegistryUtils.new().should.be.fulfilled

    initRegistry = await InitRegistry.new().should.be.fulfilled
    appConsole = await AppConsole.new().should.be.fulfilled
    versionConsole = await VersionConsole.new().should.be.fulfilled
    implConsole = await ImplConsole.new().should.be.fulfilled

    initCrowdsale = await InitDutch.new().should.be.fulfilled
    crowdsaleBuy = await DutchBuy.new().should.be.fulfilled
    crowdsaleConsole = await DutchCrowdsaleConsole.new().should.be.fulfilled
    tokenConsole = await DutchTokenConsole.new().should.be.fulfilled
    tokenTransfer = await DutchTokenTransfer.new().should.be.fulfilled
    tokenTransferFrom = await DutchTokenTransferFrom.new().should.be.fulfilled
    tokenApprove = await DutchTokenApprove.new().should.be.fulfilled

    // Initialize and finalize the script registry application within storage and get its exec id
    let events = await storage.initAndFinalize(
      updater, false, initRegistry.address, initRegistryCalldata, [
        appConsole.address, versionConsole.address, implConsole.address
      ], { from: updater }
    ).then((tx) => {
      return tx.logs
    })
    events.should.not.eq(null)
    events.length.should.be.eq(2)

    events[0].event.should.be.eq('ApplicationInitialized')
    events[1].event.should.be.eq('ApplicationFinalization')

    registryExecID = events[0].args['execution_id']
    registryExecID.should.be.eq(events[1].args['execution_id'])
    web3.toDecimal(registryExecID).should.not.eq(0)

    updaterContext = await registryUtils.getContext.call(
      registryExecID, updater, 0
    ).should.be.fulfilled
    updaterContext.should.not.eq('0x')

    updaterID = await registryUtils.getProviderHash.call(updater).should.be.fulfilled
    web3.toDecimal(updaterID).should.not.eq(0)

    exec = await ScriptExec.new(
      execAdmin, updater, storage.address, updaterID,
      { from: execAdmin }
    ).should.be.fulfilled
    await exec.changeRegistryExecId(registryExecID, { from: execAdmin }).should.be.fulfilled
    networkID = await web3.version.network
  })

  it('should correctly set up script exec', async () => {
    let storedAdmin = await exec.exec_admin.call().should.be.fulfilled
    let defaultStorage = await exec.default_storage.call().should.be.fulfilled
    let defaultUpdater = await exec.default_updater.call().should.be.fulfilled
    let defaultRegistryExecID = await exec.default_registry_exec_id.call().should.be.fulfilled
    let defaultProvider = await exec.default_provider.call().should.be.fulfilled

    storedAdmin.should.be.eq(execAdmin)
    defaultStorage.should.be.eq(storage.address)
    defaultUpdater.should.be.eq(updater)
    defaultRegistryExecID.should.be.eq(registryExecID)
    defaultProvider.should.be.eq(updaterID)
  })

  context('crowdsale application registration', async () => {

    let registerAppCalldata
    let registerVersionCalldata
    let addFunctionsCalldata
    let finalizeVersionCalldata

    before(async () => {
      registerAppCalldata = await registryUtils.registerApp.call(
        appName, storage.address, appDesc, updaterContext
      ).should.be.fulfilled
      registerAppCalldata.should.not.eq('0x')

      registerVersionCalldata = await registryUtils.registerVersion.call(
        appName, verName, storage.address, verDesc, updaterContext
      ).should.be.fulfilled
      registerVersionCalldata.should.not.eq('0x')

      addFunctionsCalldata = await registryUtils.addFunctions.call(
        appName, verName,
        ['0xaaaaaaaa', '0xbbbbbbbb','0xcccccccc','0xdddddddd', '0xeeeeeeee', '0xffffffff'],
        [crowdsaleBuy.address, crowdsaleConsole.address, tokenConsole.address,
        tokenTransfer.address, tokenTransferFrom.address, tokenApprove.address],
        updaterContext
      ).should.be.fulfilled
      addFunctionsCalldata.should.not.eq('0x')

      finalizeVersionCalldata = await registryUtils.finalizeVersion.call(
        appName, verName, initCrowdsale.address, initCrowdsaleSelector,
        initCrowdsaleDesc, updaterContext
      ).should.be.fulfilled
      finalizeVersionCalldata.should.not.eq('0x')

      let events = await storage.exec(
        appConsole.address, registryExecID, registerAppCalldata,
        { from: updater }
      ).then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('ApplicationExecution')

      events = await storage.exec(
        versionConsole.address, registryExecID, registerVersionCalldata,
        { from: updater }
      ).then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('ApplicationExecution')

      events = await storage.exec(
        implConsole.address, registryExecID, addFunctionsCalldata,
        { from: updater }
      ).then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('ApplicationExecution')

      events = await storage.exec(
        versionConsole.address, registryExecID, finalizeVersionCalldata,
        { from: updater }
      ).then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('ApplicationExecution')

      //generates .env variables:
      const reactAppPrefix = 'REACT_APP_'
      const mintedCappedPrefix = 'MINTED_CAPPED_CROWDSALE_'
      const dutchPrefix = 'DUTCH_CROWDSALE_'
      const addrSuffix = '_ADDRESS'
      let envVarsContent = ''
      envVarsContent += `${reactAppPrefix}REGISTRY_STORAGE${addrSuffix}='{"${networkID}":"${storage.address}"}'\n`
      envVarsContent += `${reactAppPrefix}INIT_REGISTRY${addrSuffix}='{"${networkID}":"${initRegistry.address}"}'\n`
      envVarsContent += `${reactAppPrefix}APP_CONSOLE${addrSuffix}='{"${networkID}":"${appConsole.address}"}'\n`
      envVarsContent += `${reactAppPrefix}VERSION_CONSOLE${addrSuffix}='{"${networkID}":"${versionConsole.address}"}'\n`
      envVarsContent += `${reactAppPrefix}IMPLEMENTATION_CONSOLE${addrSuffix}='{"${networkID}":"${implConsole.address}"}'\n`
      envVarsContent += `${reactAppPrefix}SCRIPT_EXEC${addrSuffix}='{"${networkID}":"${exec.address}"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}INIT_CROWDSALE${addrSuffix}='{"${networkID}":"0x0"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN_CONSOLE${addrSuffix}='{"${networkID}":"0x0"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}CROWDSALE_CONSOLE${addrSuffix}='{"${networkID}":"0x0"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}CROWDSALE_BUY_TOKENS${addrSuffix}='{"${networkID}":"0x0"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN_TRANSFER${addrSuffix}='{"${networkID}":"0x0"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN_TRANSFER_FROM${addrSuffix}='{"${networkID}":"0x0"}'\n`
      envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}TOKEN_APPROVE${addrSuffix}='{"${networkID}":"0x0"}'\n`
  	  envVarsContent += `${reactAppPrefix}${dutchPrefix}INIT_CROWDSALE${addrSuffix}='{"${networkID}":"${initCrowdsale.address}"}'\n`
  	  envVarsContent += `${reactAppPrefix}${dutchPrefix}TOKEN_CONSOLE${addrSuffix}='{"${networkID}":"${tokenConsole.address}"}'\n`
  	  envVarsContent += `${reactAppPrefix}${dutchPrefix}CROWDSALE_CONSOLE${addrSuffix}='{"${networkID}":"${crowdsaleConsole.address}"}'\n`
  	  envVarsContent += `${reactAppPrefix}${dutchPrefix}CROWDSALE_BUY_TOKENS${addrSuffix}='{"${networkID}":"${crowdsaleBuy.address}"}'\n`
      envVarsContent += `${reactAppPrefix}${dutchPrefix}TOKEN_TRANSFER${addrSuffix}='{"${networkID}":"${tokenTransfer.address}"}'\n`
      envVarsContent += `${reactAppPrefix}${dutchPrefix}TOKEN_TRANSFER_FROM${addrSuffix}='{"${networkID}":"${tokenTransferFrom.address}"}'\n`
      envVarsContent += `${reactAppPrefix}${dutchPrefix}TOKEN_APPROVE${addrSuffix}='{"${networkID}":"${tokenApprove.address}"}'\n`
  	  envVarsContent += `${reactAppPrefix}${mintedCappedPrefix}APP_NAME='MintedCappedCrowdsale'\n`
      envVarsContent += `${reactAppPrefix}${dutchPrefix}APP_NAME='DutchCrowdsale'\n`
      envVarsContent += `${reactAppPrefix}INFURA_TOKEN='kEpzZR9fIyO3a8gTqJcI'\n`
      console.log("envVarsContent:")
      console.log(envVarsContent)
      fs.writeFileSync("./.env", envVarsContent)
    })

    describe.only('#getAppLatestInfo', async () => {

      let appLatest

      beforeEach(async () => {
        appLatest = await initRegistry.getAppLatestInfo.call(
          storage.address, registryExecID, updaterID, appName
        ).should.be.fulfilled
        appLatest.length.should.be.eq(4)
      })

      it('should have a valid storage address', async () => {
        appLatest[0].should.be.eq(storage.address)
      })

      it('should match the version registered', async () => {
        hexStrEquals(appLatest[1], verName).should.be.eq(true)
      })

      it('should match the set init address', async () => {
        appLatest[2].should.be.eq(initCrowdsale.address)
      })

      it('should have the correct allowed addresses', async () => {
        appLatest[3].length.should.be.eq(6)
        appLatest[3][0].should.be.eq(crowdsaleBuy.address)
        appLatest[3][1].should.be.eq(crowdsaleConsole.address)
        appLatest[3][2].should.be.eq(tokenConsole.address)
        appLatest[3][3].should.be.eq(tokenTransfer.address)
        appLatest[3][4].should.be.eq(tokenTransferFrom.address)
        appLatest[3][5].should.be.eq(tokenApprove.address)
      })
    })

    describe('#getVersionImplementation', async () => {

      let versionImpl

      beforeEach(async () => {
        versionImpl = await initRegistry.getVersionImplementation.call(
          storage.address, registryExecID, updaterID, appName, verName
        ).should.be.fulfilled
        versionImpl.length.should.be.eq(2)
      })

      it('should have valid array sizes', async () => {
        versionImpl[0].length.should.be.eq(6)
        versionImpl[1].length.should.be.eq(6)
      })

      it('should match the passed in addresses', async () => {
        versionImpl[1][0].should.be.eq(crowdsaleBuy.address)
        versionImpl[1][1].should.be.eq(crowdsaleConsole.address)
        versionImpl[1][2].should.be.eq(tokenConsole.address)
        versionImpl[1][3].should.be.eq(tokenTransfer.address)
        versionImpl[1][4].should.be.eq(tokenTransferFrom.address)
        versionImpl[1][5].should.be.eq(tokenApprove.address)
      })
    })

    context('crowdsale app instance initialization', async () => {

      let initCrowdsaleCalldata
      let initCrowdsaleEvent
      let crowdsaleExecID

      let teamWallet = accounts[1]
      let totalSupply = web3.toWei('1000', 'ether')
      let sellAmount = web3.toWei('500', 'ether')
      let startRate = web3.toWei('0.01', 'ether')
      let endRate = web3.toWei('0.001', 'ether')
      let duration = 3600
      let startTime
      let isWhitelisted = true
      let admin = updater

      beforeEach(async () => {
        startTime = getTime() + 3600

        initCrowdsaleCalldata = await registryUtils.init.call(
          teamWallet, totalSupply, sellAmount, startRate,
          endRate, duration, startTime, isWhitelisted, admin
        ).should.be.fulfilled
        initCrowdsaleCalldata.should.not.eq('0x')
      })

      describe('#initAndFinalize - abstract storage', async () => {

        beforeEach(async () => {
          let events = await storage.initAndFinalize(
            updater, true, initCrowdsale.address, initCrowdsaleCalldata, [
              crowdsaleBuy.address, crowdsaleConsole.address, tokenConsole.address,
              tokenTransfer.address, tokenTransferFrom.address, tokenApprove.address
            ]
          ).then((tx) => {
            return tx.logs
          })
          events.should.not.eq(null)
          events.length.should.be.eq(2)

          events[0].event.should.be.eq('ApplicationInitialized')
          events[1].event.should.be.eq('ApplicationFinalization')

          initCrowdsaleEvent = events[0]
        })

        describe('the ApplicationInitialized event', async () => {

          it('should contain an indexed execution id', async () => {
            crowdsaleExecID = initCrowdsaleEvent.args['execution_id']
            web3.toDecimal(crowdsaleExecID).should.not.eq(0)
          })
        })
      })

      describe('#initAppInstance - script exec', async () => {

        let deployer = accounts[accounts.length - 1]

        let appInstanceEvent

        beforeEach(async () => {
          let events = await exec.initAppInstance(
            'DutchCrowdsale', true, initCrowdsaleCalldata,
            { from: deployer }
          ).then((tx) => {
            return tx.logs
          })
          events.should.not.eq(null)
          events.length.should.be.eq(1)
          events[0].event.should.be.eq('AppInstanceCreated')

          appInstanceEvent = events[0]
          crowdsaleExecID = appInstanceEvent.args['exec_id']
        })

        describe('the AppInstanceCreated event', async () => {

          it('should contain the indexed deployer address', async () => {
            let creatorAddr = appInstanceEvent.args['creator']
            creatorAddr.should.be.eq(deployer)
          })

          it('should contain a valid execution ID', async () => {
            web3.toDecimal(crowdsaleExecID).should.not.eq(0)
          })
        })
      })
    })
  })
})
