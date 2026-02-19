#!/usr/bin/env node
/**
 * x1-lp-audit.js
 * ===========================================
 * X1/SVM LP Token Burn Detector
 * ===========================================
 *
 * Automatically finds all LP pairs for a token and checks
 * if LP tokens have been burned (sent to incinerator).
 *
 * Usage:
 *   node x1-lp-audit.js <TOKEN_MINT_ADDRESS>
 *   node x1-lp-audit.js <TOKEN_MINT_ADDRESS> --rpc https://custom-rpc.example.com
 *
 * Requirements:
 *   npm install @solana/web3.js@1
 */

const { Connection, PublicKey } = require("@solana/web3.js");

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const DEFAULT_RPC = process.env.X1_RPC_URL || "https://rpc.mainnet.x1.xyz";

// Known burn / dead addresses
const BURN_ADDRESSES = [
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
  "1111111111111111111111111111111111111111111",
];

// Known DEX program IDs and their LP token patterns
const DEX_PROGRAMS = {
  // Raydium AMM v4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": {
    name: "Raydium AMM v4",
    lpTokenType: "standard",
  },
  // Raydium CPMM (Concentrated)
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": {
    name: "Raydium CPMM",
    lpTokenType: "standard",
  },
  // Meteora DLMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo": {
    name: "Meteora DLMM",
    lpTokenType: "standard",
  },
  // Meteora Pools
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB": {
    name: "Meteora Pools",
    lpTokenType: "standard",
  },
  // Orca Whirlpool
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": {
    name: "Orca Whirlpool",
    lpTokenType: "position-nft",
  },
  // Orca Token Swap
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": {
    name: "Orca Token Swap",
    lpTokenType: "standard",
  },
};

// Token Programs
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function parseArgs() {
  const args = process.argv.slice(2);
  let mintAddress = null;
  let rpcUrl = DEFAULT_RPC;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rpc" && args[i + 1]) {
      rpcUrl = args[++i];
    } else if (!args[i].startsWith("-") && !mintAddress) {
      mintAddress = args[i];
    }
  }

  if (!mintAddress) {
    console.error("Usage: node x1-lp-audit.js <TOKEN_MINT_ADDRESS> [--rpc <RPC_URL>]");
    console.error("");
    console.error("Examples:");
    console.error("  node x1-lp-audit.js EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  # USDC");
    console.error("  node x1-lp-audit.js So11111111111111111111111111111111111111112     # wSOL");
    process.exit(1);
  }

  return { mintAddress, rpcUrl };
}

function isValidAddress(addr) {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

function shortAddr(addr, len = 6) {
  if (!addr) return "N/A";
  const s = typeof addr === "string" ? addr : addr.toBase58();
  return s.length > len * 2 ? `${s.slice(0, len)}...${s.slice(-len)}` : s;
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

// ═══════════════════════════════════════
// LP PAIR DETECTION
// ═══════════════════════════════════════

/**
 * Find all token accounts owned by DEX programs
 * These represent pool vaults containing the token
 */
async function findLPPools(connection, mintPubkey) {
  const pools = [];
  const mintAddress = mintPubkey.toBase58();

  console.log("🔍 Scanning for LP pools across DEXes...\n");

  for (const [programId, dexInfo] of Object.entries(DEX_PROGRAMS)) {
    try {
      const programPubkey = new PublicKey(programId);
      
      // Get all token accounts for this mint owned by the DEX program
      const tokenAccounts = await connection.getParsedProgramAccounts(
        TOKEN_PROGRAM_ID,
        {
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: mintAddress } },
          ],
        }
      );

      // Also check Token-2022
      const token2022Accounts = await connection.getParsedProgramAccounts(
        TOKEN_2022_PROGRAM_ID,
        {
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: mintAddress } },
          ],
        }
      );

      const allAccounts = [...tokenAccounts, ...token2022Accounts];

      for (const { pubkey, account } of allAccounts) {
        const info = account.data.parsed?.info;
        if (!info) continue;

        const owner = info.owner;
        
        // Check if owner is a known DEX program
        if (DEX_PROGRAMS[owner]) {
          // This is a pool vault!
          const vaultAddress = pubkey.toBase58();
          const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
          
          // Try to find the LP mint for this pool
          const lpMint = await findLPMintForPool(connection, vaultAddress, owner);
          
          pools.push({
            dex: DEX_PROGRAMS[owner].name,
            dexProgram: owner,
            vault: vaultAddress,
            tokenAmount: amount,
            lpMint: lpMint,
          });
        }
      }
    } catch (err) {
      // Continue to next DEX
    }
  }

  return pools;
}

/**
 * Find LP mint for a pool vault by analyzing pool state
 */
async function findLPMintForPool(connection, vaultAddress, dexProgram) {
  try {
    // For Raydium AMM v4, the LP mint is stored in the pool state
    // Pool state is a PDA derived from the two token mints
    
    // Get vault account info
    const vaultInfo = await connection.getParsedAccountInfo(new PublicKey(vaultAddress));
    if (!vaultInfo.value) return null;

    // The pool state account is typically the owner of the vault
    // For Raydium, we need to fetch the pool state to get the LP mint
    const poolOwner = vaultInfo.value.data.parsed?.info?.owner;
    if (!poolOwner) return null;

    // Try to get pool state
    try {
      const poolState = await connection.getAccountInfo(new PublicKey(poolOwner));
      if (poolState && poolState.data.length >= 200) {
        // Raydium AMM pool state layout:
        // LP mint is typically at offset 200-232 in the pool state
        // This is a simplified heuristic
        const potentialLPMint = new PublicKey(poolState.data.slice(200, 232)).toBase58();
        if (isValidAddress(potentialLPMint) && potentialLPMint !== vaultAddress) {
          return potentialLPMint;
        }
      }
    } catch {
      // Pool state fetch failed
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Alternative: Find LP mints by looking for mints that have pool vaults
 * This works by finding all mints and checking which ones have DEX-owned accounts
 */
async function findLPMintsForToken(connection, mintPubkey) {
  const lpMints = new Set();
  const mintAddress = mintPubkey.toBase58();

  // Strategy: Find all accounts that hold both the target token AND another token
  // These are likely pool vaults, and we can derive LP mints from them

  try {
    // Get all token accounts for this mint
    const tokenAccounts = await connection.getParsedProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: mintAddress } },
        ],
      }
    );

    for (const { account } of tokenAccounts) {
      const info = account.data.parsed?.info;
      if (!info) continue;

      const owner = info.owner;
      
      // Check if owned by known DEX
      if (DEX_PROGRAMS[owner]) {
        // This vault is part of a pool
        // The LP mint would be associated with this pool
        // For now, we'll note this as a pool without LP mint detection
        // Full implementation would parse the pool state
      }
    }
  } catch {
    // Continue
  }

  return Array.from(lpMints);
}

// ═══════════════════════════════════════
// LP BURN CHECKS
// ═══════════════════════════════════════

/**
 * Check if LP tokens for a given LP mint have been burned
 */
async function checkLPBurnStatus(connection, lpMintAddress) {
  const result = {
    lpMint: lpMintAddress,
    totalSupply: 0,
    burnedAmount: 0,
    burnPercentage: 0,
    burnTransactions: [],
    holders: [],
  };

  if (!lpMintAddress || !isValidAddress(lpMintAddress)) {
    return result;
  }

  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);

    // Get LP mint info
    const mintInfo = await connection.getParsedAccountInfo(lpMintPubkey);
    if (!mintInfo.value) return result;

    // Parse mint data
    const data = mintInfo.value.data;
    if (data.length >= 82) {
      // Supply at offset 36-44
      const supplyLow = BigInt(data.readUInt32LE(36));
      const supplyHigh = BigInt(data.readUInt32LE(40));
      result.totalSupply = Number((supplyHigh << BigInt(32)) | supplyLow);
    }

    // Check burn address holdings
    for (const burnAddr of BURN_ADDRESSES) {
      try {
        const burnPubkey = new PublicKey(burnAddr);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          burnPubkey,
          { mint: lpMintPubkey }
        );

        for (const { account } of tokenAccounts.value) {
          const info = account.data.parsed.info;
          const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
          if (amount > 0) {
            result.burnedAmount += amount;
            result.burnTransactions.push({
              burnAddress: burnAddr,
              amount: amount,
            });
          }
        }
      } catch {
        // No holdings
      }
    }

    // Calculate burn percentage
    if (result.totalSupply > 0) {
      result.burnPercentage = (result.burnedAmount / result.totalSupply) * 100;
    }

    // Get top holders
    try {
      const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: lpMintAddress } },
        ],
      });

      const holders = [];
      for (const { account } of accounts) {
        const info = account.data.parsed?.info;
        if (!info) continue;
        const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
        if (amount > 0) {
          holders.push({
            address: info.owner,
            amount: amount,
            isBurnAddress: BURN_ADDRESSES.includes(info.owner),
          });
        }
      }

      holders.sort((a, b) => b.amount - a.amount);
      result.holders = holders.slice(0, 10);
    } catch {
      // Skip holders
    }
  } catch (err) {
    console.error(`  ⚠️ Error checking LP burn: ${err.message}`);
  }

  return result;
}

/**
 * Check transaction history for LP transfers to burn addresses
 */
async function checkLPBurnTransactions(connection, lpMintAddress) {
  const burns = [];

  if (!lpMintAddress || !isValidAddress(lpMintAddress)) {
    return burns;
  }

  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);
    const signatures = await connection.getSignaturesForAddress(lpMintPubkey, { limit: 100 });

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
              const dest = ix.parsed.info?.destination || "";
              const destOwner = ix.parsed.info?.owner || "";
              
              // Check if destination is a burn address
              if (BURN_ADDRESSES.includes(dest) || BURN_ADDRESSES.includes(destOwner)) {
                burns.push({
                  signature: sigInfo.signature,
                  date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : "Unknown",
                  amount: parseFloat(ix.parsed.info?.amount || 0),
                  destination: destOwner || dest,
                });
              }
            }
          }
        }
      } catch {
        // Skip
      }
    }
  } catch (err) {
    console.error(`  ⚠️ Error checking burn txs: ${err.message}`);
  }

  return burns;
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
async function main() {
  const { mintAddress, rpcUrl } = parseArgs();

  if (!isValidAddress(mintAddress)) {
    console.error("❌ Invalid token mint address");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          X1 LP Token Burn Detector                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Token: ${mintAddress}`);
  console.log(`RPC:   ${rpcUrl}\n`);

  const connection = new Connection(rpcUrl, "confirmed");
  const mintPubkey = new PublicKey(mintAddress);

  // Verify token exists
  const tokenInfo = await connection.getParsedAccountInfo(mintPubkey);
  if (!tokenInfo.value) {
    console.error("❌ Token mint not found on chain");
    process.exit(1);
  }

  console.log("✅ Token verified on chain\n");

  // Find LP pools
  const pools = await findLPPools(connection, mintPubkey);

  if (pools.length === 0) {
    console.log("❌ No LP pools found for this token");
    console.log("   This token may not have DEX liquidity yet.");
    process.exit(0);
  }

  console.log(`✅ Found ${pools.length} LP pool(s)\n`);

  // Analyze each pool
  console.log("═══════════════════════════════════════════════════════════");
  console.log("                    LP POOL ANALYSIS                       ");
  console.log("═══════════════════════════════════════════════════════════\n");

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    
    console.log(`📊 Pool ${i + 1}: ${pool.dex}`);
    console.log(`   Vault: ${shortAddr(pool.vault)}`);
    console.log(`   Token Amount: ${formatNumber(pool.tokenAmount)}`);
    
    if (pool.lpMint) {
      console.log(`   LP Mint: ${shortAddr(pool.lpMint)}`);
      
      // Check LP burn status
      const burnStatus = await checkLPBurnStatus(connection, pool.lpMint);
      const burnTxs = await checkLPBurnTransactions(connection, pool.lpMint);
      
      console.log(`   LP Supply: ${formatNumber(burnStatus.totalSupply)}`);
      console.log(`   LP Burned: ${formatNumber(burnStatus.burnedAmount)} (${burnStatus.burnPercentage.toFixed(2)}%)`);
      
      if (burnStatus.burnedAmount > 0) {
        console.log(`   ✅ LP TOKENS BURNED`);
        
        if (burnTxs.length > 0) {
          console.log(`   🔥 Burn Transactions:`);
          burnTxs.slice(0, 3).forEach((tx) => {
            console.log(`      • ${formatNumber(tx.amount)} → ${shortAddr(tx.destination)}`);
            console.log(`        ${shortAddr(tx.signature)} @ ${tx.date.slice(0, 10)}`);
          });
        }
      } else {
        console.log(`   ⚠️  LP tokens NOT burned`);
      }
      
      // Show top LP holders
      if (burnStatus.holders.length > 0) {
        const burnHolders = burnStatus.holders.filter(h => h.isBurnAddress);
        if (burnHolders.length > 0) {
          console.log(`   📋 Burn Address Holdings:`);
          burnHolders.forEach((h) => {
            console.log(`      • ${shortAddr(h.address)}: ${formatNumber(h.amount)}`);
          });
        }
      }
    } else {
      console.log(`   LP Mint: Not detected (manual check needed)`);
      console.log(`   💡 Tip: Check the DEX UI for LP token address`);
    }
    
    console.log();
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("                      SUMMARY                              ");
  console.log("═══════════════════════════════════════════════════════════\n");

  const burnedPools = pools.filter(p => {
    // This is simplified - would need to track burn status properly
    return false;
  });

  console.log(`Total Pools Found: ${pools.length}`);
  console.log(`DEXes: ${[...new Set(pools.map(p => p.dex))].join(", ")}`);
  
  console.log(`\n🔗 Explorer: https://explorer.mainnet.x1.xyz/address/${mintAddress}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
