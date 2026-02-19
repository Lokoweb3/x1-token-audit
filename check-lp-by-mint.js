#!/usr/bin/env node
/**
 * Check LP burn by LP mint address directly
 */

const { Connection, PublicKey } = require("@solana/web3.js");

const BURN_ADDRESSES = [
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
  "1111111111111111111111111111111111111111111",
];

const DEFAULT_RPC = process.env.X1_RPC_URL || "https://rpc.mainnet.x1.xyz";

function shortAddr(addr, len = 6) {
  if (!addr) return "N/A";
  return addr.length > len * 2 ? `${addr.slice(0, len)}...${addr.slice(-len)}` : addr;
}

function formatNumber(n) {
  if (typeof n === "string") n = parseFloat(n);
  if (isNaN(n)) return "N/A";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(4);
}

async function main() {
  const lpMintAddress = process.argv[2];
  
  if (!lpMintAddress) {
    console.error("Usage: node check-lp-by-mint.js <LP_MINT_ADDRESS>");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          LP Token Burn Checker                           ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const connection = new Connection(DEFAULT_RPC, "confirmed");
  const lpMintPubkey = new PublicKey(lpMintAddress);

  // Get LP mint info
  const mintInfo = await connection.getParsedAccountInfo(lpMintPubkey);
  if (!mintInfo.value) {
    console.error("❌ LP mint not found");
    process.exit(1);
  }

  console.log(`LP Mint: ${lpMintAddress}\n`);

  // Parse mint data
  const data = mintInfo.value.data;
  let totalSupply = 0;
  let decimals = 0;
  
  if (data.length >= 82) {
    const supplyLow = BigInt(data.readUInt32LE(36));
    const supplyHigh = BigInt(data.readUInt32LE(40));
    totalSupply = Number((supplyHigh << BigInt(32)) | supplyLow);
    decimals = data.readUInt8(44);
  }

  const supplyUi = totalSupply / Math.pow(10, decimals);
  console.log(`Total Supply: ${formatNumber(supplyUi)}`);
  console.log(`Decimals: ${decimals}\n`);

  // Check all holders using getTokenLargestAccounts
  console.log("📋 Checking LP token holders...\n");
  
  let largestAccounts;
  try {
    largestAccounts = await connection.getTokenLargestAccounts(lpMintPubkey);
  } catch (err) {
    console.log(`   Could not fetch holder data: ${err.message}`);
    largestAccounts = { value: [] };
  }

  const holders = [];
  let burnAmount = 0;
  
  for (const account of largestAccounts.value || []) {
    try {
      const accountInfo = await connection.getParsedAccountInfo(account.address);
      if (!accountInfo.value) continue;
      
      const info = accountInfo.value.data.parsed?.info;
      if (!info) continue;
      
      const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
      const isBurn = BURN_ADDRESSES.includes(info.owner);
      
      holders.push({
        address: info.owner,
        amount: amount,
        isBurnAddress: isBurn,
      });
      
      if (isBurn) {
        burnAmount += amount;
      }
    } catch {
      // Skip
    }
  }

  holders.sort((a, b) => b.amount - a.amount);

  console.log(`Top Accounts Checked: ${holders.length}`);
  console.log(`Burned in Incinerator: ${formatNumber(burnAmount)}\n`);

  if (burnAmount > 0 && supplyUi > 0) {
    const pct = (burnAmount / supplyUi) * 100;
    console.log(`🔥 BURN PERCENTAGE: ${pct.toFixed(2)}%\n`);
  }

  console.log("Top Holders:");
  holders.slice(0, 10).forEach((h, i) => {
    const burnTag = h.isBurnAddress ? " 🔥🔥🔥 BURN ADDRESS" : "";
    console.log(`  ${(i + 1).toString().padStart(2)}. ${shortAddr(h.address, 8)}: ${formatNumber(h.amount).padStart(12)}${burnTag}`);
  });

  // Check burn transactions
  console.log("\n📜 Checking burn transaction history...\n");
  
  const signatures = await connection.getSignaturesForAddress(lpMintPubkey, { limit: 100 });
  const burnTxs = [];

  for (const sigInfo of signatures) {
    try {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) continue;

      // Look for transfers to burn addresses
      if (tx.transaction?.message?.instructions) {
        for (const ix of tx.transaction.message.instructions) {
          if (!ix.parsed) continue;

          if (ix.parsed.type === "transfer" || ix.parsed.type === "transferChecked") {
            const destOwner = ix.parsed.info?.owner || ix.parsed.info?.destination || "";
            
            if (BURN_ADDRESSES.includes(destOwner)) {
              burnTxs.push({
                signature: sigInfo.signature,
                date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : "Unknown",
                amount: parseFloat(ix.parsed.info?.amount || 0) / Math.pow(10, decimals),
              });
            }
          }
        }
      }
    } catch {
      // Skip
    }
  }

  if (burnTxs.length > 0) {
    console.log(`✅ Found ${burnTxs.length} burn transaction(s):\n`);
    burnTxs.forEach((tx, i) => {
      console.log(`  ${i + 1}. ${formatNumber(tx.amount)} LP tokens burned`);
      console.log(`     Date: ${tx.date.slice(0, 10)}`);
      console.log(`     TX: ${shortAddr(tx.signature, 12)}`);
      console.log(`     Explorer: https://explorer.mainnet.x1.xyz/tx/${tx.signature}`);
      console.log();
    });
  } else {
    console.log("No burn transactions found in recent history.");
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("                        SUMMARY                            ");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\nLP Mint: ${lpMintAddress}`);
  console.log(`Total Supply: ${formatNumber(supplyUi)}`);
  console.log(`Burned: ${formatNumber(burnAmount)} (${burnAmount > 0 && supplyUi > 0 ? ((burnAmount / supplyUi) * 100).toFixed(2) : 0}%)`);
  console.log(`Status: ${burnAmount > 0 ? "🔥 LP BURNED" : "⚠️ LP NOT BURNED"}`);
}

main().catch(console.error);
