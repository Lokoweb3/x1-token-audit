#!/usr/bin/env node
/**
 * Check if initial LP was burned by analyzing transaction history
 */

const { Connection, PublicKey } = require("@solana/web3.js");

const DEFAULT_RPC = process.env.X1_RPC_URL || "https://rpc.mainnet.x1.xyz";
const XDEX_API = "https://api.xdex.xyz/api";

const BURN_ADDRESSES = [
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
  "1111111111111111111111111111111111111111111",
];

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
  return n.toFixed(2);
}

async function fetchJSON(url) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON"));
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  const tokenAddress = process.argv[2];
  if (!tokenAddress) {
    console.error("Usage: node check-initial-lp-burn.js <TOKEN_MINT_ADDRESS>");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Initial LP Burn Checker                         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const connection = new Connection(DEFAULT_RPC, "confirmed");

  // Get pools from XDEX
  console.log("🔍 Finding XDEX pools...");
  const poolList = await fetchJSON(`${XDEX_API}/xendex/pool/list`);
  const pools = (poolList.data || []).filter(p => 
    p.token1_address === tokenAddress || p.token2_address === tokenAddress
  );

  if (pools.length === 0) {
    console.log("❌ No pools found");
    process.exit(1);
  }

  console.log(`✅ Found ${pools.length} pool(s)\n`);

  // Analyze each pool
  for (const pool of pools) {
    const poolAddress = pool.pool_address;
    console.log(`─`.repeat(60));
    console.log(`Pool: ${shortAddr(poolAddress)}`);
    console.log(`Pair: ${pool.token1_symbol} / ${pool.token2_symbol}`);

    // Get pool details
    const details = await fetchJSON(`${XDEX_API}/xendex/pool/${poolAddress}`);
    const poolData = details.data || {};
    const lpMint = poolData.pool_info?.lpMint;
    
    if (!lpMint) {
      console.log("  ❌ No LP mint found\n");
      continue;
    }

    console.log(`LP Mint: ${shortAddr(lpMint)}`);

    // Get pool creation info
    const poolPubkey = new PublicKey(poolAddress);
    const sigs = await connection.getSignaturesForAddress(poolPubkey, { limit: 100 });
    
    if (sigs.length > 0) {
      const creationTx = sigs[sigs.length - 1]; // Oldest tx
      console.log(`Pool Created: ${new Date(creationTx.blockTime * 1000).toISOString().slice(0, 10)}`);
      console.log(`Creator: ${shortAddr(poolData.creator || "N/A")}`);
    }

    // Check LP mint transaction history
    console.log(`\n📜 Analyzing LP mint history...`);
    const lpMintPubkey = new PublicKey(lpMint);
    const lpSigs = await connection.getSignaturesForAddress(lpMintPubkey, { limit: 200 });

    let mintEvents = [];
    let burnEvents = [];
    let totalMinted = 0;
    let totalBurned = 0;

    for (const sigInfo of lpSigs) {
      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta) continue;

        // Check for mints (initialize mint or mintTo)
        for (const ix of tx.transaction?.message?.instructions || []) {
          if (!ix.parsed) continue;

          // Track mintTo instructions
          if (ix.parsed.type === "mintTo" || ix.parsed.type === "mintToChecked") {
            const amount = parseFloat(ix.parsed.info?.amount || 0);
            const dest = ix.parsed.info?.account;
            if (amount > 0) {
              mintEvents.push({
                date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : "Unknown",
                amount: amount,
                destination: dest,
                tx: sigInfo.signature,
              });
              totalMinted += amount;
            }
          }

          // Track burns (burn or transfers to burn addresses)
          if (ix.parsed.type === "burn" || ix.parsed.type === "burnChecked") {
            const amount = parseFloat(ix.parsed.info?.amount || 0);
            if (amount > 0) {
              burnEvents.push({
                date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : "Unknown",
                amount: amount,
                type: "Direct Burn",
                tx: sigInfo.signature,
              });
              totalBurned += amount;
            }
          }

          // Track transfers to burn addresses
          if (ix.parsed.type === "transfer" || ix.parsed.type === "transferChecked") {
            const dest = ix.parsed.info?.destination || ix.parsed.info?.owner || "";
            if (BURN_ADDRESSES.includes(dest)) {
              const amount = parseFloat(ix.parsed.info?.amount || 0);
              burnEvents.push({
                date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : "Unknown",
                amount: amount,
                type: "Transfer to Incinerator",
                tx: sigInfo.signature,
              });
              totalBurned += amount;
            }
          }
        }
      } catch {
        // Skip failed lookups
      }
    }

    // Sort by date
    mintEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
    burnEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    console.log(`\n  📊 LP Token Events:`);
    console.log(`     Total Mint Events: ${mintEvents.length}`);
    console.log(`     Total Burn Events: ${burnEvents.length}`);
    console.log(`     Total LP Minted: ${formatNumber(totalMinted)}`);
    console.log(`     Total LP Burned: ${formatNumber(totalBurned)}`);

    if (totalMinted > 0) {
      const burnPct = (totalBurned / totalMinted) * 100;
      console.log(`     Burn Percentage: ${burnPct.toFixed(2)}%`);
    }

    // Check if INITIAL LP was burned
    if (burnEvents.length > 0 && mintEvents.length > 0) {
      const firstMint = mintEvents[0];
      const firstBurn = burnEvents[0];
      
      console.log(`\n  🔥 Initial LP Analysis:`);
      console.log(`     First Mint: ${firstMint.date.slice(0, 10)} - ${formatNumber(firstMint.amount)}`);
      
      if (new Date(firstBurn.date) <= new Date(firstMint.date) + 86400000) { // Within 1 day
        console.log(`     First Burn: ${firstBurn.date.slice(0, 10)} - ${formatNumber(firstBurn.amount)}`);
        console.log(`     ✅ INITIAL LP WAS BURNED!`);
        
        if (firstBurn.destination) {
          console.log(`     Destination: ${shortAddr(firstBurn.destination)}`);
        }
      } else {
        console.log(`     First Burn: ${firstBurn.date.slice(0, 10)} - ${formatNumber(firstBurn.amount)}`);
        console.log(`     ⚠️  Initial LP was NOT burned immediately`);
      }
    }

    // Show recent burns
    if (burnEvents.length > 0) {
      console.log(`\n  📋 Recent LP Burns:`);
      burnEvents.slice(-5).forEach((b, i) => {
        console.log(`     ${i+1}. ${b.date.slice(0, 10)} - ${formatNumber(b.amount)} ${b.type}`);
      });
    }

    console.log();
  }
}

main().catch(console.error);
