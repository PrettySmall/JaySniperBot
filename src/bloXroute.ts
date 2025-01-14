import { createTraderAPIMemoInstruction, HttpProvider, MAINNET_API_GRPC_PORT, MAINNET_API_NY_GRPC, PostSubmitRequestEntry } from "@bloxroute/solana-trader-client-ts"
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import base58 from "bs58";
import { AxiosRequestConfig } from "axios";
import axios from 'axios';
import dotenv from 'dotenv'
dotenv.config()

const TRADER_API_TIP_WALLET = "HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY"
const AUTH_HEADER = process.env.BLOXROUTE_AUTH_HEADER!

const requestConfig: AxiosRequestConfig = {
  timeout: 30_000,
}

const provider = new HttpProvider(
  AUTH_HEADER,
  process.env.PRIVATE_KEY
)

// createTraderAPIMemoInstruction generates a transaction instruction that places a memo in the transaction log
// Having a memo instruction with signals Trader-API usage is required
export function CreateTraderAPITipInstruction(
  senderAddress: PublicKey,
  tipAmount: number
): TransactionInstruction {
  const tipAddress = new PublicKey(TRADER_API_TIP_WALLET)

  return SystemProgram.transfer({
    fromPubkey: senderAddress,
    toPubkey: tipAddress,
    lamports: tipAmount,
  })
}

export async function buildBundlesOnBX(
  txs: VersionedTransaction[],
  signer: Keypair,
  tip: number,
  skipPreFlight: boolean = true) {
  const entries: PostSubmitRequestEntry[] = [];

  const blrxTipInstr = CreateTraderAPITipInstruction(signer.publicKey, tip * LAMPORTS_PER_SOL)
  
  const memo = createTraderAPIMemoInstruction("")
  const tx = txs[0]
  const swapInstructions = TransactionMessage.decompile(tx.message).instructions
  const blxrTipInstructions = [blrxTipInstr, memo]

  // make transactions
  // console.time(`[RIDER] sumulation-compute-units`)
  // let units = await getSimulationComputeUnits(
  //   connection,
  //   [...swapInstructions, ...blxrTipInstructions],
  //   signer.publicKey, []
  // )

  const latestBlockhash = await provider.getRecentBlockHash({})

  // console.timeEnd(`[RIDER] sumulation-compute-units`)
  // let modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
  //   units: units ? units + 500 : 80000
  //   // 100000000 
  // });
  // let addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
  //   microLamports: 1000000
  // });


  const swapMessage = new Transaction({
    recentBlockhash: latestBlockhash.blockHash,
    feePayer: signer.publicKey,
  })
  .add (...swapInstructions)
  .add (...blxrTipInstructions)
  // const swapMessage = new VersionedTransaction(
  //   new TransactionMessage({
  //     recentBlockhash: latestBlockhash.blockHash,
  //     payerKey: signer.publicKey,
  //     instructions: [modifyComputeUnits, addPriorityFee , ...swapInstructions, ...blxrTipInstructions],
  //   }).compileToV0Message()
  // )

  swapMessage.sign(signer)
  let buff = Buffer.from(swapMessage.serialize())
  let encodedTxn = buff.toString("base64");

  const response = await provider.postSubmit({
    transaction: {
      content: encodedTxn,
      isCleanup: false
    },
    skipPreFlight: false
  })
  // await provider.postSubmitBatch({
  //   entries,
  //   submitStrategy: "P_SUBMIT_ALL",
  //   useBundle: true
  // });
  
  console.log(`Bloxroute Transaction hash : ${response.signature}`);
  // try {
  //   const res = await axios.get(`https://ny.solana.dex.blxrbdn.com/api/v2/transaction?signature=${response.signature}`, {
  //       headers: {
  //           'Authorization': AUTH_HEADER,
  //           'Content-Type': 'application/json'
  //       }
  //   });
  //   console.log(res.data);
    
  // } catch (error: any) {
  //     console.error('Error bundling:', error.response ? error.response.data : error.message);

  // }

  return response.signature
}