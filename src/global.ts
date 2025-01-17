import dotenv from 'dotenv';

import { ENV } from '@solana/spl-token-registry';
import { Connection } from '@solana/web3.js';

dotenv.config()

export const NOT_ASSIGNED = '- Not assigned -'

export const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS

export const rankingEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

export const errorLog = (summary: string, error: any): void => {
    if (error?.response?.body?.description) {
        console.log('\x1b[31m%s\x1b[0m', `[error] ${summary} ${error.response.body.description}`);
    } else {
        console.log('\x1b[31m%s\x1b[0m', `[error] ${summary} ${error}`);
    }
};

export const parseError = (error: any): string => {
    let msg = '';
    try {
        error = JSON.parse(JSON.stringify(error));
        msg =
            error?.error?.reason ||
            error?.reason ||
            JSON.parse(error)?.error?.error?.response?.error?.message ||
            error?.response ||
            error?.message ||
            error;
    } catch (_error) {
        msg = error;
    }

    return msg;
};

export let FREE_TO_USE = Number(process.env.FREE_TO_USE)

export const TradingMonitorDuration = 24 * 60 * 60
export const Max_Sell_Count = 10
export const Swap_Fee_Percent = Number(process.env.BOT_FEE_PERCENT)
export const Default_Swap_Heap = 0.001

export const Mainnet = 'mainnet-beta'
export const Testnet = 'testnet'
export const Devnet = 'devnet'

export let g_ChainMode = 0 // 0: solana, 1: ethereum, 2: base, 3: bsc, 4: ton

export let web3Conn: Connection

export let quoteToken: any = {

    address: process.env.COMMUNITY_TOKEN,
    name: 'OF',
    symbol: 'ONLYFINS',
    decimals: 9
}

export let treasuryWallet: any

export const init = async () => {
    // quoteToken = await utils.getTokenMetadata(process.env.COMMUNITY_TOKEN as string)

    // const wallet = utils.getWalletFromPrivateKey(get_treasury_wallet_key())
    // if (!wallet) {
    //     console.error('Treasury wallet key error')
    // }

    // treasuryWallet = wallet.wallet
}

export const setWeb3 = (conn: Connection) => {

    web3Conn = conn
}

export const set_chain_mode = (mode: number) => {
    g_ChainMode = mode
}

export const get_chain_mode = () : number => {
    return g_ChainMode
}

export const get_chain_name = () : string => {
    switch (get_chain_mode()) {
        case 0: {

            return "solana";
        }

        case 1: {
            return "ethereum";
        }

        case 2: {

            return "base"
        }

        case 3: {

            return "bsc"
        }

        case 4: {

            return "ton"
        }

        default: {

            return ''
        }
    }
}

export const get_quote_name = () : string => {
    switch (get_chain_mode()) {
        case 0: {
            return "SOL";
        }

        case 1: {
            return "ETH";
        }

        case 2: {

            return "ETH"
        }

        case 3: {

            return "BNB"
        }

        case 4: {

            return "TON"
        }

        default: {
            return ''
        }
    }
}

export const getCluserApiType = (): string => {

    switch (get_net_mode()) {
        case ENV.MainnetBeta: {

            return Mainnet;
        }

        case ENV.Testnet: {
            return Testnet;
        }

        case ENV.Devnet: {

            return Devnet
        }

        default: {

            return ''
        }
    }
}

export const get_bot_link = () => {

    return `https://t.me/${process.env.BOT_USERNAME}`
}

export const get_jito_block_api = () => {
    return process.env.JITO_BLOCK_ENGINE_URL as string
}

export const get_dextool_api_key = () => {
    return process.env.DEXTOOL_API_KEY as string
}

export const get_tax_wallet_key = () => {
    return process.env.TAX_WALLET_KEY as string
}

export const get_net_mode = () => {

    return Number(process.env.NET_MODE)
}

export const get_net_rpc = () => {
    return process.env.MAINNET_RPC as string
}

export const get_net_wss = () => {
    return process.env.MAINNET_RPC_WSS as string
}

export const get_chainscan_url = (url: string): string => {

    let prefix = `https://solscan.io/${url}`;
    switch (get_net_mode()) {
        case ENV.MainnetBeta: {
            return prefix;
        }
        case ENV.Testnet: {
            return `${prefix}?cluster=testnet`;
        }
        case ENV.Devnet: {
            return `${prefix}?cluster=devnet`;
        }
    }

    return ''
};

export const get_treasury_wallet_key = () => {

    return process.env.TREASURY_KEY as string
}

export const get_tax_wallet_address = () => {

    return process.env.TAX_WALLET as string
}

export const get_jupiter_token_list_url = () => {
    return process.env.JUPITER_TOKEN_LIST_URL as string
}

export const get_treasury_wallet_address = () => {

    return treasuryWallet.publicKey.toBase58()
}

export const get_treasury_wallet = () => {

    return treasuryWallet
}

export const is_token_2022 = () => {
    return false;
}
