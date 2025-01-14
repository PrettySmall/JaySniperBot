import axios, { AxiosHeaders } from 'axios';

import dotenv from 'dotenv';

import * as global from './global'

dotenv.config()

const header: AxiosHeaders = new AxiosHeaders()
header.set('accept', 'application/json')
header.set('x-chain', 'solana')
header.set('x-api-key', process.env.BIRDEYE_API_KEY)


// const birdeyeApi: any = require("api")("@birdeyedotso/v1.0#crnv83jlti6buqu");
// birdeyeApi.auth(process.env.BIRDEYE_API_KEY);

// export const getTokenDecimal = async (addr: string) => {
// 	try {
// 		const { data }: any = await birdeyeApi.getDefiToken_creation_info({ address: addr, 'x-chain': 'solana' })
// 		return { exist: true, decimal: data.data.decimals };
// 	} catch (error) {
// 		return { exist: false, decimal: 0 }
// 	}
// };

export const getTokenPriceInfo_Birdeye = async (addr: string) => {
	
	const url: string = `https://public-api.birdeye.so/defi/price?address=${addr}`

	try {
		const { data } = await axios.get(url, {  headers: header })

		if (data.success) {
			return data.data
		}	
	} catch (error) {
		console.log("getTokenPriceInfo_Birdeye error = " + error)	
	}	
	return null
}

export const getTokensInfo_InWallet = async (wallet: string) => {

	const url: string = `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`
	
	// console.log("[getTokensInfo_InWallet] = ", wallet)

	try {
		const { data } = await axios.get(url, {  headers: header })

		// console.log(data)

		if (data.success) {
			return data.data
		}	
	} catch (error) {
		console.log("getTokenPriceInfo_Birdeye error = ", error)	
	}	
	return null

}