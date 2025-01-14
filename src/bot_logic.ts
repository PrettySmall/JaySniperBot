import assert from 'assert';

import { NATIVE_MINT } from '@solana/spl-token';
import { VersionedTransaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

import * as bot from './bot';
import * as database from './db';
// import * as dex from './dexscreenerAPI';
import * as global from './global';
import * as Jito from './jitoAPI';
import * as swap from './swap';
import * as fastSwap from './fast_swap';
import * as swap_manager from './swap_manager';
import * as Detector from './token_detector';
import * as constants from './uniconst';
import * as utils from './utils';
import * as dextoolsAPI from './dextoolsAPI';
import * as birdeyeAPI from './birdeyeAPI'

import * as swap_engine from './swap_engine_fast'

import { amount } from '@metaplex-foundation/js';
import { userInfo } from 'os';
import { session } from 'passport';
import base58 from "bs58";

import * as bloXroute from './bloXroute'
const BLOXROUTE_USE = process.env.BLOXROUTE_ENABLE
const BLOXROUTE_TIP_AMOUNT = Number(process.env.BLOXROUTE_TIP_AMOUNT)// minimum tip according to doc

const fetchTokenPrice = async () => {
    const users: any = await database.selectUsers()
    // const users: any = database.selectUsers() // ??????

    // console.log(`[fetchTokenPrice] : start--------------------------- ${users.length}`)

    if (!users.length) {
        return
    }

    for (let user of users) {
        const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
        
        const tokenAccounts: any = await utils.getWalletTokenAccount(new PublicKey(depositWallet.publicKey), false)
        for (let tokenAccount of tokenAccounts) {
 
            // console.log("[fetchTokenPrice]: TokenAccount loop ------------------------", tokenAccount.accountInfo.mint)

            const addr: string = tokenAccount.accountInfo.mint.toString()
            const token: any = await database.selectToken({ chatid: user.chatid, addr })
            if(!token) return
            
            // console.log("[fetchTokenPrice]: Sell Token exist ------------------------")

            const tokenBalance: number = Number(tokenAccount.accountInfo.amount) / (10 ** token.decimal);            
            if (tokenBalance && token.isAutoSell) {
                // const data: any = await dextoolsAPI.getTokenPriceInfo(addr)
                const data: any = await birdeyeAPI.getTokenPriceInfo_Birdeye(addr)
                let cur_price: number = 0
                if(data && data.value) cur_price = data.value

                console.log(`[fetchTokenPrice] -> token : buyPrice = ${token.buyPrice}, curPrice = ${cur_price}`)

                const hAmount: number = (100 + token.takeProfit) / 100
                const lAmount: number = (100 - token.stopLoss) / 100
                if (token.buyPrice * hAmount <= cur_price || token.buyPrice * lAmount >= cur_price) {
                    sell(user.chatid, addr, user.autoSellAmount)

                    token.isAutoSell = false
                    await token.save()
                }
            }
        }
    }
}

// setInterval(() => { fetchTokenPrice() }, constants.FETCH_INTERVAL)

export const registerToken = async (
    chatid: string, // this value is not filled in case of web request, so this could be 0
    addr: string,
    symbol: string,
    decimal: number
) => {
    if (await database.selectToken({ chatid, addr })) {
        return constants.ResultCode.SUCCESS
    }
    const regist = await database.registToken({ chatid, addr, symbol, decimal, baseAddr: NATIVE_MINT.toString(), baseSymbol: "SOL", baseDecimal: 9 })
    if (!regist) {
        return constants.ResultCode.INTERNAL
    }
    return constants.ResultCode.SUCCESS
};

export const divideToWallets = async (chatid: string) => {
    const session: any = bot.sessions.get(chatid)
    if (!session) {
        return constants.ResultCode.INVALIDE_USER;
    }

    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    let depositWalletSOLBalance: number = await utils.getWalletSOLBalance(depositWallet)
    if (depositWalletSOLBalance <= 0) {
        return constants.ResultCode.USER_INSUFFICIENT_SOL
    }
    const token: any = await database.selectToken({ chatid, addr: session.addr })
    let tax: number = token.targetVolume * constants.SOL_TAX_FEE_PER_1M_VOLUME
    if (token.targetVolume % 0.1) {
        tax++
    }
    if (token.workingTime == 0 || await isNeedPayment(chatid, token.addr)) {
        depositWalletSOLBalance -= tax
    }
    if (depositWalletSOLBalance <= 0) {
        return constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL
    }
    if (token.workingTime == 0) {
        depositWalletSOLBalance -= constants.JITO_FEE_AMOUNT
    }
    if (depositWalletSOLBalance <= 0) {
        return constants.ResultCode.USER_INSUFFICIENT_JITO_FEE_SOL
    }
    const divideSolAmount: number = depositWalletSOLBalance / token.walletSize
    if (divideSolAmount <= constants.MIN_DIVIDE_SOL) {
        return constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL
    }
    const bundleTransactions: any[] = [];
    const botWallets: any = await database.selectWallets({ chatid })
    for (let i = 0; i < token.walletSize; i++) {
        const botWallet: any = utils.getWalletFromPrivateKey(botWallets[i].prvKey)
        const { trx }: any = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, botWallet.publicKey, divideSolAmount)
        bundleTransactions.push(trx)
    }
    if (bundleTransactions.length <= 4) {
        await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    } else if (bundleTransactions.length > 4) {
        await Jito.createAndSendBundleTransaction(bundleTransactions.slice(0, 4), depositWallet.wallet, constants.JITO_BUNDLE_TIP)
        await Jito.createAndSendBundleTransaction(bundleTransactions.slice(4, bundleTransactions.length), depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    }
}

export const gatherToWallet = async (chatid: string) => {
    const session: any = bot.sessions.get(chatid)
    if (!session) {
        return constants.ResultCode.INVALIDE_USER;
    }

    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const botWallets: any = await database.selectWallets({ chatid })
    const bundleTransactions: any[] = [];
    for (let wallet of botWallets) {
        const botWallet: any = utils.getWalletFromPrivateKey(wallet.prvKey)
        const botWalletSOLBalance: number = await utils.getWalletSOLBalance(botWallet)
        if (botWalletSOLBalance <= 0) {
            continue
        }
        const { trx }: any = await swap_manager.transferSOL(database, chatid, botWallet.secretKey, depositWallet.publicKey, botWalletSOLBalance - constants.LIMIT_REST_SOL_AMOUNT)
        bundleTransactions.push(trx)
    }
    if (bundleTransactions.length <= 4) {
        await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    } else if (bundleTransactions.length > 4) {
        await Jito.createAndSendBundleTransaction(bundleTransactions.slice(0, 4), depositWallet.wallet, constants.JITO_BUNDLE_TIP)
        await Jito.createAndSendBundleTransaction(bundleTransactions.slice(4, bundleTransactions.length), depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    }
    return constants.ResultCode.SUCCESS;
}

const isNeedPayment = async (chatid: string, addr: string) => {
    const whiteLists: any = await database.WhiteList.find({});
    let whiteList: any = null
    for (let ls of whiteLists) {
        if (ls.chatid === chatid) {
            whiteList = ls
        }
    }
    const token: any = await database.selectToken({ chatid, addr })
    if (whiteList) {
        const tokens: any = await database.selectTokens({ chatid })
        let runningBotCount: number = 0
        for (let token of tokens) {
            if (token.currentVolume) {
                runningBotCount++
            }
        }
        if (runningBotCount <= whiteList.limitTokenCount) {
            return false
        } else {
            return true
        }
    }
    return token.currentVolume > token.targetVolume * constants.VOLUME_UNIT ? true : false
}

const catchTax = async (chatid: string, addr: string) => {
    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    let depositWalletSOLBalance: number = await utils.getWalletSOLBalance(depositWallet)
    if (depositWalletSOLBalance <= 0) {
        return constants.ResultCode.USER_INSUFFICIENT_SOL
    }
    const token: any = await database.selectToken({ chatid, addr })
    let tax: number = token.targetVolume * constants.SOL_TAX_FEE_PER_1M_VOLUME
    if (token.targetVolume % 0.1) {
        tax++
    }
    depositWalletSOLBalance -= tax
    if (depositWalletSOLBalance <= 0) {
        return constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL
    }

    const bundleTransactions: any[] = []
    const { trx }: any = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, global.get_tax_wallet_address(), tax)
    bundleTransactions.push(trx)
    const result: boolean = await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    if (result) {
        console.log("------jito request is successed------");
        return constants.ResultCode.SUCCESS
    } else {
        console.log("------jito request is failed------");
        return constants.ResultCode.INTERNAL
    }
}

const sellAllTokens = async (chatid: string, addr: string) => {

    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const token: any = await database.selectToken({ chatid, addr })
    const wallets: any = await database.selectWallets({ chatid })
    const bundleTransactions: any[] = [];
    for (let wallet of wallets) {
        if (!wallet) {
            continue
        }
        const payer: any = utils.getWalletFromPrivateKey(wallet.prvKey)
        const tokenBalance: number = await utils.getWalletTokenBalance(
            payer,
            token.addr, token.decimal
        );
        if (tokenBalance > 0) {
            const { trxs }: any = await swap.getSellTokenTrx(payer, token, tokenBalance, 100)
            const trx: VersionedTransaction = trxs[0]
            bundleTransactions.push(trx)
        }
    }
    if (bundleTransactions.length <= 4) {
        await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    } else if (bundleTransactions.length > 4) {
        await Jito.createAndSendBundleTransaction(bundleTransactions.slice(0, 4), depositWallet.wallet, constants.JITO_BUNDLE_TIP)
        await Jito.createAndSendBundleTransaction(bundleTransactions.slice(4, bundleTransactions.length), depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    }
}

export const withdraw = async (chatid: string, addr: string) => {
    const user: any = await database.selectUser({ chatid })
    if (!user)
        return false
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const depositWalletSOLBalance: number = await utils.getWalletSOLBalance(depositWallet)
    if (depositWalletSOLBalance <= 0 || user.withdrawAmount <= 0) {
        await bot.sendMessageSync(chatid, `⚠️ There is no SOL amount to transfer`)
        console.log("[withdraw] : error ----- 1 ")
        return false
    }
    // const bundleTransactions: any[] = []
    // const { trx }: any = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, addr, depositWalletSOLBalance - constants.JITO_BUNDLE_TIP - constants.LIMIT_REST_SOL_AMOUNT)
    // bundleTransactions.push(trx)
    // const result: boolean = await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
    // if (result) {
    //     console.log("------jito request is successed------");
    // } else {
    //     console.log("------jito request is failed------");
    // }

    let amount: number = (depositWalletSOLBalance - constants.JITO_BUNDLE_TIP - constants.LIMIT_REST_SOL_AMOUNT) * user.withdrawAmount / 100
    // let amount: number = (depositWalletSOLBalance) * user.withdrawAmount / 100
    // amount = 0.001 //Angel testing

    console.log(`SOL balance = ${depositWalletSOLBalance}, withdrawAmount = ${user.withdrawAmount}`)
    const balance = await global.web3Conn.getBalance(depositWallet.wallet.publicKey); //await utils.connection.getBalance(depositWallet.wallet.publicKey);
    // const recentBlockhash = await global.web3Conn.getRecentBlockhash();//await utils.connection.getRecentBlockhash();
    const cost = 50000;//recentBlockhash.feeCalculator.lamportsPerSignature;
    const amountToSend = Math.floor((balance - cost) * user.withdrawAmount / 100);

    console.log("balance = ", balance)
    console.log("transfer gas fee = ", cost)
    console.log("amountToSend = ", amountToSend)

    if (!BLOXROUTE_USE) {
        const result: string = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, addr, amountToSend)
        if (result == "success") {
            console.log(`[${user.username}] ------Withdraw : transferSOL(${amountToSend}) is successed------`);
        } else {
            console.log(`[${user.username}] ------Withdraw : transferSOL is failed------`);
        }
    } else {
        const bundleTransactions: any[] = []
        const { trx }: any = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, addr, amountToSend, true)
        bundleTransactions.push(trx)
        await bloXroute.buildBundlesOnBX(bundleTransactions, depositWallet.wallet, BLOXROUTE_TIP_AMOUNT)
    }
    
    return true
}

export const setSlippage = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.buySlippage = amount
    token.sellSlippage = amount
    await token.save()
}

export const setBuySlippage = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.buySlippage = amount
    await token.save()
}

export const setSellSlippage = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.sellSlippage = amount
    await token.save()
}

export const switchMode = async (chatid: string, addr: string) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.mode = !token.mode
    await token.save()
}

export const setBuySwapLimitSetting = async (chatid: string, flag: number) => {
    const user: any = await database.selectUser({ chatid })
    user.buySwapLimit = flag    
    await user.save()
}

export const setBuySolAmount = async (chatid: string, flag: number) => {
    const user: any = await database.selectUser({ chatid })
    user.buySolIdx = flag    
    await user.save()
}

export const setBuySlipIdx = async (chatid: string, flag: number) => {
    const user: any = await database.selectUser({ chatid })
    user.buySlippageIdx = flag    
    await user.save()
}

export const setSellSwapLimitSetting = async (chatid: string, flag: number) => {
    const user: any = await database.selectUser({ chatid })
    user.sellSwapLimit = flag    
    await user.save()
}

export const setSellTokenPercentAmount = async (chatid: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })
    user.sellPercentIdx = amount    
    await user.save()
}

export const setSellSlipIdx = async (chatid: string, flag: number) => {
    const user: any = await database.selectUser({ chatid })
    user.sellSlippageIdx = flag    
    await user.save()
}

export const setNewPairsUpcomingLaunch = async (chatid: string, flag: Boolean) => {
    const user: any = await database.selectUser({ chatid })
    user.newPairsUpcomingLaunch = flag    
    await user.save()
}

export const setWithdrawWallet = async (chatid: string, wallet: string) => {
    const user: any = await database.selectUser({ chatid })
    user.withdrawWallet = wallet    
    await user.save()
}

export const setWithdrawAmountAndIDX = async (chatid: string, amount: number, idx: number) => {
    const user: any = await database.selectUser({ chatid })
    user.withdrawAmount = amount
    user.withdrawIdx = idx    
    await user.save()
}

export const setAutoBuyEnable = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })
    user.stAutoBuyEnabled = !user.stAutoBuyEnabled
   
    await user.save()
}

export const setAutoBuyAmount_1 = async (chatid: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })
    user.buySolIdx = 6;
    user.stAutoBuyAmount = amount;
    await user.save()
}

export const setAutoBuySlippage = async (chatid: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })
    
    user.stAutoBuySlippage = amount;
    await user.save()
}

export const setAutoSellSlippage = async (chatid: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })
    
    user.stAutoSellSlippage = amount;
    await user.save()
}

export const setTrxPriority = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })

    user.stTrxPriorityIdx = (user.stTrxPriorityIdx + 1) % 3
    switch (user.stTrxPriorityIdx){
        case 0: user.stTrxPriorityFee = 0.001; break;
        case 1: user.stTrxPriorityFee = 0.005; break;
        case 2: user.stTrxPriorityFee = 0.01; break;
    }
    
    await user.save()
}

export const setMevProtect = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })

    user.stMevProtectEnabled = !user.stMevProtectEnabled
    if (user.stMevProtectEnabled)
        user.stMevProtectFee = 0.03
    
    await user.save()
}

export const setAutoPriorityFee = async (chatid: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })

    user.stTrxPriorityIdx = 4;
    user.stTrxPriorityFee = amount;
    
    await user.save()
}

export const setSettingBuyAmount = async (chatid: string, amount: number, direct: boolean) => {
    const user: any = await database.selectUser({ chatid })
    
    if(direct)
    {
        user.stBuyRightAmount = amount;
    }
    else
    {
        user.stBuyLeftAmount = amount;
    } 
    
    await user.save()
}


export const setSettingSellAmount = async (chatid: string, amount: number, direct: boolean) => {
    const user: any = await database.selectUser({ chatid })
    
    if(direct)
    {
        user.stSellRightAmount = amount;
    }
    else
    {
        user.stSellLeftAmount = amount;
    } 
    
    await user.save()
}

export const switchAutoDetection = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })
    user.isAutoDetect = !user.isAutoDetect
    if (user.isAutoDetect) {
        Detector.addUser(chatid)
    } else {
        Detector.deleteUser(chatid)
    }
    await user.save()
}

export const taxProc = async (chatid: string, tax_amount: number) => {

    const session: any = bot.sessions.get(chatid)
    if (!session) {
        return constants.ResultCode.INVALIDE_USER;
    }

    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const depositWalletSOLBalance: number = await utils.getWalletSOLBalance(depositWallet)
    if (depositWalletSOLBalance <= 0 || tax_amount <= 0) {
        console.log("tax amount is less than zero")
        return false
    }
    
    let amount: number = (depositWalletSOLBalance - constants.JITO_BUNDLE_TIP - constants.LIMIT_REST_SOL_AMOUNT) * user.withdrawAmount / 100
    
    const balance = await global.web3Conn.getBalance(depositWallet.wallet.publicKey); //await utils.connection.getBalance(depositWallet.wallet.publicKey);
    const recentBlockhash = await global.web3Conn.getRecentBlockhash();//await utils.connection.getRecentBlockhash();
    const cost = recentBlockhash.feeCalculator.lamportsPerSignature;

    const taxLamperts = Math.floor(tax_amount * LAMPORTS_PER_SOL)

    console.log("balance = ", balance)
    console.log("transfer fee = ", cost)
    console.log("taxToSend = ", taxLamperts)

    const result: string = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, global.get_tax_wallet_address(), taxLamperts)
    if (result == "success") {
        console.log("------transferSOL is successed------");
    } else {
        console.log("------transferSOL is failed------");
    }
    
    return true
}


const TaxReward = async (chatid: string, referralreward: number, from: any) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }

    const referralUser: any = await database.selectUser({ chatid: user.referredBy })
    if (referralUser) {

        const rewardLamperts = Math.floor(referralreward * LAMPORTS_PER_SOL)
       
        const result: string = await swap_manager.transferSOL(database, chatid, from, referralUser.referralWallet, rewardLamperts)
        if (result == "success") {
            console.log("------Referral Reward transferSOL is successed------");
        } else {
            console.log("------Referral Reward transferSOL is failed------");
        }     
    }
}

const ReferralReward = async (chatid: string, referralReward: number, from: any) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }

    const referralUser: any = await database.selectUser({ chatid: user.referredBy })
    if (referralUser) {

        const rewardLamperts = Math.floor(referralReward * LAMPORTS_PER_SOL)
       
        const refWallet: any = utils.getWalletFromPrivateKey(referralUser.referralWallet)

        const result: string = await swap_manager.transferSOL(database, chatid, from, refWallet.publicKey, rewardLamperts)
        if (result == "success") {
            console.log(`[${user.username}] ------Referral Reward transferSOL(${rewardLamperts} Lamports) is successed------`);
        } else {
            console.log(`[${user.username}] ------Referral Reward transferSOL is failed------`);
        }     
    }
}

export const buy = async (chatid: string, addr: string, amount1: number, sendMsg: Function) => {
    const session: any = bot.sessions.get(chatid)
    if (!session) {
        console.log(`[${chatid}] buy session is expire`)
        return constants.ResultCode.INVALIDE_USER;
    }

    const user: any = await database.selectUser({ chatid })
    if (!user) {
        console.log(`[${chatid}] user is not exist`)
        return
    }

    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const SOLBalance: number = await utils.getWalletSOLBalance(depositWallet)
    const SOLBalanceLamports: number = await utils.getWalletSOLBalanceLamports(depositWallet)

    // if (user.referredBy && amount1 < 0.3)
    // {
    //     await bot.sendMessageSync(chatid, `⚠️ You should buy 0.3 sol at least because of tax & referral fee`)
    //     console.log(`[${user.username}]⚠️ You should buy 0.3 sol at least because of tax & referral fee`)
    //     return   
    // }

    if(SOLBalance - constants.LIMIT_REST_SOL_AMOUNT - amount1 <= 0)
    {
        await bot.sendMessageSync(chatid, `⚠️ Insufficient SOL amount for token to buy, you should have ${constants.LIMIT_REST_SOL_AMOUNT * 2 + amount1} sol at least`)
        console.log(`[${user.username}]⚠️ Insufficient SOL amount for token to buy, you should have ${constants.LIMIT_REST_SOL_AMOUNT * 2 + amount1} sol at least`)
        return
    }

    // let priorityFees = await global.web3Conn.getRecentPrioritizationFees()
    // priorityFees.sort((a, b) => a.prioritizationFee - b.prioritizationFee)
    // console.log("--------------buy priority fees:", priorityFees)

    // const recentBlockhash = await global.web3Conn.getRecentBlockhash();//await utils.connection.getRecentBlockhash();
    const cost = 0.00005;//recentBlockhash.feeCalculator.lamportsPerSignature / LAMPORTS_PER_SOL;

    let rewardFlag = amount1 >= 0.3 ? true : false;

    const { swapOrgFee, refRewardFee, swapFee } = swap.calcFee(amount1, session, rewardFlag)

    let realBuySolAmount = amount1 - swapOrgFee - cost * 3

    console.log(`[${user.username}] : buyAmount = ${realBuySolAmount}, taxFee = ${swapFee}, refFee = ${refRewardFee}, gasFee = ${cost}`)

    if (realBuySolAmount <= 0)
    {
        await bot.sendMessageSync(chatid, `⚠️ Insufficient SOL amount for token to buy, you should have ${swapOrgFee * 2 + cost * 3} sol at least`)
        return
    }

    // const amountToSend = Math.floor((SOLBalanceLamports - cost) * user.withdrawAmount / 100);

    // if ((SOLBalance - constants.JITO_BUNDLE_TIP * 2) < amount1) {
    // // if ((SOLBalance - swapOrgFee - cost * 3) < amount1) {
    //     await bot.sendMessageSync(chatid, "⚠️ Insufficient SOL amount for token to buy")
    //     return
    // }

    const token: any = await database.selectToken({ chatid, addr })

    // const data: any = await dextoolsAPI.getTokenPriceInfo(addr)
    const data: any = await birdeyeAPI.getTokenPriceInfo_Birdeye(addr)
    if(data && data.value) token.buyPrice = data.value

    console.log("current token price = ", token.buyPrice)


    const isLoadedPoolKeys: boolean = await swap_engine.loadPoolKeys_from_market(
                                        token.addr,
                                        token.decimal,
                                        NATIVE_MINT.toString(),
                                        9
                                    );

    if (isLoadedPoolKeys){
        try {
            let bundleTransactions: any[] = [];
            let simRes: any = null;

            //Creating token account at first...
            // if (!await utils.IsTokenAccountInWallet(depositWallet, token.addr)) {
            //     console.log(`[${user.username}] : [${token.symbol}]---------- create token account----------- `);

            //     const trx: any = await fastSwap.getCreateAccountTransaction(depositWallet, token.addr)
            //     bundleTransactions.push(trx)

            //     simRes = await swap_engine.simulateVersionedTransaction(trx);
            //     console.log(user.username, "Create Token Account Simulation result = ", simRes);

            //     const result: boolean = await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
            //     if (result) {
            //         console.log("------jito request is successed------");
            //     } else {
            //         console.log("------jito request is failed------");
            //     }
            //     bundleTransactions = []
            //     await utils.sleep(1000);
            // }

            let buySolAmount = realBuySolAmount; //amount1
            // let priority: number = user.stMevProtectEnabled ? user.stMevProtectFee + user.stTrxPriorityFee : user.stTrxPriorityFee;
            let priority: number = user.stMevProtectEnabled ? 0 : user.stTrxPriorityFee;
            priority = priority * LAMPORTS_PER_SOL;//token.priority*10**9;

            console.log("++++++++++++++++++++++++++ priority fee = ", priority)
            console.log("---------------buyslipage = ", token.buySlippage)

            const { trxs: buyTrxs, amount:_amount }: any = await swap_engine.getSwapTransaction(
                                                        depositWallet,
                                                        NATIVE_MINT.toString(),
                                                        token.addr,
                                                        buySolAmount,
                                                        token.buySlippage,
                                                        priority
                                                    );

            
            if (!buyTrxs) {
                console.log("--------------------------------- buyTrxs error")
                return
            }

            if (BLOXROUTE_USE) {
                bundleTransactions.push(buyTrxs)
                const txid: any = await bloXroute.buildBundlesOnBX(bundleTransactions, depositWallet.wallet, BLOXROUTE_TIP_AMOUNT)
                if (txid)
                    await sendMsg(`✅ Successfully [${token.symbol}] Token Buy done! <a href="${utils.getFullTxLink(txid)}">View on Solscan</a>`)
            }
            else if (user.stMevProtectEnabled)
            {
                console.log(`[${user.username}] ++++++++++ Jito Buy module starting .....`)
                
                bundleTransactions.push(buyTrxs)

                simRes = await swap_engine.simulateVersionedTransaction(buyTrxs);
                console.log(user.username, "Buy Trx Simulation result = ", simRes);

                if ( swapFee >= constants.REFERRAL_FEE_LIMIT) {
                    const feeTrx : any = await fastSwap.getSolTransferTransaction(depositWallet.secretKey, global.get_tax_wallet_address(), swapFee)
                    // const feeTrx : any = await swap.getTransferSOLTrx(depositWallet.secretKey, global.get_tax_wallet_address(), swapFee);
                    bundleTransactions.push(feeTrx)

                    simRes = await swap_engine.simulateVersionedTransaction(feeTrx);
                    console.log(user.username, "Fee Trx Simulation result = ", simRes);
                }

                if (user.referredBy && refRewardFee >= constants.REFERRAL_FEE_LIMIT)
                {
                    console.log(`[${user.username}] ++++++++ Referral reward transaction generating ...`)
                    // let refRewardFee = 0.0009

                    const referralUser: any = await database.selectUser({ chatid: user.referredBy })
                    if (referralUser) 
                    {
                        // const rewardLamperts = Math.floor(refRewardFee * LAMPORTS_PER_SOL)                    
                        const refWallet: any = utils.getWalletFromPrivateKey(referralUser.referralWallet)

                        const referralFeeTrx : any = await fastSwap.getSolTransferTransaction(depositWallet.secretKey, refWallet.publicKey, refRewardFee)
                        bundleTransactions.push(referralFeeTrx)

                        simRes = await swap_engine.simulateVersionedTransaction(referralFeeTrx);
                        console.log(user.username, "Referral Fee Trx Simulation result = ", simRes);
                    }
                }

                const result: boolean = await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
                if (result) {
                    console.log("------jito buy request is successed------");
                    token.buyCount += 1;
                    token.buyHistory += token.buyAmount;

                    const txid = base58.encode(bundleTransactions[0].signatures[0])
                    console.log(`https://solscan.io/tx/${txid}`);
                    await sendMsg(`✅ Successfully [${token.symbol}] Token Buy done! <a href="${utils.getFullTxLink(txid)}">View on Solscan</a>`)

                } else {
                    console.log("------jito buy request is failed------");
                    await bot.sendInfoMessage(chatid, `❗ [${token.symbol}] Token Buy transaction failed!`)
                }
            }
            else{
                const simRes = await swap_engine.simulateVersionedTransaction(buyTrxs);
                console.log(user.username, "Buy Trx Simulation result = ", simRes);

                // // await sendMsg("Transaction sent. Confirmation might take longer than usual due to network congestion...")
                const txid = await swap_engine.sendVersionedTransaction(buyTrxs, 20);
                console.log(`https://solscan.io/tx/${txid}`);

                // await swap_engine.getVersionedTransactionStatus(txid);
                await swap_engine.confirmedTransaction(txid);

                // await bot.sendMessageSync(chatid, `✅ Successfully Buy done!`)
                await sendMsg(`✅ Successfully [${token.symbol}] Token Buy done! <a href="${utils.getFullTxLink(txid)}">View on Solscan</a>`)
                
                // taxProc(chatid, swapFee)    
                const taxLamperts = Math.floor(swapFee * LAMPORTS_PER_SOL)

                const result: string = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, global.get_tax_wallet_address(), taxLamperts)
                if (result == "success") {
                    console.log(`[${user.username}] ------Buy Tax transferSOL [${taxLamperts} lamports] is successed------`);
                } else {
                    console.log(`[${user.username}] ------Buy Tax transferSOL is failed------`);
                }

                if (refRewardFee >= constants.REFERRAL_FEE_LIMIT && user.referredBy)
                {
                    ReferralReward(chatid, refRewardFee, depositWallet.secretKey)
                }

                token.buyCount += 1;
                token.buyHistory += token.buyAmount;
            }

            // taxProc(chatid, swapFee)    
            // const taxLamperts = Math.floor(swapFee * LAMPORTS_PER_SOL)

            // const result: string = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, global.get_tax_wallet_address(), taxLamperts)
            // if (result == "success") {
            //     console.log(`[${user.username}] ------Buy Tax transferSOL [${taxLamperts} lamports] is successed------`);
            // } else {
            //     console.log(`[${user.username}] ------Buy Tax transferSOL is failed------`);
            // }

            // if (refRewardFee > 0 && user.referredBy)
            // {
            //     ReferralReward(chatid, refRewardFee, depositWallet.secretKey)
            // }

            // console.log(`----------buy tax amount = ${swapFee}, address = ${global.get_tax_wallet_address()}`)

        } catch (error) {
            console.log(`buy error -> ${error}`)
            await bot.sendInfoMessage(chatid, `❗ [${token.symbol}] Token Buy transaction failed!`)
        }
    }
    else {
        await bot.sendInfoMessage(chatid, `Poolkeys(${isLoadedPoolKeys}) fetching is failed, Buy SOL amount(${amount1}) is too small`)
    }

    await token.save()
}

export const sell = async (chatid: string, addr: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const token: any = await database.selectToken({ chatid, addr })
    let tokenBalance: number = await utils.getWalletTokenBalance(depositWallet, token.addr, token.decimal)

    let sellTokenBalance: number = 0;
    if (amount) {
        sellTokenBalance = tokenBalance * amount / 100
        let temp = Math.floor(sellTokenBalance * (10 ** token.decimal))
        sellTokenBalance = temp / (10 ** token.decimal)
    }

    // if (user.referredBy)
    // {
    //     let sellTokenPrice = 0
    //     const data: any = await birdeyeAPI.getTokenPriceInfo_Birdeye(addr)
    //     if(data && data.value) sellTokenPrice = data.value

    //     let sellTokenUSD = sellTokenBalance * sellTokenPrice
    //     let solPrice = await utils.getSOLPrice()

    //     if (sellTokenPrice && sellTokenUSD < (0.3 * solPrice))
    //     {
    //         let tokenAmount = utils.roundDecimal((0.3 * solPrice / sellTokenPrice), 2)

    //         await bot.sendMessageSync(chatid, `⚠️ You should sell the count of ${tokenAmount} token at least because of tax & referral fee`)
    //         console.log(`[${user.username}]⚠️ You should sell the count of ${tokenAmount} token at least because of tax & referral fee`)
    //         return   
    //     }
    // }


    if (sellTokenBalance <=0) {
        console.log(user.username, " ----------- no token balance to sell");
        return
    }

    // const bundleTransactions: any[] = []
    // const poolKeys: any = fastSwap.findPoolInfoForTokens(token.addr, token.baseAddr)
    // if (!poolKeys) {
    //     return
    // }
    // const { trxs }: any = await fastSwap.getSwapTransaction(depositWallet, token.addr, token.baseAddr, tokenBalance, token.poolKeys, token.slippage)
    // bundleTransactions.push(trxs)
    // await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)

    const isLoadedPoolKeys: boolean = await swap_engine.loadPoolKeys_from_market(
                                        token.addr,
                                        token.decimal,
                                        NATIVE_MINT.toString(),
                                        9
                                    );

    console.log(user.username, " ----------- sell token balance = ", sellTokenBalance);

    if (isLoadedPoolKeys && sellTokenBalance > 0){

        try {    
            
            let bundleTransactions: any[] = [];
            let simRes: any = null;

            // if (!await utils.IsTokenAccountInWallet(depositWallet, token.addr)) {
            //     console.log(`[${user.username}] ----------create token account-----------`);

            //     const trx: any = await fastSwap.getCreateAccountTransaction(depositWallet, token.addr)
            //     bundleTransactions.push(trx)

            //     const result: boolean = await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
            //     if (result) {
            //         console.log(`[${user.username}] ------jito token account request is successed------`);
            //     } else {
            //         console.log(`[${user.username}] ------jito token account request is failed------`);
            //     }
            //     bundleTransactions = []
            // }

            // let priority: number = user.stMevProtectEnabled ? user.stMevProtectFee + user.stTrxPriorityFee : user.stTrxPriorityFee;
            let priority: number = user.stMevProtectEnabled ? 0 : user.stTrxPriorityFee;
            priority = priority * LAMPORTS_PER_SOL;//token.priority*10**9;

            const { trxs: sellTrxs, amount: _amount }: any = await swap_engine.getSwapTransaction(
                                                                                depositWallet,
                                                                                token.addr,
                                                                                NATIVE_MINT.toString(),                                
                                                                                sellTokenBalance,
                                                                                token.sellSlippage,
                                                                                priority
                                                                            );

            if (!sellTrxs) {
                console.log("---------------------------------sell Trxs error")
                return
            }

            // if (user.referredBy && _amount < 0.3)
            // {
            //     await bot.sendMessageSync(chatid, `⚠️ You should sell tokens more than 0.3 sol at least because of tax & referral fee`)
            //     console.log(`[${user.username}]⚠️ You should sell tokens more than 0.3 sol at least because of tax & referral fee`)
            //     return   
            // }

            const session: any = bot.sessions.get(chatid)

            let rewardFlag = _amount >= 0.3 ? true : false;

            const { swapOrgFee, refRewardFee, swapFee } = swap.calcFee(_amount, session, rewardFlag)

            if (BLOXROUTE_USE) {
                bundleTransactions.push(sellTrxs)
                const txid:any = await bloXroute.buildBundlesOnBX(bundleTransactions, depositWallet.wallet, BLOXROUTE_TIP_AMOUNT)
                if (txid)
                    await bot.sendInfoMessage(chatid, `✅ Successfully [${token.symbol}] Token Sell done! <a href="${utils.getFullTxLink(txid)}">View on Solscan</a>`)
            }
            else if (user.stMevProtectEnabled)
            {
                console.log(`[${user.username}] ++++++++++ Jito Sell module starting .....`)
                bundleTransactions.push(sellTrxs)

                simRes = await swap_engine.simulateVersionedTransaction(sellTrxs);
                console.log(user.username, "Sell Trx Simulation result = ", simRes);

                if (swapFee >= constants.REFERRAL_FEE_LIMIT) {
                    const feeTrx : any = await fastSwap.getSolTransferTransaction(depositWallet.secretKey, global.get_tax_wallet_address(), swapFee)
                    // const feeTrx : any = await swap.getTransferSOLTrx(depositWallet.secretKey, global.get_tax_wallet_address(), swapFee);
                    bundleTransactions.push(feeTrx)

                    simRes = await swap_engine.simulateVersionedTransaction(feeTrx);
                    console.log(user.username, "Fee Trx Simulation result = ", simRes);
                }
                
                if (user.referredBy && refRewardFee >= constants.REFERRAL_FEE_LIMIT)
                {
                    console.log(`[${user.username}] ++++++++ Referral reward transaction generating ...`)
                    // let refRewardFee = 0.00085

                    const referralUser: any = await database.selectUser({ chatid: user.referredBy })
                    if (referralUser) 
                    {
                        // const rewardLamperts = Math.floor(refRewardFee * LAMPORTS_PER_SOL)                    
                        const refWallet: any = utils.getWalletFromPrivateKey(referralUser.referralWallet)

                        const referralFeeTrx : any = await fastSwap.getSolTransferTransaction(depositWallet.secretKey, refWallet.publicKey, refRewardFee)
                        bundleTransactions.push(referralFeeTrx)

                        simRes = await swap_engine.simulateVersionedTransaction(referralFeeTrx);
                        console.log(user.username, "Referral Fee Trx Simulation result = ", simRes);
                    }
                }
                
                const result: boolean = await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet, constants.JITO_BUNDLE_TIP)
                if (result) {
                    console.log("------jito sell request is successed------");
                    token.sellCount += 1;
                    token.sellHistory += Number(_amount);
                    const txid = base58.encode(bundleTransactions[0].signatures[0])
                    console.log(`https://solscan.io/tx/${txid}`);
                    await bot.sendInfoMessage(chatid, `✅ Successfully [${token.symbol}] Token Sell done! <a href="${utils.getFullTxLink(txid)}">View on Solscan</a>`)
                    
                } else {
                    console.log("------jito sell request is failed------");
                    await bot.sendInfoMessage(chatid, `❗ [${token.symbol}] Token Sell transaction failed!`)
                }
                bundleTransactions = []
            }
            else{

                const simRes = await swap_engine.simulateVersionedTransaction(sellTrxs);
                console.log(simRes);

                const txid = await swap_engine.sendVersionedTransaction(sellTrxs, 20);
                console.log(`https://solscan.io/tx/${txid}`);

                // await swap_engine.getVersionedTransactionStatus(txid);
                await swap_engine.confirmedTransaction(txid);

                // await bot.sendMessageSync(chatid, `✅ Successfully Sell done!`)
                await bot.sendInfoMessage(chatid, `✅ Successfully [${token.symbol}] Token Sell done! <a href="${utils.getFullTxLink(txid)}">View on Solscan</a>`)

                token.sellCount += 1;
                token.sellHistory += Number(_amount);

                // const { swapOrgFee, refRewardFee, swapFee } = swap.calcFee(_amount, session, true)
                // const taxFee = _amount * global.Swap_Fee_Percent / 100.0
                // taxProc(chatid, swapFee)    
                const taxLamports = Math.floor(swapFee * LAMPORTS_PER_SOL)

                console.log(`[${user.username}] ----------Sell tax amount = ${taxLamports}, address = ${global.get_tax_wallet_address()}`)

                const result: string = await swap_manager.transferSOL(database, chatid, depositWallet.secretKey, global.get_tax_wallet_address(), taxLamports)
                if (result == "success") {
                    console.log(`[${user.username}] ------Sell Tax transferSOL(${taxLamports} Lamports) is successed------`);
                } else {
                    console.log(`[${user.username}] ------Sell Tax transferSOL is failed------`);
                }

                if (refRewardFee >= constants.REFERRAL_FEE_LIMIT && user.referredBy)
                {
                    ReferralReward(chatid, refRewardFee, depositWallet.secretKey)
                }
            }

            console.log("================ sell history = ", Number(_amount))
            await token.save();

        } catch (error) {
            console.log(`Sell error -> ${error}`)
            await bot.sendInfoMessage(chatid, `❗ [${token.symbol}] Token Sell transaction failed!`)
        }            
    }
    else{
        await bot.sendInfoMessage(chatid, `Poolkeys(${isLoadedPoolKeys}) failed, Sell token balance(${sellTokenBalance}) is too small`)
    }

    // await user.save()
}

export const switchAutoBuyMode = async (chatid: string, addr: string) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.isAutoBuy = !token.isAutoBuy
    await token.save()
}

export const switchAutoSellMode = async (chatid: string, addr: string) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.isAutoSell = !token.isAutoSell
    await token.save()
}

export const setTakeProfit = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.takeProfit = amount
    await token.save()
}

export const setStopLoss = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.stopLoss = amount
    await token.save()
}

export const setAutoBuyAmount = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.autoBuyAmount = amount
    await token.save()
}

export const setAutoSellAmount = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.autoSellAmount = amount
    await token.save()
}

export const setPriority = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    token.priority = amount
    await token.save()
}

export const setPoolDetectionAmount = async (chatid: string, min: number, max: number) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    user.solDetectionMin = min
    user.solDetectionMax = max
    await user.save()
}

export const switchPoolDetectionPoolAmount = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    user.detectSolAmount = !user.detectSolAmount
    await user.save()
}

export const setPoolDetectionChangedPercent = async (chatid: string, amount: number) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    user.poolChanged = amount
    await user.save()
}

export const switchPoolDetectionPoolChanged = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    user.detectPoolChanged = !user.detectPoolChanged
    await user.save()
}

export const switchPoolDetectionPoolLocked = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    user.detectLocked = !user.detectLocked
    await user.save()
}

export const switchPoolDetectionMintable = async (chatid: string) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return
    }
    user.detectMintable = !user.detectMintable
    await user.save()
}