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
import {
  Market,
  MARKET_STATE_LAYOUT_V3,

} from '@project-serum/serum';
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import bs58 from 'bs58'
import * as utils from './utils'
import * as constants from './uniconst';
import { loadPoolKeys, updatePoolKeys } from './db';

let PoolKeys: any = null
export const PoolKeysMap = new Map()

export const loadPoolKeys_from_market = async (base: string, baseDecimal: number, quote: string, quoteDecimal: number) => {
  PoolKeys = PoolKeysMap.get(base);
  if (PoolKeys && (PoolKeys.baseMint.toString() === base || PoolKeys.quoteMint.toString() === base)) {
    // console.log(`[loadPoolKeys_from_market] - 0 : address = ${base}`)
    return true
  }

  try {
    let poolKeys: any = await loadPoolKeys(base)
    if(poolKeys && poolKeys.baseMint == base) {
      PoolKeysMap.set(base, poolKeys)
      PoolKeys = poolKeys
      return true
    }
  }
  catch(error) {
    console.log(error);
  }

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
    PoolKeysMap.set(base, poolKeys)
    PoolKeys = poolKeys
    updatePoolKeys(poolKeys)
    return true
  } catch (error) {
    console.log(error);
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
    PoolKeysMap.set(base, poolKeys)
    PoolKeys = poolKeys
    updatePoolKeys(poolKeys)
    return true
  } catch (error) {
    console.log(error);
  }
  return false
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
  const recentBlockhashForSwap = await utils.connection.getLatestBlockhash("finalized")
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
  slippage: number,  
  maxLamports: number = constants.PRIORITY_RATE,
  poolKeys: LiquidityPoolKeys = PoolKeys,
  fixedSide: 'in' | 'out' = 'in'
) => {
  const directionIn = to == poolKeys.quoteMint.toString()
  const { amountOut, minAmountOut, amountIn } = await calcAmountOut(poolKeys, amount, directionIn, slippage)

  // console.log(`[getSwapTransaction] -> amountOut = ${amountOut}, minAmountOut = ${minAmountOut.toFixed(poolKeys.quoteDecimals)}, amountIn = ${(amountIn)}`)

  // if (!directionIn) {
  //   await getOrCreateAssociatedTokenAccount(
  //     utils.connection,
  //     payer.wallet,
  //     new PublicKey(to),
  //     payer.wallet.publicKey,
  //   );
  // }
  const userTokenAccounts = await utils.getWalletTokenAccount(payer.wallet.publicKey, false)
  const swapTransaction = await Liquidity.makeSwapInstructionSimple({
    connection: utils.connection,
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

  const recentBlockhashForSwap = await utils.connection.getLatestBlockhash("finalized")
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
  const txid = await utils.connection.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: maxRetries,
  })

  return txid
}

export const confirmedTransaction = async (signature: string) => {
  const trxid = await utils.connection.confirmTransaction(signature);
  // console.log("Trx Id: ", trxid);

  return trxid
}

export async function getVersionedTransactionStatus(signature: string): Promise<void> {
  try {
      // Fetch the transaction details
      const transaction: VersionedTransactionResponse | null = await utils.connection.getTransaction(signature, {
          commitment: 'confirmed',
      });

      if (transaction) {
          console.log('Transaction confirmed:', transaction);
          if (transaction.meta && transaction.meta.err === null) {
              console.log('Transaction was successful');
          } else {
              console.log('Transaction failed:', transaction.meta?.err);
          }
      } else {
          console.log('Transaction not found or not confirmed yet');
          // await utils.sleep(1000)
          // return await getVersionedTransactionStatus(signature)
      }
  } catch (error) {
      console.error('Error confirming transaction:', error);

      // await utils.sleep(1000)
      // return await getVersionedTransactionStatus(signature)
  }
}
export const simulateVersionedTransaction = async (tx: VersionedTransaction) => {
  const txid = await utils.connection.simulateTransaction(tx)

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
  const poolInfo = await Liquidity.fetchInfo({ connection: utils.connection, poolKeys })

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
  // const slippage = new Percent(20, 100) // 5% slippage
  const _slippage = new Percent(slippage, 100) // 5% slippage

  console.log("[calcAmountOut] slippage =", _slippage)

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