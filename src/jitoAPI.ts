import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import * as global from "./global";
import { 
	LAMPORTS_PER_SOL, 
	PublicKey, 
	Keypair, 
	SystemProgram, 
	TransactionMessage, 
	VersionedTransaction,
	Connection 
} from "@solana/web3.js";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types.js";
import * as constants from "./uniconst"
import * as utils from "./utils"
import { log } from "console";
import base58 from "bs58";

import axios from "axios";

let count: number = 0

const DELAYTIME = 2 * 60 * 1000;

const getAPIKeyIndex = () => {
	count++
	if (count >= constants.JITO_AUTH_KEYS.length) {
		count = 0
	}
	console.log("-------key index-------", count);

	return count
}

export const createAndSendBundleTransaction = async (bundleTransactions: any, payer: any, fee: number) => {
	// const wallet = utils.getWalletFromPrivateKey(constants.JITO_AUTH_KEYS[6])
	const wallet = utils.getWalletFromPrivateKey(String(process.env.JITO_AUTH_KEY))
	const searcher = searcherClient(
		global.get_jito_block_api(),
		wallet.wallet
	);

	console.log("---------searcherClient----")

	const _tipAccount = (await searcher.getTipAccounts())[0];
	const tipAccount = new PublicKey(_tipAccount);

	let transactionsConfirmResult: boolean = false
	let breakCheckTransactionStatus: boolean = false
	try {
		const recentBlockhash = (await global.web3Conn.getLatestBlockhash("finalized")).blockhash;
		let bundleTx = new Bundle(bundleTransactions, 5);
		bundleTx.addTipTx(payer, fee * LAMPORTS_PER_SOL, tipAccount, recentBlockhash);

		searcher.onBundleResult(
			async (bundleResult: any) => {
				console.log(bundleResult);

				if (bundleResult.rejected) {
					try {
						if (bundleResult.rejected.simulationFailure.msg.includes("custom program error") ||
							bundleResult.rejected.simulationFailure.msg.includes("Error processing Instruction")) {
							breakCheckTransactionStatus = true
						}
						else if (bundleResult.rejected.simulationFailure.msg.includes("This transaction has already been processed") ||
							bundleResult.rejected.droppedBundle.msg.includes("Bundle partially processed")) {
							transactionsConfirmResult = true
							breakCheckTransactionStatus = true
						}
					} catch (error) {
						console.log("============bundle rejected error :", error)
					}
				}
			},
			(error) => {
				console.log("Bundle error:", error);
				breakCheckTransactionStatus = true
			}
		);
		await searcher.sendBundle(bundleTx);
		setTimeout(() => { breakCheckTransactionStatus = true }, 20000)
		const trxHash = base58.encode(bundleTransactions[bundleTransactions.length - 1].signatures[0])
		
		console.log("======Jito trx Hash : ", trxHash)

		while (!breakCheckTransactionStatus) {
			await utils.sleep(2000)
			try {
				const result = await global.web3Conn.getSignatureStatus(trxHash, {
					searchTransactionHistory: true,
				});
				if (result && result.value && result.value.confirmationStatus) {
					transactionsConfirmResult = true
					breakCheckTransactionStatus = true
				}
			} catch (error) {
				transactionsConfirmResult = false
				breakCheckTransactionStatus = true
			}
		}
		return transactionsConfirmResult
	} catch (error) {
		console.error("Creating and sending bundle failed...", error);
		return false
	}
};

////////////////////////////////////////////////////////////////
//  Jito Bundle using Json mode(API post request)

// 	example : Search mode and Json mode
// 	const bundleTransactions: any[] = []
//	const { trx }: any = await swap_manager.transferSOL(...)
// 	bundleTransactions.push(trx)
//  1 mode: 
// 	await Jito.createAndSendBundleTransaction(bundleTransactions, depositWallet.wallet: Keypair, constants.JITO_BUNDLE_TIP)
//	.........
//  2 mode:
//  bundleTransactions.push(await Jito.getTipTransaction(global.web3Conn, depositWallet.wallet: Keypair, constants.JITO_BUNDLE_TIP))
//	const result: boolean = await Jito.createAndSendBundle(global.web3Conn, bundleTransactions)

////////////////////////////////////////////////////////////////

async function sendBundle(url:any, bundleTx:any) {
    // if(!bundleTx.transactions || bundleTx.transactions.length == 0) return
    if(!bundleTx || bundleTx.length == 0) return

    let serializedTxns: any[] = []
    for(let i = 0; i < bundleTx.length; i++) {
        const txn = bundleTx[i]
        serializedTxns.push(base58.encode(txn.serialize()))
    }
    
    // console.log('serializedTxns = ')
    // console.log(serializedTxns)

    let bundlId = ''
    let executeResult = false
    let retryCount = 0
    while(!executeResult) {
        try {
            const response = await axios.post(url, {
                jsonrpc: '2.0',
                id: 1,
                method: 'sendBundle',
                params: [serializedTxns],
            })
            if(response.data) {
                executeResult = true
                bundlId = response.data.result
            }
            console.log('sendBundle-> response.data = ')
            console.log(response.data)
            retryCount++
            if(retryCount > 10) break
        } catch (error) {
            // console.log(error.toString())
            await utils.sleep(2000);
            break
        }
    }
    return bundlId
}

async function getBundleStatuses(url:any, bundlId:any) {
    let resultValue = null
    let executeResult = false
    let retryCount = 0
    console.log('getBundleStatuses-> bundlId = ' + bundlId)
    while(!executeResult) {
        try {
            const response = await axios.post(url, {
                jsonrpc: '2.0',
                id: 1,
                method: 'getBundleStatuses',
                params: [[bundlId]],
            })
            // console.log('getBundleStatuses-> response.data = ')
            // console.log(response.data)
            if(response.data && response.data.result && response.data.result.value && response.data.result.value.length > 0) {
                resultValue = response.data.result.value[0]
                executeResult = true
            }
            retryCount++
            if(retryCount > 50) break
        } catch (error:any) {
            console.log(error.toString())
        }
    }
    return resultValue
}

export async function getTipTransaction(connection:any, payer:Keypair, tip:number) {
	const TIP_ADDRESSES = [
	  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5", // Jitotip 1
	  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe", // Jitotip 2
	  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY", // Jitotip 3
	  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49", // Jitotip 4
	  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh", // Jitotip 5
	  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt", // Jitotip 6
	  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL", // Jitotip 7
	  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT", // Jitotip 8
	];
	// const getRandomNumber = (min, max) => {
	//     return Math.floor(Math.random() * (max - min + 1)) + min;
	// };
	console.log("Adding tip transactions...");
  
	let rndIndex = Math.floor(Math.random() * TIP_ADDRESSES.length)
	console.log(`=============== tipAccountIndex =`, rndIndex)
	const tipAccount = new PublicKey(TIP_ADDRESSES[rndIndex]);
	const instructions = [
	  SystemProgram.transfer({
		fromPubkey: payer.publicKey,
		toPubkey: tipAccount,
		lamports: LAMPORTS_PER_SOL * tip,
	  }),
	];
	const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
	const messageV0 = new TransactionMessage({
	  payerKey: payer.publicKey,
	  recentBlockhash,
	  instructions,
	}).compileToV0Message();
  
	const versionedTransaction = new VersionedTransaction(messageV0);
    versionedTransaction.sign([payer]);

	return versionedTransaction;
}

export async function createAndSendBundle(connection:Connection, bundleTranasction:any) {
    
    let txnConfirmResult = false;
    let breakCheckTransactionStatus = false;
    // const jitoBlockEngine = 'frankfurt.mainnet.block-engine.jito.wtf'
	const jitoBlockEngine = 'amsterdam.mainnet.block-engine.jito.wtf'
    let jitoRpcUrl = 'https://' + jitoBlockEngine + '/api/v1/bundles'
    let nTryCount = 0
    while(nTryCount < 10) {
        try {                
            console.log("Send");
            let bundleId = await sendBundle(jitoRpcUrl, bundleTranasction)
            if(bundleId == '') {
                nTryCount++
                continue
            }
            let bundleState:any = await getBundleStatuses(jitoRpcUrl, bundleId)
            if(bundleState && bundleState.bundleId && bundleState.bundleId == bundleId) {
                breakCheckTransactionStatus = true
                if(bundleState.confirmation_status == 'confirmed' ||
                    bundleState.confirmation_status == 'finalized'
                ) txnConfirmResult = true
                else txnConfirmResult = false
            }
            console.log("Finish send");
            setTimeout(() => {
                breakCheckTransactionStatus = true;
            }, 20000);
            const txnHash = base58.encode(bundleTranasction[bundleTranasction.length - 1].signatures[0]);
            // console.log(txnHash);
            while (!breakCheckTransactionStatus) {
                await utils.sleep(1000);
                try {
                    const result = await connection.getSignatureStatus(txnHash, {
                        searchTransactionHistory: true
                    });
                    if (result && result.value && result.value.confirmationStatus) {
                        txnConfirmResult = true;
                        breakCheckTransactionStatus = true;
                    }
                }
                catch (error) {
                    txnConfirmResult = false;
                    breakCheckTransactionStatus = false;
                }
            }
            if (txnConfirmResult) {
                return true;
            }
            else {
                console.log(`Bundle Error: failed`)
            }
        }
        catch (error:any) {
            console.log(error.toString())
            await utils.sleep(1000);
        }
    }
    return false
}