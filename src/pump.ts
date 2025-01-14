import { HttpProvider, BaseProvider, GrpcProvider, MAINNET_API_GRPC_PORT } from "@bloxroute/solana-trader-client-ts";

import dotenv from 'dotenv';
dotenv.config();

// import colors from 'colors'

const PUMP_GRPC = "pump-ny.solana.dex.blxrbdn.com"

const pump_provider = new GrpcProvider(
    String(process.env.BLOXROUTE_AUTH_HEADER),
    String(process.env.PRIVATE_KEY),
    `${PUMP_GRPC}:${MAINNET_API_GRPC_PORT}`,
    true
)

async function main() {
    await callGetPumpFunNewTokensStream(pump_provider)
}

async function callGetPumpFunNewTokensStream(provider: BaseProvider) {
    console.info("Subscribing for pump fun new tokens")
    const req = await provider.getPumpFunNewTokensStream({})

    // console.log(req)

    let count = 0
    let mint = ""
    for await (const ob of req) {
        // console.info(ob)
        count++
        mint = ob.mint
        // if (count == 1) {
        //     break
        // }

        console.info(`[${ob.symbol}] : ${ob.mint} --> ${new Date(Number(ob.timestamp?.seconds) * 1000).toISOString()}`)
        // console.log(colors.magenta(${isOhio?'Ohiofun':'Raydium'} buy-machine started!))
    }

    console.info(" ")
    console.info(" ")

    // console.info("Subscribing for pump fun swap events")
    // const reqq = await provider.getPumpFunSwapsStream({ tokens: [mint] })

    // count = 0
    // for await (const ob of reqq) {
    //     console.info(ob)
    //     count++
    //     if (count == 1) {
    //         break
    //     }
    // }
}

main().then(() => {
    console.log("Finished")
    process.exit(0)
})