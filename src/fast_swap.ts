import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  VersionedTransaction, 
  TransactionMessage, 
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  Liquidity,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  LiquidityPoolJsonInfo,
  TokenAccount,
  Token,
  TokenAmount,
  TOKEN_PROGRAM_ID,
  Percent,
  SPL_ACCOUNT_LAYOUT,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@raydium-io/raydium-sdk'
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import bs58 from 'bs58'
import * as constants from './uniconst'
import * as utils from './utils'
import * as global from './global'

let PoolKeys: any = null
const TokenPriceMap = new Map()

export const addFetchPriceToken = (addr: string) => {
  TokenPriceMap.set(addr, "")
}

export const removeFetchPriceToken = (addr: string) => {
  TokenPriceMap.delete(addr)
}

export const loadPoolKeys = async () => {
  try {
    const liquidityJsonResp = await fetch(constants.RAYDIUM_POOL_KEY_URL as string);
    if (liquidityJsonResp.ok) {
      console.log("=========pool key loaded========")
      const liquidityJson = (await liquidityJsonResp.json()) as { official: any; unOfficial: any }
      const allPoolKeysJson = [...(liquidityJson?.official ?? []), ...(liquidityJson?.unOfficial ?? [])]

      PoolKeys = allPoolKeysJson
    }
  } catch (error) {
    console.log(error);

  }
  setTimeout(() => { loadPoolKeys() }, 1000)
}


export const findPoolInfoForTokens = (mintA: string, mintB: string) => {
  if (!PoolKeys) {
    return null
  }
  const poolData = PoolKeys.find(
    (i: any) => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA)
  )

  if (!poolData) return null

  return jsonInfo2PoolKeys(poolData) as LiquidityPoolKeys
}


export const getCreateAccountTransaction = async (payer: any, addr: string) => {
  const associatedToken = getAssociatedTokenAddressSync(
    new PublicKey(addr),
    payer.wallet.publicKey,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const transaction = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.wallet.publicKey,
      associatedToken,
      payer.wallet.publicKey,
      new PublicKey(addr),
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  const recentBlockhashForSwap = await global.web3Conn.getLatestBlockhash("finalized")
  const instructions = transaction.instructions

  // if (useVersionedTransaction) {
  const versionedTransaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.wallet.publicKey,
      recentBlockhash: recentBlockhashForSwap.blockhash,
      instructions: instructions,
    }).compileToV0Message()
  )

  versionedTransaction.sign([payer.wallet])

  return versionedTransaction
}

export const getSwapTransaction = async (
  payer: any,
  from: string,
  to: string,
  amount: number,
  poolKeys: LiquidityPoolKeys,
  slippage: number,
  maxLamports: number = constants.PRIORITY_RATE,
  fixedSide: 'in' | 'out' = 'in'
) => {
  const directionIn = to == poolKeys.quoteMint.toString()
  const { amountOut, minAmountOut, amountIn } = await calcAmountOut(poolKeys, amount, directionIn, slippage)

  // if (!directionIn) {
  //   await getOrCreateAssociatedTokenAccount(
  //     global.web3Conn,
  //     payer.wallet,
  //     new PublicKey(to),
  //     payer.wallet.publicKey,
  //   );
  // }
  const userTokenAccounts = await utils.getWalletTokenAccount(payer.wallet.publicKey, false)
  const swapTransaction = await Liquidity.makeSwapInstructionSimple({
    connection: global.web3Conn,
    makeTxVersion: 0,
    poolKeys: {
      ...poolKeys,
    },
    userKeys: {
      tokenAccounts: userTokenAccounts,
      owner: payer.wallet.publicKey,
    },
    amountIn: amountIn,
    amountOut: minAmountOut,
    fixedSide: fixedSide,
    config: {
      bypassAssociatedCheck: false,
    },
    computeBudgetConfig: {
      microLamports: maxLamports,
    },
  })

  const recentBlockhashForSwap = await global.web3Conn.getLatestBlockhash()
  const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean)

  // if (useVersionedTransaction) {
  const versionedTransaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.wallet.publicKey,
      recentBlockhash: recentBlockhashForSwap.blockhash,
      instructions: instructions,
    }).compileToV0Message()
  )

  versionedTransaction.sign([payer.wallet])

  return { trxs: versionedTransaction, amount: amountOut }
  // }

  // const legacyTransaction = new Transaction({
  //   blockhash: recentBlockhashForSwap.blockhash,
  //   lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
  //   feePayer: payer.publicKey,
  // })

  // legacyTransaction.add(...instructions)

  // return legacyTransaction
}

export const sendVersionedTransaction = async (tx: VersionedTransaction, maxRetries?: number) => {
  const txid = await global.web3Conn.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: maxRetries,
  })

  return txid
}

export const simulateVersionedTransaction = async (tx: VersionedTransaction) => {
  const txid = await global.web3Conn.simulateTransaction(tx)

  return txid
}

const getTokenAccountByOwnerAndMint = (mint: PublicKey) => {
  return {
    programId: TOKEN_PROGRAM_ID,
    pubkey: PublicKey.default,
    accountInfo: {
      mint: mint,
      amount: 0,
    },
  } as unknown as TokenAccount
}


const calcAmountOut = async (poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean, slippage: number) => {
  const poolInfo = await Liquidity.fetchInfo({ connection: global.web3Conn, poolKeys })

  let currencyInMint = poolKeys.baseMint
  let currencyInDecimals = poolInfo.baseDecimals
  let currencyOutMint = poolKeys.quoteMint
  let currencyOutDecimals = poolInfo.quoteDecimals

  if (!swapInDirection) {
    currencyInMint = poolKeys.quoteMint
    currencyInDecimals = poolInfo.quoteDecimals
    currencyOutMint = poolKeys.baseMint
    currencyOutDecimals = poolInfo.baseDecimals
  }

  const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
  const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
  const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
  const _slippage = new Percent(slippage, 100) // 5% slippage

  const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut,
    slippage: _slippage,
  })

  return {
    amountIn,
    amountOut: amountOut.toFixed(currencyOutDecimals),
    minAmountOut,
    currentPrice,
    executionPrice,
    priceImpact,
    fee,
  }
}

export const getSolTransferTransaction = async (pkey: string, destWallet: any, amount: number) => {
  
  const walletInfo: any | null = utils.getWalletFromPrivateKey(pkey)
  if (!walletInfo) {
      // sendMsg(`❗ Transfer failed: Invalid wallet.`)
      console.log(`============ Transfer failed: Invalid wallet.`)
      return false
  }

  const wallet: Keypair = walletInfo.wallet

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey(destWallet),
      // toPubkey: destWallet,
      lamports: Math.floor(amount * LAMPORTS_PER_SOL),
    })
  );

  // const instructions = [
  //   SystemProgram.transfer({
  //       fromPubkey: wallet.publicKey,
  //       toPubkey: new PublicKey(destWallet),
  //       lamports: Math.floor(amount * LAMPORTS_PER_SOL),
  //   })
  // ];
  
  const recentBlockhash = await utils.connection.getLatestBlockhash("finalized")
  const instructions = transaction.instructions

  // const recentBlockhash = await global.web3Conn.getLatestBlockhash("finalized")
  // const instructions = transaction.instructions

  // if (useVersionedTransaction) {
  const versionedTransaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: recentBlockhash.blockhash,
      instructions: instructions,
    }).compileToV0Message()
  )

  versionedTransaction.sign([wallet])
  
  return versionedTransaction
}