import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
import {
    Market,
    MARKET_STATE_LAYOUT_V3, 
} from '@project-serum/serum';
import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, TransactionMessage, VersionedTransactionResponse, sendAndConfirmTransaction } from '@solana/web3.js'
import {
    Liquidity,
    LiquidityPoolKeys,
    jsonInfo2PoolKeys,
    LiquidityPoolJsonInfo,
    TokenAccount,
    Token,
    TokenAmount,
    TOKEN_PROGRAM_ID,
    MAINNET_PROGRAM_ID,
    LOOKUP_TABLE_CACHE,
    Percent,
    SPL_ACCOUNT_LAYOUT,
    ASSOCIATED_TOKEN_PROGRAM_ID
  } from '@raydium-io/raydium-sdk'
import * as utils from './utils'
import { findPoolKeys, removeOldPoolKeys, updatePoolKeys } from './db';

export const PoolkeysUpdater = {
    getTrendingTokens: async function() {
        let response: any = null;
        let tokens: any = []; 
        try {
            let query = `https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=50`
            response = await axios.get(query, {
                headers: {
                    'Content-Type': "application/json",
                    "X-API-KEY": process.env.BIRDEYE_API_KEY
                }
            })
        
            if(!response.data || !response.data.data) return
            tokens = response.data.data.tokens
            if(!tokens || tokens.length == 0) return
            for(let i = 0; i < tokens.length; i++) {
                let item = tokens[i]
                if(item.symbol == 'SOL') continue
                if(item.symbol == 'USDC') continue
                if(item.symbol == 'USDT') continue
                await PoolkeysUpdater.addNew(item.address, item.decimals)
            }
        } catch (error) {
            console.log(error)
            return
        }
    },
    addNew: async function(base: string, baseDecimal: number) {
        const existPoolKeys: any = await findPoolKeys({ baseMint: base})
        if(existPoolKeys) return

        const quote = 'So11111111111111111111111111111111111111112'
        const quoteDecimal = 9

        try {
            const [{ publicKey: marketId, accountInfo }] = await Market.findAccountsByMints(
                utils.connection,
                new PublicKey(base),
                new PublicKey(quote),
                MAINNET_PROGRAM_ID.OPENBOOK_MARKET
            );
            const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
            let poolKeys: any = Liquidity.getAssociatedPoolKeys({
                version: 4,
                marketVersion: 3,
                baseMint: new PublicKey(base),
                quoteMint: new PublicKey(quote),
                baseDecimals: baseDecimal,
                quoteDecimals: quoteDecimal,
                marketId: marketId,
                programId: MAINNET_PROGRAM_ID.AmmV4,
                marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
            });
            poolKeys.marketBaseVault = marketInfo.baseVault;
            poolKeys.marketQuoteVault = marketInfo.quoteVault;
            poolKeys.marketBids = marketInfo.bids;
            poolKeys.marketAsks = marketInfo.asks;
            poolKeys.marketEventQueue = marketInfo.eventQueue;
            updatePoolKeys(poolKeys)
            return
        } catch (error) {            
            // console.log(error)
        }

        try {
            const [{ publicKey: marketId, accountInfo }] = await Market.findAccountsByMints(
              utils.connection,
              new PublicKey(quote),
              new PublicKey(base),
              MAINNET_PROGRAM_ID.OPENBOOK_MARKET
            );
            const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
            let poolKeys: any = Liquidity.getAssociatedPoolKeys({
              version: 4,
              marketVersion: 3,
              baseMint: new PublicKey(quote),
              quoteMint: new PublicKey(base),
              baseDecimals: quoteDecimal,
              quoteDecimals: baseDecimal,
              marketId: marketId,
              programId: MAINNET_PROGRAM_ID.AmmV4,
              marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
            });
            poolKeys.marketBaseVault = marketInfo.baseVault;
            poolKeys.marketQuoteVault = marketInfo.quoteVault;
            poolKeys.marketBids = marketInfo.bids;
            poolKeys.marketAsks = marketInfo.asks;
            poolKeys.marketEventQueue = marketInfo.eventQueue;
            updatePoolKeys(poolKeys) 
        } catch (error) {
            // console.log(error);
        }
    }
}

setInterval(function(){
    removeOldPoolKeys()
}, 24 * 3600000) // check old poolkeys ever one day