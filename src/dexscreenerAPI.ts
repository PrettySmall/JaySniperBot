import * as utils from './utils';
import * as global from './global'

const DEXSCREEN_API: string = "https://api.dexscreener.com/latest/dex/tokens/"

export const getPoolInfo = async (addr: string) => {
	const url: string = DEXSCREEN_API + addr
	const res = await utils.fetchAPI(url, "GET")
	if (!res.pairs) {
		return null
	}

	for (let pairInfo of res.pairs) {
		if (pairInfo.chainId == global.get_chain_name()) {
			const data: any = {}
			data.dex = pairInfo.dexId
			data.dexURL = pairInfo.url
			data.symbol = pairInfo.baseToken.symbol
			data.name = pairInfo.baseToken.name
			data.addr = pairInfo.baseToken.address
			data.price = pairInfo.priceUsd
			data.volume = pairInfo.volume.m5
			data.priceChange = pairInfo.priceChange.m5
			if (pairInfo.liquidity != undefined)
			{
				data.liquidity = pairInfo.liquidity.usd
				data.pooledSOL = pairInfo.liquidity.quote
			}
			
			data.mc = pairInfo.fdv
			return data
		}	
		// else if (pairInfo.chainId == "base") {
		// 	const data: any = {}
		// 	data.dex = pairInfo.dexId
		// 	data.dexURL = pairInfo.url
		// 	data.symbol = pairInfo.baseToken.symbol
		// 	data.addr = pairInfo.baseToken.address
		// 	data.price = pairInfo.priceUsd
		// 	data.volume = pairInfo.volume.m5
		// 	data.priceChange = pairInfo.priceChange.m5
		// 	data.liquidity = pairInfo.liquidity.usd
		// 	data.pooledSOL = pairInfo.liquidity.quote
		// 	data.mc = pairInfo.fdv
		// 	return data
		// }
	}
	return null
}