const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
chai.should()
chai.use(chaiAsPromised)
chai.use(require('chai-bignumber')());
// Abstract storage contract
let AbstractStorage = artifacts.require('./StorageMock.sol')
// Registry
let RegistryUtil = artifacts.require('./RegistryUtil')
let RegistryIdx = artifacts.require('./RegistryIdx')
let Provider = artifacts.require('./Provider')
// DutchAuction
let Token = artifacts.require('./Token')
let Sale = artifacts.require('./SaleMock')
let Admin = artifacts.require('./Admin')
let DutchSale = artifacts.require('./DutchCrowdsaleIdxMock')
// Utils
let DutchUtils = artifacts.require('./utils/DutchSaleMockUtils')

function getTime() {
	let block = web3.eth.getBlock('latest')
	return block.timestamp;
}

function zeroAddress() {
	return web3.toHex(0)
}

function hexStrEquals(hex, expected) {
	return web3.toAscii(hex).substring(0, expected.length) == expected;
}

function deepToNumber(num) {
	return web3.toBigNumber(num).toNumber()
}

contract('#DutchBuyTokens: price change tests - (various prices, 18 decimals)', function (accounts) {

	let storage

	let exec = accounts[0]
	let crowdsaleAdmin = accounts[1]
	let teamWallet = accounts[2]

	let appName = 'DutchCrowdsale'

	let regExecID
	let regUtil
	let regProvider
	let regIdx

	let saleUtils
	let saleAddrs
	let saleSelectors

	let saleIdx
	let token
	let sale
	let admin

	let executionID
	let initCalldata
	let purchaseCalldata

	let startTime
	let totalSupply = web3.toBigNumber(web3.toWei('1000000000', 'ether')) // 1 billion tokens in existence
	let sellCap = web3.toBigNumber(web3.toWei('1000000000', 'ether')) // 1 billion tokens for sale
	let startPrices = [
		web3.toBigNumber(web3.toWei('0.000001', 'ether')), // 0.000001 eth per token (1 token is [10 ** decimals] units)
		web3.toBigNumber(web3.toWei('0.001', 'ether')), // 0.001 eth per token (1 token is [10 ** decimals] units)
		web3.toBigNumber(web3.toWei('0.001001', 'ether')) // 0.001001 eth per token
	]
	let endPrices = [
		web3.toBigNumber(web3.toWei('0.00000075', 'ether')), // 0.000001 -> 0.00000075
		web3.toBigNumber(web3.toWei('0.000001', 'ether')), // 0.001 -> 0.000001
		web3.toBigNumber(web3.toWei('0.001', 'ether')) // 0.001001 -> 0.001
	]
	let duration = 36000 // 10 hours
	let isWhitelisted = false
	let burnExcess = true

	let purchaseTimes

	let tokenName = 'Token'
	let tokenSymbol = 'TOK'
	let tokenDecimals = 18
	let unitPrice = web3.toBigNumber(web3.toWei('1', 'ether'))

	let purchasers = [
		accounts[accounts.length - 1],
		accounts[accounts.length - 2],
		accounts[accounts.length - 3]
	]

	// Event signatures
	let initHash = web3.sha3('ApplicationInitialized(bytes32,address,address,address)')
	let finalHash = web3.sha3('ApplicationFinalization(bytes32,address)')
	let execHash = web3.sha3('ApplicationExecution(bytes32,address)')
	let payHash = web3.sha3('DeliveredPayment(bytes32,address,uint256)')
	let exceptHash = web3.sha3('ApplicationException(address,bytes32,bytes)')

	let purchaseHash = web3.sha3('Purchase(bytes32,uint256,uint256,uint256)')

	before(async () => {
		storage = await AbstractStorage.new().should.be.fulfilled
		saleUtils = await DutchUtils.new().should.be.fulfilled

		regUtil = await RegistryUtil.new().should.be.fulfilled
		regProvider = await Provider.new().should.be.fulfilled
		regIdx = await RegistryIdx.new().should.be.fulfilled

		saleIdx = await DutchSale.new().should.be.fulfilled
		token = await Token.new().should.be.fulfilled
		sale = await Sale.new().should.be.fulfilled
		admin = await Admin.new().should.be.fulfilled

		saleSelectors = await saleUtils.getSelectors.call().should.be.fulfilled
		saleSelectors.length.should.be.eq(17)

		saleAddrs = [
			// admin
			admin.address, admin.address, admin.address, admin.address,
			admin.address, admin.address, admin.address,

			// sale
			sale.address,

			// token
			token.address, token.address, token.address, token.address, token.address,

			// mock
			sale.address, sale.address, sale.address, sale.address
		]
		saleAddrs.length.should.be.eq(saleSelectors.length)
	})

	beforeEach(async () => {
		// Reset crowdsale buy and crowdsale init contract times
		await storage.resetTime().should.be.fulfilled
		let storedTime = await storage.set_time.call().should.be.fulfilled
		storedTime.toNumber().should.be.eq(0)
		await saleIdx.resetTime().should.be.fulfilled
		storedTime = await saleIdx.set_time.call().should.be.fulfilled
		storedTime.toNumber().should.be.eq(0)

		startTime = getTime() + 3600
		purchaseTimes = [
			startTime, // near the start
			startTime + (duration / 2), // in the middle
			startTime + duration - 1 // near the end
		]

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

		let registerCalldata = await regUtil.registerApp.call(
			appName, saleIdx.address, saleSelectors, saleAddrs
		).should.be.fulfilled
		registerCalldata.should.not.eq('0x0')

		events = await storage.exec(
			exec, regExecID, registerCalldata,
			{ from: exec }
		).should.be.fulfilled.then((tx) => {
			return tx.logs;
		})
		events.should.not.eq(null)
		events.length.should.be.eq(1)
		events[0].event.should.be.eq('ApplicationExecution')
		events[0].args['script_target'].should.be.eq(regProvider.address)

		initCalldata = await saleUtils.init.call(
			teamWallet, totalSupply, sellCap, startPrices[0], endPrices[0],
			duration, startTime, isWhitelisted, crowdsaleAdmin, burnExcess
		).should.be.fulfilled
		initCalldata.should.not.eq('0x')

		events = await storage.createInstance(
			exec, appName, exec, regExecID, initCalldata,
			{ from: exec }
		).should.be.fulfilled.then((tx) => {
			return tx.logs
		})
		events.should.not.eq(null)
		events.length.should.be.eq(1)
		executionID = events[0].args['execution_id']
		web3.toDecimal(executionID).should.not.eq(0)

		let initTokenCalldata = await saleUtils.initCrowdsaleToken.call(
			tokenName, tokenSymbol, tokenDecimals
		).should.be.fulfilled
		initTokenCalldata.should.not.eq('0x')

		events = await storage.exec(
			crowdsaleAdmin, executionID, initTokenCalldata,
			{ from: exec }
		).then((tx) => {
			return tx.logs
		})
		events.should.not.eq(null)
		events.length.should.be.eq(1)
		events[0].event.should.be.eq('ApplicationExecution')

		let initCrowdsaleCalldata = await saleUtils.initializeCrowdsale.call().should.be.fulfilled
		initCrowdsaleCalldata.should.not.eq('0x')

		events = await storage.exec(
			crowdsaleAdmin, executionID, initCrowdsaleCalldata,
			{ from: exec }
		).then((tx) => {
			return tx.logs
		})
		events.should.not.eq(null)
		events.length.should.be.eq(1)
		events[0].event.should.be.eq('ApplicationExecution')

		purchaseCalldata = await saleUtils.buy.call().should.be.fulfilled
	})

	describe('pre-test-storage', async() => {

		it('should be an initialized crowdsale', async () => {
			let saleInfo = await saleIdx.getCrowdsaleInfo.call(
				storage.address, executionID
			).should.be.fulfilled
			saleInfo.length.should.be.eq(6)

			saleInfo[0].toNumber().should.be.eq(0)
			saleInfo[1].should.be.eq(teamWallet)
			saleInfo[2].toNumber().should.be.eq(0)
			saleInfo[3].should.be.eq(true)
			saleInfo[4].should.be.eq(false)
			saleInfo[5].should.be.eq(burnExcess)
		})

		it('should have a correctly initialized token', async () => {
			let tokenInfo = await saleIdx.getTokenInfo.call(
				storage.address, executionID
			).should.be.fulfilled
			tokenInfo.length.should.be.eq(4)

			hexStrEquals(tokenInfo[0], tokenName).should.be.eq(true)
			hexStrEquals(tokenInfo[1], tokenSymbol).should.be.eq(true)
			tokenInfo[2].toNumber().should.be.eq(tokenDecimals)
			tokenInfo[3].should.be.bignumber.eq(totalSupply)
		})
	})

	describe('Prices 1 - (normal distribution)', async () => {

		beforeEach(async () => {
			let setPricesCalldata = await saleUtils.setStartAndEndPrices.call(
				startPrices[0], endPrices[0]
			).should.be.fulfilled
			setPricesCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, setPricesCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		after(async () => {
			let bal = await web3.eth.getBalance(teamWallet).toNumber()
			await web3.eth.sendTransaction(
				{ from: teamWallet, to: exec, value: bal, gasPrice: 0 }
			)
		})

		describe('near the beginning', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {
				expectedCurrentPrice = startPrices[0]

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					expectedCurrentPrice.div(2)
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[0]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[0])
				await saleIdx.setTime(purchaseTimes[0]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[0])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[0])
					statusInfo[1].should.be.bignumber.eq(endPrices[0])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(duration)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice)
						)
					)
				})
			})
		})

		describe('near the middle', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {
				expectedCurrentPrice =
					startPrices[0].minus(startPrices[0].minus(endPrices[0]).div(2))

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					expectedCurrentPrice.div(2)
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[1]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[1])
				await saleIdx.setTime(purchaseTimes[1]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[1])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[0])
					statusInfo[1].should.be.bignumber.eq(endPrices[0])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(duration / 2)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice)
						)
					)
				})
			})
		})

		describe('near the end', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {

				expectedCurrentPrice =
					startPrices[0].minus(
						startPrices[0].minus(endPrices[0])
							.times(web3.toBigNumber((duration - 1) / duration))
							.toFixed(0, 1)
					)

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					web3.toBigNumber(expectedCurrentPrice.div(2).toFixed(0, 1))
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[2]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[2])
				await saleIdx.setTime(purchaseTimes[2]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[2])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[0])
					statusInfo[1].should.be.bignumber.eq(endPrices[0])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(1)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
						)
					)
				})
			})
		})
	})

	describe('Prices 2 - (steep distribution)', async () => {

		beforeEach(async () => {
			let setPricesCalldata = await saleUtils.setStartAndEndPrices.call(
				startPrices[1], endPrices[1]
			).should.be.fulfilled
			setPricesCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, setPricesCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		after(async () => {
			let bal = await web3.eth.getBalance(teamWallet).toNumber()
			await web3.eth.sendTransaction(
				{ from: teamWallet, to: exec, value: bal, gasPrice: 0 }
			)
		})

		describe('near the beginning', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {
				expectedCurrentPrice = startPrices[1]

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					expectedCurrentPrice.div(2)
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[0]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[0])
				await saleIdx.setTime(purchaseTimes[0]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[0])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[1])
					statusInfo[1].should.be.bignumber.eq(endPrices[1])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(duration)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice)
						)
					)
				})
			})
		})

		describe('near the middle', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {
				expectedCurrentPrice =
					startPrices[1].minus(startPrices[1].minus(endPrices[1]).div(2))

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					expectedCurrentPrice.div(2)
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[1]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[1])
				await saleIdx.setTime(purchaseTimes[1]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[1])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[1])
					statusInfo[1].should.be.bignumber.eq(endPrices[1])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(duration / 2)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice)
						)
					)
				})
			})
		})

		describe('near the end', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {

				expectedCurrentPrice =
					startPrices[1].minus(
						startPrices[1].minus(endPrices[1])
							.times(web3.toBigNumber((duration - 1) / duration))
							.toFixed(0, 1)
					)

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					web3.toBigNumber(expectedCurrentPrice.div(2).toFixed(0, 1))
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[2]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[2])
				await saleIdx.setTime(purchaseTimes[2]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[2])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[1])
					statusInfo[1].should.be.bignumber.eq(endPrices[1])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(1)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
						)
					)
				})
			})
		})
	})

	describe('Prices 3 - (flat distribution)', async () => {

		beforeEach(async () => {
			let setPricesCalldata = await saleUtils.setStartAndEndPrices.call(
				startPrices[2], endPrices[2]
			).should.be.fulfilled
			setPricesCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, setPricesCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		after(async () => {
			let bal = await web3.eth.getBalance(teamWallet).toNumber()
			await web3.eth.sendTransaction(
				{ from: teamWallet, to: exec, value: bal, gasPrice: 0 }
			)
		})

		describe('near the beginning', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {
				expectedCurrentPrice = startPrices[2]

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					expectedCurrentPrice.div(2)
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[0]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[0])
				await saleIdx.setTime(purchaseTimes[0]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[0])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[2])
					statusInfo[1].should.be.bignumber.eq(endPrices[2])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(duration)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice)
						)
					)
				})
			})
		})

		describe('near the middle', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {
				expectedCurrentPrice =
					startPrices[2].minus(startPrices[2].minus(endPrices[2]).div(2))

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					expectedCurrentPrice.div(2)
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[1]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[1])
				await saleIdx.setTime(purchaseTimes[1]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[1])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[1])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[2])
					statusInfo[1].should.be.bignumber.eq(endPrices[2])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(duration / 2)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice)
						)
					)
				})
			})
		})

		describe('near the end', async () => {

			let expectedCurrentPrice

			let purchaseEvents
			let purchaseReturns

			let amounts = []

			beforeEach(async () => {

				expectedCurrentPrice =
					startPrices[2].minus(
						startPrices[2].minus(endPrices[2])
							.times(web3.toBigNumber((duration - 1) / duration))
							.toFixed(0, 1)
					)

				amounts = [
					expectedCurrentPrice,
					expectedCurrentPrice.times(2),
					web3.toBigNumber(expectedCurrentPrice.div(2).toFixed(0, 1))
				]

				purchaseEvents = []
				purchaseReturns = []

				await storage.setTime(purchaseTimes[2]).should.be.fulfilled
				let storedTime = await storage.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[2])
				await saleIdx.setTime(purchaseTimes[2]).should.be.fulfilled
				storedTime = await saleIdx.set_time.call().should.be.fulfilled
				storedTime.toNumber().should.be.eq(purchaseTimes[2])

				// First purchase, account 0; amount 0
				let returnedData = await storage.exec.call(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				let events = await storage.exec(
					purchasers[0], executionID, purchaseCalldata,
					{ from: exec, value: amounts[0] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Second purchase, account 1; amount 1
				returnedData = await storage.exec.call(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[1], executionID, purchaseCalldata,
					{ from: exec, value: amounts[1] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)

				// Third purchase, account 2; amount 2
				returnedData = await storage.exec.call(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).should.be.fulfilled
				purchaseReturns.push(returnedData)

				events = await storage.exec(
					purchasers[2], executionID, purchaseCalldata,
					{ from: exec, value: amounts[2] }
				).then((tx) => {
					return tx.receipt.logs
				})
				purchaseEvents.push(events)
			})

			describe('returned data', async () => {

				let returnedData

				describe('payment (#1)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[0]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#2)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[1]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})

				describe('payment (#3)', async () => {

					beforeEach(async () => {
						returnedData = purchaseReturns[2]
					})

					it('should return a tuple with 3 fields', async () => {
						returnedData.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						returnedData[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						returnedData[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						returnedData[2].toNumber().should.be.eq(6)
					})
				})
			})

			describe('events', async () => {

				let emittedEvents

				describe('event (#1)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[0]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[0].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#2)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[1]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[1].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})

				describe('event (#3)', async () => {

					beforeEach(async () => {
						emittedEvents = purchaseEvents[2]
					})

					it('should emit a total of 3 events', async () => {
						emittedEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[2].topics
							eventData = emittedEvents[2].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
						})

						it('should have the target app address and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(sale.address))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have an empty data field', async () => {
							web3.toDecimal(eventData).should.be.eq(0)
						})
					})

					describe('the DeliveredPayment event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[0].topics
							eventData = emittedEvents[0].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(3)
						})

						it('should list the correct event signature in the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
						})

						it('should have the payment destination and execution id as the other 2 topics', async () => {
							let emittedAddr = eventTopics[2]
							let emittedExecId = eventTopics[1]
							web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(teamWallet))
							web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
						})

						it('should have a data field containing the amount sent', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].toNumber())
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = emittedEvents[1].topics
							eventData = emittedEvents[1].data
						})

						it('should have the correct number of topics', async () => {
							eventTopics.length.should.be.eq(4)
						})

						it('should match the event signature for the first topic', async () => {
							let sig = eventTopics[0]
							web3.toDecimal(sig).should.be.eq(web3.toDecimal(purchaseHash))
						})

						it('should match the exec id, current sale rate, and current time for the other topics', async () => {
							web3.toDecimal(eventTopics[1]).should.be.eq(web3.toDecimal(executionID))
							web3.toDecimal(eventTopics[2]).should.be.eq(expectedCurrentPrice.toNumber())
							web3.toDecimal(eventTopics[3]).should.be.eq(purchaseTimes[2])
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(amounts[2].times(unitPrice).div(expectedCurrentPrice).toNumber())
						})
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
					)
				})

				it('should have 3 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(3)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[0]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[0].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the second purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[1]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[1].times(unitPrice).div(expectedCurrentPrice)
						)
					})

					it('should correctly store the third purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchasers[2]
						).should.be.fulfilled
						balanceInfo.should.be.bignumber.eq(
							amounts[2].times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
						)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.should.be.bignumber.eq(totalSupply)
				})

				it('should correctly update the total tokens sold', async () => {
					let soldInfo = await saleIdx.getTokensSold.call(
						storage.address, executionID
					).should.be.fulfilled
					soldInfo.should.be.bignumber.eq(
						amounts[0].plus(amounts[1]).plus(amounts[2])
							.times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
					)
				})

				it('should have the correct start and end times', async () => {
					let timeInfo = await saleIdx.getCrowdsaleStartAndEndTimes.call(
						storage.address, executionID
					).should.be.fulfilled
					timeInfo.length.should.be.eq(2)
					timeInfo[0].toNumber().should.be.eq(startTime)
					timeInfo[1].toNumber().should.be.eq(startTime + duration)
				})

				it('should correctly calculate the rate in InitCrowdsale', async () => {
					let statusInfo = await saleIdx.getCrowdsaleStatus.call(
						storage.address, executionID
					).should.be.fulfilled
					statusInfo.length.should.be.eq(6)

					statusInfo[0].should.be.bignumber.eq(startPrices[2])
					statusInfo[1].should.be.bignumber.eq(endPrices[2])
					statusInfo[2].should.be.bignumber.eq(expectedCurrentPrice)
					statusInfo[3].toNumber().should.be.eq(duration)
					statusInfo[4].toNumber().should.be.eq(1)
					statusInfo[5].should.be.bignumber.eq(
						sellCap.minus(
							amounts[0].plus(amounts[1]).plus(amounts[2])
								.times(unitPrice).div(expectedCurrentPrice).toFixed(0, 1)
						)
					)
				})
			})
		})
	})
})