import assert from 'assert';
import dotenv from 'dotenv';

import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import {
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionMessage,
    Transaction,
    VersionedTransaction,
    TransactionInstruction,
    LAMPORTS_PER_SOL,
    sendAndConfirmTransaction
} from '@solana/web3.js';

import {
    Market,
    MARKET_STATE_LAYOUT_V3,

} from '@project-serum/serum';
import {
    buildSimpleTransaction,
    InnerSimpleTransaction,
    InstructionType,
    Liquidity,
    LOOKUP_TABLE_CACHE,
    MAINNET_PROGRAM_ID,
    Percent,
    Token,
    TokenAmount,
    TxVersion,

} from '@raydium-io/raydium-sdk';

import * as afx from './global';

import * as utils from './utils';
import { TokenAccount } from '@metaplex-foundation/js';

const PROGRAMIDS = MAINNET_PROGRAM_ID //MAINNET_PROGRAM_ID //: ;DEVNET_PROGRAM_ID
const addLookupTableInfo = LOOKUP_TABLE_CACHE //LOOKUP_TABLE_CACHE //: undefined;

dotenv.config()

export interface BotFee {
    swapOrgFee: number,
    refRewardFee: number,
    swapFee: number,
}

export const calcFee = (amount: number, session: any, rewardAvailable: boolean): BotFee => {

    const swapOrgFee = amount * afx.Swap_Fee_Percent / 100.0
    let refRewardFee

    if (rewardAvailable && session.referredBy) {

        const now = new Date().getTime()

        let monthSpent = 0
        if (session.referredTimestamp) {
            monthSpent = (now - session.referredTimestamp) / (1000 * 60 * 60 * 24 * 30)
        }

        let rewardPercent = 10
        if (monthSpent > 2) {
            rewardPercent = 10
        } else if (monthSpent > 1) {
            rewardPercent = 20
        } else {
            rewardPercent = 30
        }

        refRewardFee = swapOrgFee * rewardPercent / 100.0
    } else {
        refRewardFee = 0
    }

    const swapFee = swapOrgFee - refRewardFee

    return { swapOrgFee, refRewardFee, swapFee }
}

export const transferSOL = async (pkey: string, destWallet: string, amount: number, sendMsg: Function, callback: Function) => {

    const walletInfo: any | null = utils.getWalletFromPrivateKey(pkey)
    if (!walletInfo) {
        sendMsg(`❗ Transfer failed: Invalid wallet.`)
        return "failed"
    }

    const wallet: Keypair = walletInfo.wallet

    const txInstructions: TransactionInstruction[] = []

    const transferInst = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(destWallet),
        // lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        lamports: amount,
    })
    txInstructions.push(transferInst)

    const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: (await afx.web3Conn.getLatestBlockhash()).blockhash,
        instructions: txInstructions
    }).compileToV0Message();

    const trx = new VersionedTransaction(messageV0)

    trx.sign([wallet])

    return { trx }
}

export const transferSOL_My = async (pkey: string, destWallet: string, amount: number, sendMsg: Function, callback: Function) => {

    const walletInfo: any | null = utils.getWalletFromPrivateKey(pkey)
    if (!walletInfo) {
        sendMsg(`❗ Transfer failed: Invalid wallet.`)
        return "failed"
    }

    const wallet: Keypair = walletInfo.wallet

    try {
        // Add transfer instruction to transaction 
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: new PublicKey(destWallet),
                // lamports: Math.floor(amount * LAMPORTS_PER_SOL),
                lamports: amount,
            })
        );
        // Sign transaction, broadcast, and confirm
        const signature = await sendAndConfirmTransaction(
            // utils.connection,
            afx.web3Conn,
            transaction,
            [wallet]
        );

        // const recentBlockhash = await utils.connection.getRecentBlockhash();
        // const tx = new Transaction({
        //     recentBlockhash: recentBlockhash.blockhash,
        //     feePayer: wallet.publicKey,
        //   }).add(
        //     SystemProgram.transfer({
        //       fromPubkey: wallet.publicKey,
        //       toPubkey: new PublicKey(destWallet),
        //       lamports: amount,
        //     }),
        //   );
        // const signature = await utils.connection.sendTransaction(tx, [wallet]);

        const url : string = `https://solscan.io/tx/${signature}`
        console.log('Transfer SOL successful:', url);

        // await sendMsg(`✅ Successfully transfer SOL done! <a href="${url}">View on Solscan</a>`)

        return "success";
    }
    catch (error) {
        console.log('Failed to send transaction->[transferSOL_My] :', Object(error).message);
        // await sendMsg(`❗ Transfer SOL failed!`)

        return "failed"
    }
}

export const getBuyTokenTrx = async (payer: any, token: any, amount: any, slip: number) => {
    const baseToken = new Token(
        TOKEN_PROGRAM_ID,
        token.addr,
        token.decimal,
        token.symbol,
    );
    const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        token.baseAddr,
        token.baseDecimal,
        token.baseSymbol,
    );

    const slippage = new Percent(slip, 100);
    const inputSolAmount = new TokenAmount(quoteToken, amount, false);

    console.log("getBuyTokenTrx - 1")
    try {
        const [{ publicKey: marketId, accountInfo }] = await Market.findAccountsByMints(
            // afx.web3Conn,
            utils.connection,
            baseToken.mint,
            quoteToken.mint,
            PROGRAMIDS.OPENBOOK_MARKET
        );

        console.log("getBuyTokenTrx - 1-1 ")

        const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
        let poolKeys: any = Liquidity.getAssociatedPoolKeys({
            version: 4,
            marketVersion: 3,
            baseMint: baseToken.mint,
            quoteMint: quoteToken.mint,
            baseDecimals: baseToken.decimals,
            quoteDecimals: quoteToken.decimals,
            marketId: marketId,
            programId: PROGRAMIDS.AmmV4,
            marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
        });
        poolKeys.marketBaseVault = marketInfo.baseVault;
        poolKeys.marketQuoteVault = marketInfo.quoteVault;
        poolKeys.marketBids = marketInfo.bids;
        poolKeys.marketAsks = marketInfo.asks;
        poolKeys.marketEventQueue = marketInfo.eventQueue;
        console.log("getBuyTokenTrx - 2")
        const { minAmountOut } = Liquidity.computeAmountOut({
            poolKeys: poolKeys,
            poolInfo: await Liquidity.fetchInfo({ connection: utils.connection, poolKeys }),
            amountIn: inputSolAmount,
            currencyOut: baseToken,
            slippage: slippage,
        });

        console.log("getBuyTokenTrx - 3 minAmountOut = ", minAmountOut)

        // -------- step 2: create instructions by SDK function --------

        await getOrCreateAssociatedTokenAccount(
            // afx.web3Conn,
            utils.connection,
            payer.wallet,
            baseToken.mint,
            payer.wallet.publicKey
        );
        const walletTokenAccounts = await utils.getWalletTokenAccount(new PublicKey(payer.publicKey), false);

        const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
            connection: utils.connection, //afx.web3Conn,
            poolKeys,
            userKeys: {
                tokenAccounts: walletTokenAccounts,
                owner: new PublicKey(payer.publicKey),
            },
            amountIn: inputSolAmount,
            amountOut: minAmountOut,
            fixedSide: "in",
            makeTxVersion: TxVersion.V0,
        });

        const transactions = await buildSimpleTransaction({
            connection: utils.connection,//afx.web3Conn,
            makeTxVersion: TxVersion.V0,
            payer: new PublicKey(payer.publicKey),
            innerTransactions: innerTransactions,
            addLookupTableInfo: addLookupTableInfo,
        });

        for (let tx of transactions) {
            if (tx instanceof VersionedTransaction) {
                tx.sign([payer.wallet]);
            }
        }

        console.log("getBuyTokenTrx - 4", transactions)
        return { trxs: transactions, amount: minAmountOut.toFixed(baseToken.decimals) };
    } catch (error) {
        console.log(error);
    }
}

export const getSellTokenTrx = async (payer: any, token: any, amount: any, slip: number) => {
    const baseToken = new Token(
        TOKEN_PROGRAM_ID,
        token.addr,
        token.decimal,
        token.symbol,
    );
    const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        token.baseAddr,
        token.baseDecimal,
        token.baseSymbol,
    );

    const slippage = new Percent(slip, 100);
    const inputTokenAmount = new TokenAmount(baseToken, amount, false);

    try {
        const [{ publicKey: marketId, accountInfo }] =
            await Market.findAccountsByMints(
                afx.web3Conn,
                baseToken.mint,
                quoteToken.mint,
                PROGRAMIDS.OPENBOOK_MARKET
            );
        const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
        let poolKeys: any = Liquidity.getAssociatedPoolKeys({
            version: 4,
            marketVersion: 3,
            baseMint: baseToken.mint,
            quoteMint: quoteToken.mint,
            baseDecimals: baseToken.decimals,
            quoteDecimals: quoteToken.decimals,
            marketId: marketId,
            programId: PROGRAMIDS.AmmV4,
            marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
        });

        poolKeys.marketBaseVault = marketInfo.baseVault;
        poolKeys.marketQuoteVault = marketInfo.quoteVault;
        poolKeys.marketBids = marketInfo.bids;
        poolKeys.marketAsks = marketInfo.asks;
        poolKeys.marketEventQueue = marketInfo.eventQueue;
        // -------- step 1: compute amount out --------
        const { minAmountOut } =
            Liquidity.computeAmountOut({
                poolKeys: poolKeys,
                poolInfo: await Liquidity.fetchInfo({ connection: afx.web3Conn, poolKeys }),
                amountIn: inputTokenAmount,
                currencyOut: quoteToken,
                slippage: slippage,
            });

        const walletTokenAccounts = await utils.getWalletTokenAccount(new PublicKey(payer.publicKey), false);
        const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
            connection: afx.web3Conn,
            poolKeys,
            userKeys: {
                tokenAccounts: walletTokenAccounts,
                owner: new PublicKey(payer.publicKey),
            },
            amountIn: inputTokenAmount,
            amountOut: minAmountOut,
            fixedSide: "in",
            makeTxVersion: TxVersion.V0,
        });

        const transactions = await buildSimpleTransaction({
            connection: afx.web3Conn,
            makeTxVersion: TxVersion.V0,
            payer: new PublicKey(payer.publicKey),
            innerTransactions: innerTransactions,
            addLookupTableInfo: addLookupTableInfo,
        });

        for (let tx of transactions) {
            if (tx instanceof VersionedTransaction) {
                tx.sign([payer.wallet]);
            }
        }

        return { trxs: transactions, amount: minAmountOut.toFixed(quoteToken.decimals) };
    } catch (error) {
        console.log(error);
    }
}

export const getTransferSOLTrx = async (pkey: string, destWallet: string, amount: number) => {

    const walletInfo: any | null = utils.getWalletFromPrivateKey(pkey)
    if (!walletInfo) {
        console.log(`❗ Transfer failed: Invalid wallet.`)
        return "failed"
    }

    const wallet: Keypair = walletInfo.wallet

    const txInstructions: TransactionInstruction[] = []

    const transferInst = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(destWallet),
        lamports: Math.floor(amount * LAMPORTS_PER_SOL),
    })
    txInstructions.push(transferInst)

    const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: (await afx.web3Conn.getLatestBlockhash("finalized")).blockhash,
        instructions: txInstructions
    }).compileToV0Message();

    const trx = new VersionedTransaction(messageV0)

    trx.sign([wallet])

    return  trx 
}