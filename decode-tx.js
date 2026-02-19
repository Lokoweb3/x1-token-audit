#!/usr/bin/env node
/**
 * decode-tx.js
 * ===========================================
 * Transaction Decoder for X1 Blockchain
 * ===========================================
 *
 * Decodes and interprets transactions on X1 mainnet.
 * Shows detailed breakdown of instructions and token balance changes.
 *
 * Usage:
 *   node decode-tx.js <TX_SIGNATURE>
 *   node decode-tx.js <TX_SIGNATURE> --rpc https://custom-rpc.example.com
 *
 * Requirements:
 *   npm install @solana/web3.js@1
 */

const { Connection } = require("@solana/web3.js");
const https = require("https");

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const DEFAULT_RPC = process.env.X1_RPC_URL || "https://rpc.mainnet.x1.xyz";

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function parseArgs() {
  const args = process.argv.slice(2);
  let txSignature = null;
  let rpcUrl = DEFAULT_RPC;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rpc" && args[i + 1]) {
      rpcUrl = args[++i];
    } else if (!args[i].startsWith("-") && !txSignature) {
      txSignature = args[i];
    }
  }

  if (!txSignature) {
    console.error("Usage: node decode-tx.js <TX_SIGNATURE> [--rpc <RPC_URL>]");
    console.error("");
    console.error("Examples:");
    console.error("  node decode-tx.js 5xGq...vK7p");
    console.error("  node decode-tx.js 5xGqvK7p... --rpc https://rpc.mainnet.x1.xyz");
    process.exit(1);
  }

  return { txSignature, rpcUrl };
}

function shortAddr(addr, len = 6) {
  if (!addr) return "N/A";
  const s = typeof addr === "string" ? addr : addr.toBase58();
  return s.length > len * 2 ? `${s.slice(0, len)}...${s.slice(-len)}` : s;
}

function formatNumber(n, decimals = 9) {
  if (typeof n === "string") n = parseFloat(n);
  if (isNaN(n)) return "N/A";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(n < 1 ? 6 : 2);
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON response"));
        }
      });
    }).on("error", reject);
  });
}

async function decodeTransaction(connection, txSignature) {
  try {
    const tx = await connection.getTransaction(txSignature, {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0
    });

    return tx;
  } catch (err) {
    console.error(`❌ Error fetching transaction: ${err.message}`);
    return null;
  }
}

function parseTokenAmount(amountObj, decimals = 9) {
  if (!amountObj) return 0;
  
  // Try parsed format first
  if (amountObj.uiAmount !== undefined) {
    return parseFloat(amountObj.uiAmount || 0);
  }
  
  // Try raw amount
  if (amountObj.amount !== undefined) {
    return parseFloat(amountObj.amount) / Math.pow(10, decimals);
  }
  
  return 0;
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
async function main() {
  const { txSignature, rpcUrl } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║           X1 Transaction Decoder                         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Transaction: ${txSignature}`);
  console.log(`RPC:         ${rpcUrl}\n`);

  const connection = new Connection(rpcUrl, "confirmed");

  // Fetch transaction
  console.log("⏳ Fetching transaction...");
  const tx = await decodeTransaction(connection, txSignature);

  if (!tx) {
    console.error("\n❌ Transaction not found or failed to decode");
    process.exit(1);
  }

  if (!tx.meta) {
    console.error("\n❌ Transaction has no metadata (may be pre-vote transaction)");
    process.exit(1);
  }

  // Basic info
  const slot = tx.slot;
  const blockTime = tx.blockTime;
  
  if (blockTime) {
    const dt = new Date(blockTime * 1000);
    console.log(`Date/Time:   ${dt.toISOString().replace("T", " ").replace("Z", " UTC")}`);
  }
  
  console.log(`Slot:        ${slot}`);

  // Status
  const err = tx.meta.err;
  console.log(`Status:      ${err ? `❌ Failed: ${JSON.stringify(err)}` : "✅ Success"}`);

  // Fee
  const fee = tx.meta.fee;
  console.log(`Fee:         ${formatNumber(fee / 1e9, 9)} XN\n`);

  // Instructions
  const message = tx.transaction?.message;
  const instructions = message?.instructions || [];

  console.log("═".repeat(70));
  console.log("INSTRUCTIONS");
  console.log("═".repeat(70));

  for (let i = 0; i < instructions.length; i++) {
    const ix = instructions[i];
    const programId = ix.programId;
    
    // Try to resolve program name
    let programName = "Unknown";
    const programIdStr = programId.toBase58 && programId.toBase58() || programId;
    
    // Common program names
    const programs = {
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "SPL Token-2022",
      "11111111111111111111111111111111": "System Program",
      "MemoSq4gqABAXKb96qN96xnd7Y5g3QZnDUzjL8y4Xw8": "Memo Program"
    };
    
    if (programs[programIdStr]) {
      programName = programs[programIdStr];
    }

    console.log(`\n${i + 1}. Program: ${programName} (${shortAddr(programIdStr, 4)})`);

    // Handle parsed vs raw instruction
    if (ix.parsed && ix.parsed.type) {
      const parsed = ix.parsed;
      const info = parsed.info || {};
      
      console.log(`   Type: ${parsed.type}`);
      
      // Transfer
      if (parsed.type === "transfer" || parsed.type === "transferChecked") {
        const source = info.source || "";
        const dest = info.destination || "";
        const amount = parseTokenAmount(info, 9);
        const mint = info.mint || "";
        
        console.log(`   From:  ${shortAddr(source)}`);
        console.log(`   To:    ${shortAddr(dest)}`);
        console.log(`   Amount: ${formatNumber(amount, 9)}`);
        if (mint) {
          console.log(`   Mint:  ${shortAddr(mint, 4)}`);
        }
      }
      // Swap (AMM)
      else if (parsed.type === "swap") {
        const source = info.source || "";
        const destination = info.destination || "";
        const amountIn = parseTokenAmount(info, 9);
        const amountOut = parseTokenAmount(info, 9);
        
        console.log(`   From:  ${shortAddr(source)}`);
        console.log(`   To:    ${shortAddr(destination)}`);
        console.log(`   In:    ${formatNumber(amountIn, 9)}`);
        console.log(`   Out:   ${formatNumber(amountOut, 9)}`);
      }
      // InitializeAccount
      else if (parsed.type === "initializeAccount") {
        console.log(`   Account: ${shortAddr(info.account || "")}`);
        console.log(`   Owner:   ${shortAddr(info.owner || "")}`);
      }
      // Approve
      else if (parsed.type === "approve") {
        console.log(`   Account:  ${shortAddr(info.account || "")}`);
        console.log(`   Delegate: ${shortAddr(info.delegate || "")}`);
        console.log(`   Amount:   ${formatNumber(parseTokenAmount(info, 9), 9)}`);
      }
      // CloseAccount
      else if (parsed.type === "closeAccount") {
        console.log(`   Account:  ${shortAddr(info.account || "")}`);
        console.log(`   Destination: ${shortAddr(info.destination || "")}`);
      }
      // Default detailed view
      else {
        for (const [key, value] of Object.entries(info)) {
          if (typeof value === "string" && value.length > 50) {
            console.log(`   ${key}: ${value.slice(0, 47)}...`);
          } else {
            console.log(`   ${key}: ${value}`);
          }
        }
      }
    } else {
      // Raw instruction - show data
      const data = ix.data || "";
      console.log(`   Data: ${data.slice(0, 80)}${data.length > 80 ? "..." : ""}`);
      
      if (ix.accounts && ix.accounts.length > 0) {
        console.log(`   Accounts:`);
        for (let j = 0; j < ix.accounts.length; j++) {
          console.log(`     [${j}] ${shortAddr(ix.accounts[j], 4)}`);
        }
      }
    }
  }

  // Token balance changes
  const preBalances = tx.meta.preTokenBalances || [];
  const postBalances = tx.meta.postTokenBalances || [];

  if (preBalances.length > 0 || postBalances.length > 0) {
    console.log("\n" + "═".repeat(70));
    console.log("TOKEN BALANCE CHANGES");
    console.log("═".repeat(70));

    // Build a map of account+mint to balances
    const balanceMap = new Map();

    for (const bal of preBalances) {
      const key = `${bal.accountIndex}_${bal.mint}`;
      balanceMap.set(key, {
        mint: bal.mint,
        owner: bal.owner,
        pre: parseTokenAmount(bal.uiTokenAmount, bal.decimals),
        post: 0,
        decimals: bal.decimals || 9
      });
    }

    for (const bal of postBalances) {
      const key = `${bal.accountIndex}_${bal.mint}`;
      if (balanceMap.has(key)) {
        const existing = balanceMap.get(key);
        existing.post = parseTokenAmount(bal.uiTokenAmount, bal.decimals);
      } else {
        balanceMap.set(key, {
          mint: bal.mint,
          owner: bal.owner,
          pre: 0,
          post: parseTokenAmount(bal.uiTokenAmount, bal.decimals),
          decimals: bal.decimals || 9
        });
      }
    }

    let hasChanges = false;
    for (const [key, data] of balanceMap) {
      const diff = data.post - data.pre;
      if (diff !== 0) {
        hasChanges = true;
        const direction = diff > 0 ? "📈" : "📉";
        const sign = diff > 0 ? "+" : "";
        
        console.log(`\n  Token: ${shortAddr(data.mint, 4)}`);
        console.log(`  Owner: ${shortAddr(data.owner, 4)}`);
        console.log(`  Change: ${direction} ${sign}${formatNumber(diff, data.decimals)} (${formatNumber(data.pre, data.decimals)} → ${formatNumber(data.post, data.decimals)})`);
      }
    }

    if (!hasChanges) {
      console.log("\n  No token balance changes detected");
    }
  }

  // Log messages (first 10)
  const logMessages = tx.meta.logMessages || [];
  if (logMessages.length > 0) {
    console.log("\n" + "═".repeat(70));
    console.log("LOG MESSAGES (first 10)");
    console.log("═".repeat(70));
    for (let i = 0; i < Math.min(10, logMessages.length); i++) {
      console.log(`  ${logMessages[i]}`);
    }
    if (logMessages.length > 10) {
      console.log(`  ... and ${logMessages.length - 10} more`);
    }
  }

  // Explorer link
  console.log("\n" + "═".repeat(70));
  console.log(`🔗 Explorer: https://explorer.mainnet.x1.xyz/tx/${txSignature}`);
  console.log("═".repeat(70));
}

main().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
