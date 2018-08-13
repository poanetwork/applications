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

contract('#DutchBuyTokens - (standard price, 0 decimals)', function (accounts) {

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

	let startTime
	let totalSupply = 1100000 // 1.1 million units in existence
	let sellCap = 1000000   // 1 million units for sale
	let startPrice = 1000 // 1000 wei per token (1 token = [10 ** decimals] units)
	let endPrice = 100 // 100 wei per token
	let duration = 3600 // 1 hour
	let isWhitelisted = true
	let burnExcess = true

	let tokenName = 'Token'
	let tokenSymbol = 'TOK'
	let tokenDecimals = 0

	let purchaserList = [
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
		startTime = getTime() + 3600

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
			teamWallet, totalSupply, sellCap, startPrice, endPrice,
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

		await saleIdx.resetTime().should.be.fulfilled
		let storedTime = await saleIdx.set_time.call().should.be.fulfilled
		storedTime.toNumber().should.be.eq(0)

		await storage.resetTime().should.be.fulfilled
		storedTime = await storage.set_time.call().should.be.fulfilled
		storedTime.toNumber().should.be.eq(0)

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
	})

	describe('pre-test-storage', async() => {

		it('should be an uninitialized crowdsale', async () => {
			let saleInfo = await saleIdx.getCrowdsaleInfo.call(
				storage.address, executionID
			).should.be.fulfilled
			saleInfo.length.should.be.eq(6)

			saleInfo[0].toNumber().should.be.eq(0)
			saleInfo[1].should.be.eq(teamWallet)
			saleInfo[2].toNumber().should.be.eq(0)
			saleInfo[3].should.be.eq(false)
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
			tokenInfo[3].toNumber().should.be.eq(totalSupply)
		})
	})

	describe('no wei sent', async () => {

		let invalidCalldata

		beforeEach(async () => {
			let initCrowdsaleCalldata = await saleUtils.initializeCrowdsale.call().should.be.fulfilled
			initCrowdsaleCalldata.should.not.eq('0x')

			invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
			invalidCalldata.should.not.eq('0x')

			await storage.setTime(startTime).should.be.fulfilled
			let tInfo = await storage.getTime.call().should.be.fulfilled
			tInfo.toNumber().should.be.eq(startTime)

			let events = await storage.exec(
				crowdsaleAdmin, executionID, initCrowdsaleCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		it('should throw', async () => {
			await storage.exec(
				crowdsaleAdmin, executionID, invalidCalldata,
				{ from: exec }
			).should.not.be.fulfilled
		})
	})

	describe('crowdsale is not initialized', async () => {

		let invalidCalldata

		let valueSent = startPrice // Send enough for at least one token

		beforeEach(async () => {
			// Fast-forward to start time
			await storage.setTime(startTime).should.be.fulfilled
			let storedTime = await storage.getTime.call().should.be.fulfilled
			storedTime.toNumber().should.be.eq(startTime)

			invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
			invalidCalldata.should.not.eq('0x')
		})

		it('should throw', async () => {
			await storage.exec(
				crowdsaleAdmin, executionID, invalidCalldata,
				{ from: exec, value: valueSent }
			).should.not.be.fulfilled
		})
	})

	describe('crowdsale is already finalized', async () => {

		let invalidCalldata

		let valueSent = startPrice // Send enough for at least one token

		beforeEach(async () => {
			// Fast-forward to start time
			await storage.setTime(startTime).should.be.fulfilled
			let storedTime = await storage.getTime.call().should.be.fulfilled
			storedTime.toNumber().should.be.eq(startTime)

			let initCrowdsaleCalldata
				= await saleUtils.initializeCrowdsale.call().should.be.fulfilled
			initCrowdsaleCalldata.should.not.eq('0x')

			let finalizeCalldata
				= await saleUtils.finalizeCrowdsale.call().should.be.fulfilled
			finalizeCalldata.should.not.eq('0x')

			invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
			invalidCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, initCrowdsaleCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')

			events = await storage.exec(
				crowdsaleAdmin, executionID, finalizeCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		it('should throw', async () => {
			await storage.exec(
				crowdsaleAdmin, executionID, invalidCalldata,
				{ from: exec, value: valueSent }
			).should.not.be.fulfilled
		})
	})

	describe('crowdsale has not started', async () => {

		let invalidCalldata

		let valueSent = startPrice // Send enough for at least one token

		beforeEach(async () => {
			invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
			invalidCalldata.should.not.eq('0x')

			await storage.resetTime().should.be.fulfilled
		})

		it('should throw', async () => {
			await storage.exec(
				crowdsaleAdmin, executionID, invalidCalldata,
				{ from: exec, value: valueSent }
			).should.not.be.fulfilled
		})
	})

	describe('crowdsale has already ended', async () => {

		let invalidCalldata

		let valueSent = startPrice // Send enough for at least one token

		beforeEach(async () => {
			// Fast-forward to time after crowdsale end
			await storage.setTime(startTime + duration).should.be.fulfilled
			let storedTime = await storage.getTime.call().should.be.fulfilled
			storedTime.toNumber().should.be.eq(startTime + duration)

			let initCrowdsaleCalldata = await saleUtils.initializeCrowdsale.call().should.be.fulfilled
			initCrowdsaleCalldata.should.not.eq('0x')

			invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
			invalidCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, initCrowdsaleCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		it('should throw', async () => {
			await storage.exec(
				crowdsaleAdmin, executionID, invalidCalldata,
				{ from: exec, value: valueSent }
			).should.not.be.fulfilled
		})
	})

	describe('sale has sold out', async () => {

		let invalidCalldata

		let valueSent = startPrice // Send enough for at least one token

		beforeEach(async () => {
			// Fast-forward to crowdsale start
			await storage.setTime(startTime).should.be.fulfilled
			let storedTime = await storage.getTime.call().should.be.fulfilled
			storedTime.toNumber().should.be.eq(startTime)

			let clearTokensCalldata = await saleUtils.setTokensRemaining.call(0).should.be.fulfilled
			clearTokensCalldata.should.not.eq('0x')

			let initCrowdsaleCalldata = await saleUtils.initializeCrowdsale.call().should.be.fulfilled
			initCrowdsaleCalldata.should.not.eq('0x')

			invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
			invalidCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, initCrowdsaleCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')

			events = await storage.exec(
				crowdsaleAdmin, executionID, clearTokensCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')
		})

		it('should throw', async () => {
			await storage.exec(
				crowdsaleAdmin, executionID, invalidCalldata,
				{ from: exec, value: valueSent }
			).should.not.be.fulfilled
		})
	})

	describe('whitelist-enabled', async () => {

		beforeEach(async () => {
			let setWhitelistedCalldata = await saleUtils.setSaleIsWhitelisted.call(true).should.be.fulfilled
			setWhitelistedCalldata.should.not.eq('0x')

			let initCrowdsaleCalldata = await saleUtils.initializeCrowdsale.call().should.be.fulfilled
			initCrowdsaleCalldata.should.not.eq('0x')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, initCrowdsaleCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')

			events = await storage.exec(
				crowdsaleAdmin, executionID, setWhitelistedCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')

			// Fast-forward to start time
			await storage.setTime(startTime).should.be.fulfilled
			let storedTime = await storage.set_time.call().should.be.fulfilled
			storedTime.toNumber().should.be.eq(startTime)
		})

		context('sender is not whitelisted', async () => {

			let invalidCalldata

			let valueSent = startPrice

			beforeEach(async () => {
				invalidCalldata = await saleUtils.buy.call().should.be.fulfilled
				invalidCalldata.should.not.eq('0x')
			})

			it('should throw', async () => {
				await storage.exec(
					crowdsaleAdmin, executionID, invalidCalldata,
					{ from: exec, value: valueSent }
				).should.not.be.fulfilled
			})
		})

		context('sender is whitelisted', async () => {

			// Each whitelisted address must purchase minimum 10 tokens initially
			let purchaserMinimums = [10, 10, 10]
			// Maximum amounts each address may purchase (tokens) over the course of the sale:
			let purchaserMaximums = [1000, 100, 11]

			beforeEach(async () => {
				let whitelistCalldata = await saleUtils.whitelistMulti.call(
					purchaserList, purchaserMinimums, purchaserMaximums
				).should.be.fulfilled
				whitelistCalldata.should.not.eq('0x')

				let events = await storage.exec(
					crowdsaleAdmin, executionID, whitelistCalldata,
					{ from: exec }
				).then((tx) => {
					return tx.logs
				})
				events.should.not.eq(null)
				events.length.should.be.eq(1)
				events[0].event.should.be.eq('ApplicationExecution')
			})

			describe('pre-purchase storage', async () => {

				it('should have correctly whitelisted the first purchaser', async () => {
					let whitelistInfo = await saleIdx.getWhitelistStatus.call(
						storage.address, executionID, purchaserList[0]
					).should.be.fulfilled
					whitelistInfo.length.should.be.eq(2)
					whitelistInfo[0].toNumber().should.be.eq(purchaserMinimums[0])
					whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[0])
				})

				it('should have correctly whitelisted the second purchaser', async () => {
					let whitelistInfo = await saleIdx.getWhitelistStatus.call(
						storage.address, executionID, purchaserList[1]
					).should.be.fulfilled
					whitelistInfo.length.should.be.eq(2)
					whitelistInfo[0].toNumber().should.be.eq(purchaserMinimums[1])
					whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[1])
				})

				it('should have correctly whitelisted the third purchaser', async () => {
					let whitelistInfo = await saleIdx.getWhitelistStatus.call(
						storage.address, executionID, purchaserList[2]
					).should.be.fulfilled
					whitelistInfo.length.should.be.eq(2)
					whitelistInfo[0].toNumber().should.be.eq(purchaserMinimums[2])
					whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[2])
				})

				it('should have a whitelist of length 3', async () => {
					let tierWhitelistInfo = await saleIdx.getCrowdsaleWhitelist.call(
						storage.address, executionID
					).should.be.fulfilled
					tierWhitelistInfo.length.should.be.eq(2)
					tierWhitelistInfo[0].toNumber().should.be.eq(3)
					tierWhitelistInfo[1].length.should.be.eq(3)
					tierWhitelistInfo[1].should.be.eql(purchaserList)
				})

				it('should have 0 unique buyers', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(0)
				})

				it('should correctly store the first purchaser\'s balance as 0', async () => {
					let balanceInfo = await saleIdx.balanceOf.call(
						storage.address, executionID, purchaserList[0]
					).should.be.fulfilled
					balanceInfo.toNumber().should.be.eq(0)
				})

				it('should correctly store the second purchaser\'s balance as 0', async () => {
					let balanceInfo = await saleIdx.balanceOf.call(
						storage.address, executionID, purchaserList[1]
					).should.be.fulfilled
					balanceInfo.toNumber().should.be.eq(0)
				})

				it('should correctly store the third purchaser\'s balance as 0', async () => {
					let balanceInfo = await saleIdx.balanceOf.call(
						storage.address, executionID, purchaserList[2]
					).should.be.fulfilled
					balanceInfo.toNumber().should.be.eq(0)
				})

				it('should have the correct amount of wei raised as 0', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].toNumber().should.be.eq(0)
				})
			})

			context('multiple consecutive spends', async () => {

				let initialSpends = [
					startPrice * purchaserMinimums[0],
					startPrice * purchaserMinimums[1],
					startPrice * purchaserMinimums[2]
				]

				let purchaseCalldata
				let paymentEvents
				let paymentReturns

				beforeEach(async () => {
					paymentEvents = []
					paymentReturns = []

					purchaseCalldata = await saleUtils.buy.call().should.be.fulfilled

					let returnValues = await storage.exec.call(
						purchaserList[0], executionID, purchaseCalldata,
						{ from: exec, value: initialSpends[0] }
					).should.be.fulfilled
					paymentReturns.push(returnValues)

					let events = await storage.exec(
						purchaserList[0], executionID, purchaseCalldata,
						{ from: exec, value: initialSpends[0] }
					).then((tx) => {
						return tx.receipt.logs
					})
					paymentEvents.push(events)

					returnValues = await storage.exec.call(
						purchaserList[1], executionID, purchaseCalldata,
						{ from: exec, value: initialSpends[1] }
					).should.be.fulfilled
					paymentReturns.push(returnValues)

					events = await storage.exec(
						purchaserList[1], executionID, purchaseCalldata,
						{ from: exec, value: initialSpends[1] }
					).then((tx) => {
						return tx.receipt.logs
					})
					paymentEvents.push(events)

					returnValues = await storage.exec.call(
						purchaserList[2], executionID, purchaseCalldata,
						{ from: exec, value: initialSpends[2] }
					).should.be.fulfilled
					paymentReturns.push(returnValues)

					events = await storage.exec(
						purchaserList[2], executionID, purchaseCalldata,
						{ from: exec, value: initialSpends[2] }
					).then((tx) => {
						return tx.receipt.logs
					})
					paymentEvents.push(events)

					paymentEvents.length.should.be.eq(3)
					paymentReturns.length.should.be.eq(3)
				})

				describe('returned data', async () => {

					let returnedData

					describe('payment (#1)', async () => {

						beforeEach(async () => {
							returnedData = paymentReturns[0]
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
							returnedData[2].toNumber().should.be.eq(8)
						})
					})

					describe('payment (#2)', async () => {

						beforeEach(async () => {
							returnedData = paymentReturns[1]
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
							returnedData[2].toNumber().should.be.eq(8)
						})
					})

					describe('payment (#3)', async () => {

						beforeEach(async () => {
							returnedData = paymentReturns[2]
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
							returnedData[2].toNumber().should.be.eq(8)
						})
					})
				})

				describe('events', async () => {

					let emittedEvents

					describe('event (#1)', async () => {

						beforeEach(async () => {
							emittedEvents = paymentEvents[0]
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
								web3.toDecimal(eventData).should.be.eq(initialSpends[0])
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
								web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
								web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
							})

							it('should contain the number of tokens purchased in the data field', async () => {
								web3.toDecimal(eventData).should.be.eq(purchaserMinimums[0])
							})
						})
					})

					describe('event (#2)', async () => {

						beforeEach(async () => {
							emittedEvents = paymentEvents[1]
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
								web3.toDecimal(eventData).should.be.eq(initialSpends[1])
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
								web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
								web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
							})

							it('should contain the number of tokens purchased in the data field', async () => {
								web3.toDecimal(eventData).should.be.eq(purchaserMinimums[1])
							})
						})
					})

					describe('event (#3)', async () => {

						beforeEach(async () => {
							emittedEvents = paymentEvents[2]
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
								web3.toDecimal(eventData).should.be.eq(initialSpends[2])
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
								web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
								web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
							})

							it('should contain the number of tokens purchased in the data field', async () => {
								web3.toDecimal(eventData).should.be.eq(purchaserMinimums[2])
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
						crowdsaleInfo[0].toNumber().should.be.eq(
							initialSpends[0] + initialSpends[1] + initialSpends[2]
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
								storage.address, executionID, purchaserList[0]
							).should.be.fulfilled
							balanceInfo.toNumber().should.be.eq(initialSpends[0] / startPrice)
						})

						it('should correctly store the second purchaser\'s balance', async () => {
							let balanceInfo = await saleIdx.balanceOf.call(
								storage.address, executionID, purchaserList[1]
							).should.be.fulfilled
							balanceInfo.toNumber().should.be.eq(initialSpends[1] / startPrice)
						})

						it('should correctly store the third purchaser balance', async () => {
							let balanceInfo = await saleIdx.balanceOf.call(
								storage.address, executionID, purchaserList[2]
							).should.be.fulfilled
							balanceInfo.toNumber().should.be.eq(initialSpends[2] / startPrice)
						})
					})

					describe('whitelist information', async () => {

						it('should correctly update the first purchaser\'s whitelist information', async () => {
							let whitelistInfo = await saleIdx.getWhitelistStatus.call(
								storage.address, executionID, purchaserList[0]
							).should.be.fulfilled
							whitelistInfo.length.should.be.eq(2)
							whitelistInfo[0].toNumber().should.be.eq(0)
							whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[0] - (initialSpends[0] / startPrice))
						})

						it('should correctly update the second purchaser\'s whitelist information', async () => {
							let whitelistInfo = await saleIdx.getWhitelistStatus.call(
								storage.address, executionID, purchaserList[1]
							).should.be.fulfilled
							whitelistInfo.length.should.be.eq(2)
							whitelistInfo[0].toNumber().should.be.eq(0)
							whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[1] - (initialSpends[1] / startPrice))
						})

						it('should correctly update the third purchaser\'s whitelist information', async () => {
							let whitelistInfo = await saleIdx.getWhitelistStatus.call(
								storage.address, executionID, purchaserList[2]
							).should.be.fulfilled
							whitelistInfo.length.should.be.eq(2)
							whitelistInfo[0].toNumber().should.be.eq(0)
							whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[2] - (initialSpends[2] / startPrice))
						})
					})

					it('should have the same token total supply', async () => {
						let supplyInfo = await saleIdx.totalSupply.call(
							storage.address, executionID
						).should.be.fulfilled
						supplyInfo.toNumber().should.be.eq(totalSupply)
					})
				})

				context('sender did not spend over their maximum spend amount', async () => {

					let newSendEvent

					beforeEach(async () => {
						let events = await storage.exec(
							purchaserList[0], executionID, purchaseCalldata,
							{ from: exec, value: startPrice }
						).then((tx) => {
							return tx.logs
						})
						events.should.not.eq(null)
						events.length.should.be.eq(2)
						newSendEvent = events[1]
					})

					it('should allow another purchase by the same sender', async () => {
						newSendEvent.event.should.be.eq('ApplicationExecution')
					})
				})

				describe('sender spending over their maximum spend amount', async () => {

					let maxSpendAmount

					let newSpendAmount
					let newSpendEvents
					let newSpendReturn

					beforeEach(async () => {

						newSpendAmount = startPrice + (startPrice * (purchaserMaximums[0] - (initialSpends[0] / startPrice)))
						maxSpendAmount = startPrice * (purchaserMaximums[0] - (initialSpends[0] / startPrice))

						newSpendReturn = await storage.exec.call(
							purchaserList[0], executionID, purchaseCalldata,
							{ from: exec, value: newSpendAmount }
						).should.be.fulfilled

						newSpendEvents = await storage.exec(
							purchaserList[0], executionID, purchaseCalldata,
							{ from: exec, value: newSpendAmount }
						).then((tx) => {
							return tx.receipt.logs
						})
					})

					describe('returned data', async () => {

						it('should return a tuple with 3 fields', async () => {
							newSpendReturn.length.should.be.eq(3)
						})

						it('should return the correct number of events emitted', async () => {
							newSpendReturn[0].toNumber().should.be.eq(1)
						})

						it('should return the correct number of addresses paid', async () => {
							newSpendReturn[1].toNumber().should.be.eq(1)
						})

						it('should return the correct number of storage slots written to', async () => {
							newSpendReturn[2].toNumber().should.be.eq(6)
						})
					})

					describe('events', async () => {

						it('should emit a total of 3 events', async () => {
							newSpendEvents.length.should.be.eq(3)
						})

						describe('the ApplicationExecution event', async () => {

							let eventTopics
							let eventData

							beforeEach(async () => {
								eventTopics = newSpendEvents[2].topics
								eventData = newSpendEvents[2].data
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
								eventTopics = newSpendEvents[0].topics
								eventData = newSpendEvents[0].data
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
								web3.toDecimal(eventData).should.be.eq(maxSpendAmount)
							})
						})

						describe('the other event', async () => {

							let eventTopics
							let eventData

							beforeEach(async () => {
								eventTopics = newSpendEvents[1].topics
								eventData = newSpendEvents[1].data
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
								web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
								web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
							})

							it('should contain the number of tokens purchased in the data field', async () => {
								web3.toDecimal(eventData).should.be.eq(maxSpendAmount / startPrice)
							})
						})
					})

					describe('storage', async () => {

						it('should have the correct amount of wei raised', async () => {
							let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
								storage.address, executionID
							).should.be.fulfilled
							crowdsaleInfo.length.should.be.eq(6)
							crowdsaleInfo[0].toNumber().should.be.eq(
								initialSpends[0] + initialSpends[1] + initialSpends[2] + maxSpendAmount
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
									storage.address, executionID, purchaserList[0]
								).should.be.fulfilled
								balanceInfo.toNumber().should.be.eq(
									(initialSpends[0] + maxSpendAmount) / startPrice
								)
							})

							it('should correctly store the second purchaser\'s balance', async () => {
								let balanceInfo = await saleIdx.balanceOf.call(
									storage.address, executionID, purchaserList[1]
								).should.be.fulfilled
								balanceInfo.toNumber().should.be.eq(initialSpends[1] / startPrice)
							})

							it('should have a 0 balance for the third purchaser', async () => {
								let balanceInfo = await saleIdx.balanceOf.call(
									storage.address, executionID, purchaserList[2]
								).should.be.fulfilled
								balanceInfo.toNumber().should.be.eq(initialSpends[2] / startPrice)
							})
						})

						describe('whitelist information', async () => {

							it('should correctly update the first purchaser\'s whitelist information', async () => {
								let whitelistInfo = await saleIdx.getWhitelistStatus.call(
									storage.address, executionID, purchaserList[0]
								).should.be.fulfilled
								whitelistInfo.length.should.be.eq(2)
								whitelistInfo[0].toNumber().should.be.eq(0)
								whitelistInfo[1].toNumber().should.be.eq(0)
							})

							it('should not have updated the second purchaser\'s whitelist information', async () => {
								let whitelistInfo = await saleIdx.getWhitelistStatus.call(
									storage.address, executionID, purchaserList[1]
								).should.be.fulfilled
								whitelistInfo.length.should.be.eq(2)
								whitelistInfo[0].toNumber().should.be.eq(0)
								whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[1] - (initialSpends[1] / startPrice))
							})

							it('should not have updated the third purchaser\'s whitelist information', async () => {
								let whitelistInfo = await saleIdx.getWhitelistStatus.call(
									storage.address, executionID, purchaserList[2]
								).should.be.fulfilled
								whitelistInfo.length.should.be.eq(2)
								whitelistInfo[0].toNumber().should.be.eq(0)
								whitelistInfo[1].toNumber().should.be.eq(purchaserMaximums[2] - (initialSpends[2] / startPrice))
							})
						})

						it('should have the same token total supply', async () => {
							let supplyInfo = await saleIdx.totalSupply.call(
								storage.address, executionID
							).should.be.fulfilled
							supplyInfo.toNumber().should.be.eq(totalSupply)
						})
					})

					it('should disallow further purchases from the same sender', async () => {
						await storage.exec(
							purchaserList[0], executionID, purchaseCalldata,
							{ from: exec, value: startPrice }
						).should.not.be.fulfilled
					})
				})
			})
		})
	})

	describe('non-whitelist-enabled', async () => {

		let purchaseCalldata

		beforeEach(async () => {
			let setWhitelistedCalldata = await saleUtils.setSaleIsWhitelisted.call(false).should.be.fulfilled
			setWhitelistedCalldata.should.not.eq('0x')

			let initCrowdsaleCalldata = await saleUtils.initializeCrowdsale.call().should.be.fulfilled
			initCrowdsaleCalldata.should.not.eq('0x')

			purchaseCalldata = await saleUtils.buy.call().should.be.fulfilled
			purchaseCalldata.should.not.eq('0x0')

			let events = await storage.exec(
				crowdsaleAdmin, executionID, initCrowdsaleCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')

			events = await storage.exec(
				crowdsaleAdmin, executionID, setWhitelistedCalldata,
				{ from: exec }
			).then((tx) => {
				return tx.logs
			})
			events.should.not.eq(null)
			events.length.should.be.eq(1)
			events[0].event.should.be.eq('ApplicationExecution')

			// Fast-forward to start time
			await storage.setTime(startTime).should.be.fulfilled
			let storedTime = await storage.set_time.call().should.be.fulfilled
			storedTime.toNumber().should.be.eq(startTime)
		})

		context('global minimum exists', async () => {

			let initialPurchaseEvents
			let initialPurchaseReturn

			let nextPurchaseEvents
			let nextPurchaseReturn

			let invalidPurchaseEvent
			let invalidPurchaseReturn

			let globalMin = 10 // 10 token minimum purchase
			let spendAmount = startPrice * globalMin

			beforeEach(async () => {
				let updateMinCalldata = await saleUtils.updateGlobalMin.call(
					globalMin
				).should.be.fulfilled
				updateMinCalldata.should.not.eq('0x')

				let events = await storage.exec(
					crowdsaleAdmin, executionID, updateMinCalldata,
					{ from: exec }
				).then((tx) => {
					return tx.logs
				})
				events.should.not.eq(null)
				events.length.should.be.eq(1)
				events[0].event.should.be.eq('ApplicationExecution')

				initialPurchaseReturn = await storage.exec.call(
					purchaserList[0], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount }
				).should.be.fulfilled
				initialPurchaseEvents = await storage.exec(
					purchaserList[0], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount }
				).then((tx) => {
					return tx.receipt.logs
				})

				nextPurchaseReturn = await storage.exec.call(
					purchaserList[0], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount }
				).should.be.fulfilled
				nextPurchaseEvents = await storage.exec(
					purchaserList[0], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount }
				).then((tx) => {
					return tx.receipt.logs
				})
			})

			it('should disallow the purchaser sending under the minimum', async () => {
				await storage.exec(
					purchaserList[1], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount - 1 }
				).should.not.be.fulfilled
			})

			context('sender has contributed before', async () => {

				describe('returned data', async () => {

					it('should return a tuple with 3 fields', async () => {
						nextPurchaseReturn.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						nextPurchaseReturn[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						nextPurchaseReturn[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						nextPurchaseReturn[2].toNumber().should.be.eq(4)
					})
				})

				describe('events', async () => {

					it('should emit a total of 3 events', async () => {
						nextPurchaseEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = nextPurchaseEvents[2].topics
							eventData = nextPurchaseEvents[2].data
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
							eventTopics = nextPurchaseEvents[0].topics
							eventData = nextPurchaseEvents[0].data
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
							web3.toDecimal(eventData).should.be.eq(spendAmount)
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = nextPurchaseEvents[1].topics
							eventData = nextPurchaseEvents[1].data
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
							web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(spendAmount / startPrice)
						})
					})
				})

				describe('storage', async () => {

					it('should have the correct amount of wei raised', async () => {
						let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
							storage.address, executionID
						).should.be.fulfilled
						crowdsaleInfo.length.should.be.eq(6)
						crowdsaleInfo[0].toNumber().should.be.eq(spendAmount * 2)
					})

					it('should have 1 unique buyer', async () => {
						let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
							storage.address, executionID
						).should.be.fulfilled
						uniqueInfo.toNumber().should.be.eq(1)
					})

					describe('token balances', async () => {

						it('should correctly store the initial purchaser\'s balance', async () => {
							let balanceInfo = await saleIdx.balanceOf.call(
								storage.address, executionID, purchaserList[0]
							).should.be.fulfilled
							balanceInfo.toNumber().should.be.eq(globalMin * 2)
						})
					})

					it('should have the same token total supply', async () => {
						let supplyInfo = await saleIdx.totalSupply.call(
							storage.address, executionID
						).should.be.fulfilled
						supplyInfo.toNumber().should.be.eq(totalSupply)
					})
				})
			})

			context('sender has not contributed before', async () => {

				describe('returned data', async () => {

					it('should return a tuple with 3 fields', async () => {
						initialPurchaseReturn.length.should.be.eq(3)
					})

					it('should return the correct number of events emitted', async () => {
						initialPurchaseReturn[0].toNumber().should.be.eq(1)
					})

					it('should return the correct number of addresses paid', async () => {
						initialPurchaseReturn[1].toNumber().should.be.eq(1)
					})

					it('should return the correct number of storage slots written to', async () => {
						initialPurchaseReturn[2].toNumber().should.be.eq(6)
					})
				})

				describe('events', async () => {

					it('should emit a total of 3 events', async () => {
						initialPurchaseEvents.length.should.be.eq(3)
					})

					describe('the ApplicationExecution event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = initialPurchaseEvents[2].topics
							eventData = initialPurchaseEvents[2].data
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
							eventTopics = initialPurchaseEvents[0].topics
							eventData = initialPurchaseEvents[0].data
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
							web3.toDecimal(eventData).should.be.eq(spendAmount)
						})
					})

					describe('the other event', async () => {

						let eventTopics
						let eventData

						beforeEach(async () => {
							eventTopics = initialPurchaseEvents[1].topics
							eventData = initialPurchaseEvents[1].data
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
							web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
							web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
						})

						it('should contain the number of tokens purchased in the data field', async () => {
							web3.toDecimal(eventData).should.be.eq(spendAmount / startPrice)
						})
					})
				})

				describe('storage', async () => {

					it('should have the correct amount of wei raised', async () => {
						let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
							storage.address, executionID
						).should.be.fulfilled
						crowdsaleInfo.length.should.be.eq(6)
						crowdsaleInfo[0].toNumber().should.be.eq(spendAmount * 2)
					})

					it('should have 1 unique buyer', async () => {
						let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
							storage.address, executionID
						).should.be.fulfilled
						uniqueInfo.toNumber().should.be.eq(1)
					})

					describe('token balances', async () => {

						it('should correctly store the initial purchaser\'s balance', async () => {
							let balanceInfo = await saleIdx.balanceOf.call(
								storage.address, executionID, purchaserList[0]
							).should.be.fulfilled
							balanceInfo.toNumber().should.be.eq(globalMin * 2)
						})
					})

					it('should have the same token total supply', async () => {
						let supplyInfo = await saleIdx.totalSupply.call(
							storage.address, executionID
						).should.be.fulfilled
						supplyInfo.toNumber().should.be.eq(totalSupply)
					})
				})
			})
		})

		context('sender purchases all remaining tokens', async () => {

			let spendAmount
			let purchaseEvents
			let purchaseReturn

			beforeEach(async () => {
				spendAmount = (startPrice * sellCap) + startPrice

				purchaseReturn = await storage.exec.call(
					purchaserList[0], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount }
				).should.be.fulfilled

				purchaseEvents = await storage.exec(
					purchaserList[0], executionID, purchaseCalldata,
					{ from: exec, value: spendAmount }
				).then((tx) => {
					return tx.receipt.logs
				})
			})

			describe('returned data', async () => {

				it('should return a tuple with 3 fields', async () => {
					purchaseReturn.length.should.be.eq(3)
				})

				it('should return the correct number of events emitted', async () => {
					purchaseReturn[0].toNumber().should.be.eq(1)
				})

				it('should return the correct number of addresses paid', async () => {
					purchaseReturn[1].toNumber().should.be.eq(1)
				})

				it('should return the correct number of storage slots written to', async () => {
					purchaseReturn[2].toNumber().should.be.eq(6)
				})
			})

			describe('events', async () => {

				it('should emit a total of 3 events', async () => {
					purchaseEvents.length.should.be.eq(3)
				})

				describe('the ApplicationExecution event', async () => {

					let eventTopics
					let eventData

					beforeEach(async () => {
						eventTopics = purchaseEvents[2].topics
						eventData = purchaseEvents[2].data
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
						eventTopics = purchaseEvents[0].topics
						eventData = purchaseEvents[0].data
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
						web3.toDecimal(eventData).should.be.eq(spendAmount - startPrice)
					})
				})

				describe('the other event', async () => {

					let eventTopics
					let eventData

					beforeEach(async () => {
						eventTopics = purchaseEvents[1].topics
						eventData = purchaseEvents[1].data
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
						web3.toDecimal(eventTopics[2]).should.be.eq(startPrice)
						web3.toDecimal(eventTopics[3]).should.be.eq(startTime)
					})

					it('should contain the number of tokens purchased in the data field', async () => {
						web3.toDecimal(eventData).should.be.eq((spendAmount - startPrice) / startPrice)
					})
				})
			})

			describe('storage', async () => {

				it('should have the correct amount of wei raised', async () => {
					let crowdsaleInfo = await saleIdx.getCrowdsaleInfo.call(
						storage.address, executionID
					).should.be.fulfilled
					crowdsaleInfo.length.should.be.eq(6)
					crowdsaleInfo[0].toNumber().should.be.eq(spendAmount - startPrice)
				})

				it('should have 1 unique buyer', async () => {
					let uniqueInfo = await saleIdx.getCrowdsaleUniqueBuyers.call(
						storage.address, executionID
					).should.be.fulfilled
					uniqueInfo.toNumber().should.be.eq(1)
				})

				describe('token balances', async () => {

					it('should correctly store the initial purchaser\'s balance', async () => {
						let balanceInfo = await saleIdx.balanceOf.call(
							storage.address, executionID, purchaserList[0]
						).should.be.fulfilled
						balanceInfo.toNumber().should.be.eq(sellCap)
					})
				})

				it('should have the same token total supply', async () => {
					let supplyInfo = await saleIdx.totalSupply.call(
						storage.address, executionID
					).should.be.fulfilled
					supplyInfo.toNumber().should.be.eq(totalSupply)
				})
			})
		})
	})
})