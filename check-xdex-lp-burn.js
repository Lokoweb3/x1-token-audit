#!/usr/bin/env node
/**
 * check-xdex-lp-burn.js
 * ===========================================
 * XDEX LP Burn Checker v2.5 — Restructured Output
 * ===========================================
 *
 * Usage:
 *   node check-xdex-lp-burn.js <TOKEN_MINT_ADDRESS>
 *
 * Requirements:
 *   npm install @solana/web3.js@1
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const https = require("https");

const DEFAULT_RPC = process.env.X1_RPC_URL || "https://rpc.mainnet.x1.xyz";
const XDEX_API = "https://api.xdex.xyz/api";

const BURN_ADDRESSES = [
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
  "1111111111111111111111111111111111111111111",
];

// ─── Visual Helpers ──────────────────────────────────────────

function shortAddr(addr, len = 6) {
  if (!addr) return "N/A";
  return addr.length > len * 2 ? `${addr.slice(0, len)}...${addr.slice(-len)}` : addr;
}

function formatNumber(n) {
  if (typeof n === "string") n = parseFloat(n);
  if (isNaN(n)) return "N/A";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e12).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

function progressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${percent.toFixed(1)}%`;
}

function riskGauge(score) {
  const segments = 10;
  const filled = Math.round((score / 100) * segments);
  let gauge = "";
  for (let i = 0; i < segments; i++) {
    if (i < filled) {
      if (score >= 50) gauge += "🔴";
      else if (score >= 25) gauge += "🟡";
      else gauge += "🟢";
    } else {
      gauge += "⚪";
    }
  }
  return gauge;
}

function timestamp() {
  return new Date().toISOString().replace("T", " ").split(".")[0] + " UTC";
}

// ─── API / Chain Helpers ─────────────────────────────────────

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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

async function getTokenMetadata(tokenAddress, pools, connection) {
  let pricePerToken = 0;
  let liquidity = 0;
  let volume24h = 0;
  let tokenDecimals = 9;
  
  // Try XDEX pools for price calculation
  if (pools && pools.length > 0) {
    // Calculate total liquidity and find best price
    for (const pool of pools) {
      try {
        // Determine which token is the one we're checking and get its price
        let tokenPrice = null;
        let poolLiquidity = 0;
        let poolVolume = 0;
        
        if (pool.token1_address === tokenAddress && pool.token1_price) {
          tokenPrice = pool.token1_price;
          poolLiquidity = parseFloat(pool.tvl || 0);
          poolVolume = pool.token1_volume_usd_24h || 0;
          tokenDecimals = pool.token1_decimals || 9;
        } else if (pool.token2_address === tokenAddress && pool.token2_price) {
          tokenPrice = pool.token2_price;
          poolLiquidity = parseFloat(pool.tvl || 0);
          poolVolume = pool.token2_volume_usd_24h || 0;
          tokenDecimals = pool.token2_decimals || 9;
        }
        
        if (tokenPrice && tokenPrice > 0) {
          // XDEX API token_price is in terms of the paired token
          // We use the raw price directly (already account for decimals in API)
          const finalPrice = tokenPrice;
          
          // Use the first valid price we find
          if (!pricePerToken && finalPrice > 0) {
            pricePerToken = finalPrice;
          }
          
          liquidity += poolLiquidity;
          volume24h += poolVolume;
        }
      } catch {
        // Try next pool
      }
    }
  }
  
  // Get actual supply from chain
  let totalSupply = 0;
  try {
    if (connection) {
      const mintPubkey = new PublicKey(tokenAddress);
      const supply = await connection.getTokenSupply(mintPubkey);
      totalSupply = supply.value.uiAmount || 0;
      tokenDecimals = supply.value.decimals || tokenDecimals;
    }
  } catch (err) {
    console.error(`  ⚠️  Could not fetch supply: ${err.message}`);
  }
  
  // Calculate market cap with actual supply
  const marketCap = pricePerToken * totalSupply;
  
  return {
    price: pricePerToken > 0 ? formatPrice(pricePerToken) : "$N/A",
    marketCap: marketCap > 0 ? formatDollarValue(marketCap) : "$N/A",
    liquidity: liquidity > 0 ? formatDollarValue(liquidity) : "$0.00",
    volume24h: volume24h > 0 ? formatDollarValue(volume24h) : "$0.00",
    supply: totalSupply,
    decimals: tokenDecimals,
  };
}

function formatDollarValue(n) {
  if (!n || n <= 0) return "$0.00";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n) {
  if (!n || n <= 0) return "$0.00";
  // For very small prices, show as $0.0{10}716 style
  if (n < 0.000001) {
    const str = n.toFixed(15).replace(/0+$/, ''); // Remove trailing zeros
    const match = str.match(/0\.0+/);
    if (match) {
      const zeroCount = match[0].length - 2; // -2 for "0."
      const significant = str.slice(match[0].length);
      return `$0.0{${zeroCount}}${significant}`;
    }
    return `$${n.toExponential(2)}`;
  }
  if (n < 0.01) {
    return `$${n.toFixed(9)}`;
  }
  if (n < 1) {
    return `$${n.toFixed(5)}`;
  }
  return `$${n.toFixed(4)}`;
}

async function checkTokenAuthorities(connection, mintPubkey) {
  const result = {
    mintAuthority: null,
    mintAuthorityRevoked: false,
    freezeAuthority: null,
    freezeAuthorityRevoked: false,
    supply: 0,
    decimals: 0,
  };

  try {
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    if (!accountInfo) return result;

    const data = accountInfo.data;
    if (data.length >= 82) {
      const mintAuthOption = data.readUInt32LE(0);
      if (mintAuthOption === 1) {
        result.mintAuthority = new PublicKey(data.slice(4, 36)).toBase58();
      } else {
        result.mintAuthorityRevoked = true;
      }

      const supplyLow = BigInt(data.readUInt32LE(36));
      const supplyHigh = BigInt(data.readUInt32LE(40));
      result.supply = Number((supplyHigh << BigInt(32)) | supplyLow);
      result.decimals = data.readUInt8(44);

      const freezeAuthOption = data.readUInt32LE(46);
      if (freezeAuthOption === 1) {
        result.freezeAuthority = new PublicKey(data.slice(50, 82)).toBase58();
      } else {
        result.freezeAuthorityRevoked = true;
      }
    }
  } catch (err) {
    console.error(`Error reading mint: ${err.message}`);
  }

  return result;
}

async function getTokenHolders(connection, mintAddress) {
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    const holders = [];
    let totalSupply = 0;
    
    for (const account of largestAccounts.value || []) {
      try {
        const accountInfo = await connection.getParsedAccountInfo(account.address);
        if (!accountInfo.value) continue;
        
        const info = accountInfo.value.data.parsed?.info;
        if (!info) continue;
        
        const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
        const isBurn = BURN_ADDRESSES.includes(info.owner);
        
        if (!isBurn && amount > 0) {
          holders.push({
            address: info.owner,
            amount: amount,
            pct: 0,
          });
        }
        
        totalSupply += amount;
      } catch {
        // Skip
      }
    }
    
    if (totalSupply > 0) {
      holders.forEach(h => {
        h.pct = (h.amount / totalSupply) * 100;
      });
    }
    
    holders.sort((a, b) => b.amount - a.amount);
    
    return {
      totalHolders: holders.length,
      topHolders: holders.slice(0, 10),
      totalSupply: totalSupply,
    };
  } catch (err) {
    return { totalHolders: 0, topHolders: [], totalSupply: 0 };
  }
}

async function checkLPBurnStatus(connection, lpMintAddress) {
  const result = {
    totalSupply: 0,
    burnedAmount: 0,
    burnPercentage: 0,
    mintAuthorityRevoked: false,
    topHolders: [],
  };

  if (!lpMintAddress) return result;

  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);

    const mintInfo = await connection.getAccountInfo(lpMintPubkey);
    if (!mintInfo) return result;

    const data = mintInfo.data;
    if (data.length >= 82) {
      const supplyLow = BigInt(data.readUInt32LE(36));
      const supplyHigh = BigInt(data.readUInt32LE(40));
      result.totalSupply = Number((supplyHigh << BigInt(32)) | supplyLow);

      const mintAuthOption = data.readUInt32LE(0);
      result.mintAuthorityRevoked = mintAuthOption !== 1;
    }

    const largestAccounts = await connection.getTokenLargestAccounts(lpMintPubkey);

    for (const account of largestAccounts.value || []) {
      try {
        const accountInfo = await connection.getParsedAccountInfo(account.address);
        if (!accountInfo.value) continue;

        const info = accountInfo.value.data.parsed?.info;
        if (!info) continue;

        const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
        const isBurn = BURN_ADDRESSES.includes(info.owner);

        result.topHolders.push({
          address: info.owner,
          amount: amount,
          isBurnAddress: isBurn,
        });

        if (isBurn) {
          result.burnedAmount += amount;
        }
      } catch {
        // Skip
      }
    }

    if (result.totalSupply > 0) {
      result.burnPercentage = (result.burnedAmount / (result.totalSupply / Math.pow(10, 0))) * 100;
    }

    result.topHolders.sort((a, b) => b.amount - a.amount);
  } catch (err) {
    console.error(`Error checking LP burn: ${err.message}`);
  }

  return result;
}

async function checkBurnCheckedTxs(connection, lpMintAddress, limit = 100) {
  const burns = [];
  if (!lpMintAddress) return burns;

  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);
    const signatures = await connection.getSignaturesForAddress(lpMintPubkey, { limit });

    for (const sigInfo of signatures) {
      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.transaction?.message?.instructions) continue;

        for (const ix of tx.transaction.message.instructions) {
          if (!ix.parsed) continue;

          if (ix.parsed.type === "burnChecked" || ix.parsed.type === "burn") {
            const info = ix.parsed.info;
            const decimals = info.tokenAmount?.decimals || 9;
            const amount =
              info.tokenAmount?.uiAmount ||
              parseFloat(info.amount || 0) / Math.pow(10, decimals);

            burns.push({
              signature: sigInfo.signature,
              date: sigInfo.blockTime
                ? new Date(sigInfo.blockTime * 1000).toISOString()
                : "Unknown",
              type: ix.parsed.type,
              amount: amount,
              authority: info.authority || "Unknown",
              mint: info.mint || lpMintAddress,
            });
          }
        }
      } catch {
        // Skip
      }
    }
  } catch (err) {
    console.error(`Error checking burn txs: ${err.message}`);
  }

  return burns;
}

// ─── Risk Scoring ────────────────────────────────────────────

function calculateRiskScore(tokenInfo, burnStatus, holderData, poolsCount) {
  let score = 0;
  
  // Mint authority (30 points if active) - CRITICAL
  if (!tokenInfo.mintAuthorityRevoked) {
    score += 30;
  }
  
  // Freeze authority (20 points if active) - HIGH
  if (!tokenInfo.freezeAuthorityRevoked) {
    score += 20;
  }
  
  // LP Burn status (0-25 points based on burn %)
  // HIGH burn % = GOOD (low risk) - rug proof
  // LOW burn % = BAD (high risk) - can remove liquidity
  const lpBurnedPct = burnStatus.burnPercentage || 0;
  if (lpBurnedPct >= 90) {
    // LP permanently locked - excellent (0 risk points)
    score += 0;
  } else if (lpBurnedPct >= 50) {
    // Most LP burned - good (5 risk points)
    score += 5;
  } else if (lpBurnedPct >= 25) {
    // Some LP burned - medium (10 risk points)
    score += 10;
  } else if (lpBurnedPct >= 10) {
    // Little burned - concerning (15 risk points)
    score += 15;
  } else {
    // Not burned - high risk (25 risk points)
    score += 25;
  }
  
  // Holder concentration (10-20 points)
  if (holderData.topHolders.length > 0) {
    const topHoldersPct = holderData.topHolders.slice(0, 5).reduce((sum, h) => sum + h.pct, 0);
    if (topHoldersPct > 50) score += 20;
    else if (topHoldersPct > 30) score += 10;
  }
  
  return Math.min(score, 100);
}

function getRiskRating(score) {
  if (score === 0) return { rating: "LOW 🟢", color: "🟢" };
  if (score <= 25) return { rating: "LOW 🟢", color: "🟢" };
  if (score <= 50) return { rating: "MEDIUM 🟡", color: "🟡" };
  if (score <= 75) return { rating: "HIGH 🟠", color: "🟠" };
  return { rating: "CRITICAL 🔴", color: "🔴" };
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const tokenAddress = process.argv[2];

  if (!tokenAddress) {
    console.error("Usage: node check-xdex-lp-burn.js <TOKEN_MINT_ADDRESS>");
    process.exit(1);
  }

  // Banner
  console.log();
  console.log("  ╔════════════════════════════════════════════════════════╗");
  console.log("  ║                                                        ║");
  console.log("  ║   🦞  X1 TOKEN AUDIT ENGINE  v2.5                      ║");
  console.log("  ║   ━━━━━━━━━━━━━━━━━━━━━━━━━                            ║");
  console.log("  ║   XDEX Pool Analysis • BurnChecked Detection            ║");
  console.log("  ║   Powered by Loko_AI                                    ║");
  console.log("  ║                                                        ║");
  console.log("  ╚════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  🕐 ${timestamp()}`);
  console.log(`  📋 Contract: \`${tokenAddress}\``);
  console.log(`  🌐 ${DEFAULT_RPC}`);

  // Fetch pools first for price calculation
  let pools = [];
  try {
    const response = await fetchJSON(`${XDEX_API}/xendex/pool/list`);
    const allPools = response.data || [];
    pools = allPools.filter(p =>
      p.token1_address === tokenAddress || p.token2_address === tokenAddress
    );
  } catch (err) {
    console.error(`  ❌ Error fetching pools: ${err.message}`);
    process.exit(1);
  }

  const connection = new Connection(DEFAULT_RPC, "confirmed");
  const mintPubkey = new PublicKey(tokenAddress);

  // ─── TOKEN METADATA ────────────────────────────────────────
  console.log();
  console.log("  ──────────────────────────────────────────────────────");
  // Get token symbol from pools
  let tokenName = "Unknown";
  for (const p of pools) {
    if (p.token1_address === tokenAddress && p.token1_symbol) { tokenName = p.token1_symbol; break; }
    if (p.token2_address === tokenAddress && p.token2_symbol) { tokenName = p.token2_symbol; break; }
  }
  console.log(`  💰 TOKEN: ${tokenName}`);
  console.log("  ──────────────────────────────────────────────────────");
  const tokenData = await getTokenMetadata(tokenAddress, pools, connection);
  console.log(`  Price:        ${tokenData.price}`);
  console.log(`  Market Cap:   ${tokenData.marketCap}`);
  console.log(`  Liquidity:    ${tokenData.liquidity}`);
  console.log(`  Vol 24h:      ${tokenData.volume24h}`);

  // ─── TOKEN AUTHORITY CHECK ─────────────────────────────────
  console.log();
  console.log("  ──────────────────────────────────────────────────────");
  console.log("  🔐 TOKEN AUTHORITY CHECK");
  console.log("  ──────────────────────────────────────────────────────");

  const tokenInfo = await checkTokenAuthorities(connection, mintPubkey);

  // ─── TOKEN HOLDERS ─────────────────────────────────────────
  console.log();
  console.log("  ──────────────────────────────────────────────────────");
  console.log("  👥 TOKEN HOLDERS");
  console.log("  ──────────────────────────────────────────────────────");
  const holdersData = await getTokenHolders(connection, tokenAddress);
  console.log(`  Total Holders: ${holdersData.totalHolders}`);
  if (holdersData.topHolders.length > 0) {
    console.log("  Top Holders:");
    holdersData.topHolders.forEach((h, i) => {
      console.log(`    ${i + 1}. ${shortAddr(h.address)} - ${formatNumber(h.amount)} (${h.pct.toFixed(2)}%)`);
    });
  }

  // ─── SUMMARY TABLE ─────────────────────────────────────────
  console.log();
  console.log("  ──────────────────────────────────────────────────────");
  console.log("  📊 AUDIT SUMMARY");
  console.log("  ──────────────────────────────────────────────────────");

  // Get burn status
  const lpBurnStatus = await checkLPBurnStatus(connection, tokenAddress);
  // Risk score calculated after LP safety below

  // Count burn transactions - search each LP mint directly
  const burnCheckedTxs = [];
  const lpMints = pools.map(p => p.pool_info?.lpMint).filter(Boolean);
  const uniqueLpMints = [...new Set(lpMints)];

  for (const lpMint of uniqueLpMints) {
    try {
      const lpMintPubkey = new PublicKey(lpMint);
      const lpSignatures = await connection.getSignaturesForAddress(lpMintPubkey, { limit: 100 });

      for (const sigInfo of lpSignatures) {
        try {
          const tx = await connection.getParsedTransaction(sigInfo.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          if (!tx || !tx.transaction?.message?.instructions) continue;

          // Method 1: burnChecked / burn instructions
          for (const ix of tx.transaction.message.instructions) {
            if (!ix.parsed) continue;
            if (ix.parsed.type === "burnChecked" || ix.parsed.type === "burn") {
              const info = ix.parsed.info;
              const decimals = info.tokenAmount?.decimals || 9;
              const amount =
                info.tokenAmount?.uiAmount ||
                parseFloat(info.amount || 0) / Math.pow(10, decimals);
              burnCheckedTxs.push({
                signature: sigInfo.signature,
                date: sigInfo.blockTime
                  ? new Date(sigInfo.blockTime * 1000).toISOString()
                  : "Unknown",
                type: ix.parsed.type,
                amount: amount,
                authority: info.authority || "Unknown",
                mint: info.mint || lpMint,
              });
            }
          }

          // Method 2: closeAccount burn (balance zeroed + account closed)
          if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
            for (const pre of tx.meta.preTokenBalances) {
              if (pre.mint !== lpMint) continue;
              const preAmount = parseFloat(pre.uiTokenAmount?.uiAmountString || "0");
              if (preAmount <= 0) continue;
              const post = tx.meta.postTokenBalances.find(
                p => p.accountIndex === pre.accountIndex && p.mint === lpMint
              );
              const postAmount = post ? parseFloat(post.uiTokenAmount?.uiAmountString || "0") : 0;
              if (postAmount === 0 && preAmount > 0) {
                const hasClose = tx.transaction.message.instructions.some(
                  ix => ix.parsed && (ix.parsed.type === "closeAccount" || ix.parsed.type === "closeChecked")
                );
                if (hasClose && !burnCheckedTxs.find(b => b.signature === sigInfo.signature)) {
                  burnCheckedTxs.push({
                    signature: sigInfo.signature,
                    date: sigInfo.blockTime
                      ? new Date(sigInfo.blockTime * 1000).toISOString()
                      : "Unknown",
                    type: "closeAccount (burn)",
                    amount: preAmount,
                    authority: "closeAccount",
                    mint: lpMint,
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
      console.error("  ⚠️ Error scanning LP mint " + lpMint.slice(0,8) + "...: " + err.message);
    }
  }
// Calculate total burn from BurnChecked
  const totalBurnChecked = burnCheckedTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const burnCheckedDate = burnCheckedTxs.length > 0 ? burnCheckedTxs[0].date.split('T')[0] : "N/A";

  // Burned via burn addresses
  const burnedBurnAddr = lpBurnStatus.burnedAmount;

  // LP Burned percentage calculation
  // Total burned = BurnChecked + Burn Address amounts
  // Calculate using original supply vs current circulating supply
  let totalOriginalLP = 0;
  let totalCurrentLP = 0;
  let poolsWithData = 0;
  for (const pool of pools) {
    try {
      const hexSupply = pool.pool_info?.lpSupply || "0";
      const original = parseInt(hexSupply, 16) / 1e9;
      if (original > 0) poolsWithData++;
      totalOriginalLP += original;
      if (pool.pool_info?.lpMint) {
        const lpSupply = await connection.getTokenSupply(new PublicKey(pool.pool_info.lpMint));
        totalCurrentLP += parseFloat(lpSupply.value.uiAmountString || "0");
      }
    } catch { /* skip */ }
  }
  
  // Fallback: For tokens like PEPE where API returns bad hex data
  // If we have BurnChecked but calculated burn % is < 1%, assume API is wrong
  const hasBurnData = totalBurnChecked > 0 || burnedBurnAddr > 0;
  let originalLPIsSuspicious = false;
  
  if (hasBurnData && totalCurrentLP > 0) {
    const estimatedOriginal = totalCurrentLP + totalBurnChecked + burnedBurnAddr;
    const rawBurnPct = totalOriginalLP > 0 ? ((totalBurnChecked + burnedBurnAddr) / totalOriginalLP) * 100 : 999;
    
    // Use estimate ONLY if API shows 0 supply (not for low burn %)
    // Removed the (rawBurnPct < 1 && totalBurnChecked > 100000) condition
    // This was causing false positives and incorrect 99.9% readings
    if (totalOriginalLP === 0) {
      originalLPIsSuspicious = true;
      totalOriginalLP = estimatedOriginal;
      console.log(`  ⚠️  API data incomplete, estimated total LP from ${pools.length} pools`);
    }
  }
  
  // Calculate total burned from all methods
  // Use on-chain supply diff, but only if verified burns exist
  const hasBurns = totalBurnChecked > 0 || burnedBurnAddr > 0;
  
  // Calculate percentage burned (locked) relative to original supply
  let lpBurnedPct = 0;
  
  if (totalOriginalLP > 0) {
    // Normal case: we have pool supply data
    const onChainBurned = Math.max(0, totalOriginalLP - totalCurrentLP); lpBurnedPct = hasBurns && totalOriginalLP > 0 ? (onChainBurned / totalOriginalLP) * 100 : 0;
    // Cap at 99.9% to indicate "nearly all" without overstating
    if (lpBurnedPct > 99.9) lpBurnedPct = 99.9;
  } else if (burnedBurnAddr > 0 && totalCurrentLP > 0) {
    // Fallback: estimate based on burned amount vs current supply
    // Only use this if we have NO pool supply data at all
    const estimatedOriginal = totalCurrentLP + burnedBurnAddr + totalBurnChecked;
    lpBurnedPct = estimatedOriginal > 0 ? ((burnedBurnAddr + totalBurnChecked) / estimatedOriginal) * 100 : 0;
    if (lpBurnedPct > 99.9) lpBurnedPct = 99.9;
    console.log(`  ⚠️  Using fallback estimation: ${lpBurnedPct.toFixed(1)}% burned`);
  } else if (burnedBurnAddr > 0) {
    // Can't calculate % but we know significant burn happened
    // Show as ~99% indicating "effectively burned"
    lpBurnedPct = 99.9;
    console.log(`  ⚠️  Using fallback estimation: ~99.9% burned`);
  }
  
  // Cap at 100% for display, but retain actual for logic
  const lpSafetyDisplay = Math.min(100, lpBurnedPct);
  
  // For risk calculation: high burn % = good (lowers risk)
  const lpSafety = lpBurnedPct;

  const riskScore = calculateRiskScore(tokenInfo, { ...lpBurnStatus, burnPercentage: lpSafety }, holdersData, pools.length);
  const riskRating = getRiskRating(riskScore);

  console.log("  | Metric                              | Value");
  console.log("  | ----------------------------------- | ------------");
  const mintAuthDisplay = tokenInfo.mintAuthorityRevoked ? "✅ REVOKED" : `🚫 ACTIVE (${shortAddr(tokenInfo.mintAuthority)})`;
  const freezeAuthDisplay = tokenInfo.freezeAuthorityRevoked ? "✅ REVOKED" : `🚫 ACTIVE (${shortAddr(tokenInfo.freezeAuthority)})`;
  console.log(`  | Mint Authority                      | ${mintAuthDisplay}`);
  console.log(`  | Freeze Authority                    | ${freezeAuthDisplay}`);
  console.log(`  | Total Supply                        | ${formatNumber(holdersData.totalSupply)} (${tokenInfo.decimals} decimals)`);
  console.log(`  | Pools Found                         | ${pools.length}`);
  console.log(`  | LP Burned (BurnChecked)            | ${formatNumber(totalBurnChecked)} (${burnCheckedTxs.length} txs)`);
  console.log(`  | LP Burned (Burn Addr)              | ${formatNumber(burnedBurnAddr)}`);
  
  // Show LP Burned % with appropriate indicator
  const isFullyBurned = lpSafety >= 90;
  const lpBurnEmoji = isFullyBurned ? "🔒" : lpSafety >= 50 ? "✅" : lpSafety >= 25 ? "🟡" : "⚠️";
  const lpBurnText = "LP Safety";
  const displayPct = lpSafetyDisplay >= 99.9 ? "99.9%+" : `${lpSafetyDisplay.toFixed(1)}%`;
  const pctNote = originalLPIsSuspicious && hasBurnData ? " (est.)" : "";
  console.log(`  | ${lpBurnText.padEnd(36)}| ${lpBurnEmoji} ${displayPct}${pctNote}`);
  
  if (isFullyBurned) {
    console.log(`  | Status                              | ✅ LIQUIDITY PERMANENTLY LOCKED`);
  }
  
  console.log(`  | Risk Score                          | ${riskScore}/100 ${riskRating.color} ${riskRating.rating}`);

  // ─── BURN CHECKED TRANSACTIONS ─────────────────────────────
  if (burnCheckedTxs.length > 0) {
    console.log();
    console.log("  ──────────────────────────────────────────────────────");
    console.log("  🔥 BURNCHECKED TRANSACTIONS");
    console.log("  ──────────────────────────────────────────────────────");
    
    burnCheckedTxs.slice(0, 5).forEach((burn, i) => {
      const date = burn.date.split('T')[0];
      const txUrl = `https://explorer.mainnet.x1.xyz/tx/${burn.signature}`;
      console.log(`  ${i + 1}. ${formatNumber(burn.amount)} LP on ${date} [🔗 View TX](${txUrl})`);
    });
  }

  // ─── POOLS ─────────────────────────────────────────────────
  console.log();
  console.log("  ──────────────────────────────────────────────────────");
  console.log("  🏊 XDEX POOL DISCOVERY");
  console.log("  ──────────────────────────────────────────────────────");

  if (pools.length === 0) {
    console.log("  ❌ No pools found on XDEX\n");
  } else {
    console.log(`  ✅ Discovered ${pools.length} pool(s)\n`);
    
    pools.forEach((pool, i) => {
      const name = `${pool.token1_symbol}/${pool.token2_symbol} Pool`;
      // Parse hex lpSupply to decimal
      let supply = 0;
      try {
        if (pool.pool_info?.lpSupply) {
          supply = parseInt(pool.pool_info.lpSupply, 16) / 1e9;
        } else if (pool.total_supply) {
          supply = pool.total_supply / 1e9;
        }
      } catch (e) { supply = 0; }
      
      const poolLpMint = pool.pool_info?.lpMint;
      const burnsInPool = poolLpMint ? burnCheckedTxs.filter(tx => tx.mint === poolLpMint).length : 0;
      
      if (burnsInPool > 0) {
        console.log(`  • ${name}: ${formatNumber(supply)} LP supply, ${burnsInPool} BurnChecked txs ✅`);
      } else {
        console.log(`  • ${name}: ${formatNumber(supply)} LP supply`);
      }
    });
  }

  // ─── SUMMARY ───────────────────────────────────────────────
  console.log();
  console.log("  ──────────────────────────────────────────────────────");
  console.log("  ✅ SUMMARY");
  console.log("  ──────────────────────────────────────────────────────");
  
  if (riskScore === 0) {
    console.log("  Strong security profile - mint/freeze revoked, LP");
    console.log(`  burn percentage: ${lpSafety >= 99.9 ? '99.9%+' : lpSafety.toFixed(1) + '%'}.`);
    console.log("  🟢 LOW RISK.");
  } else if (lpSafety >= 90) {
    // Nearly all LP burned - excellent security
    console.log(`  🔒 EXCELLENT: ~${lpSafety >= 99.9 ? '99.9%+' : lpSafety.toFixed(1) + '%'} of LP permanently locked via burn.`);
    const burnCheckedTotal = formatNumber(totalBurnChecked);
    const burnAddrTotal = formatNumber(burnedBurnAddr);
    console.log(`  ${burnCheckedTotal} LP via BurnChecked (${burnCheckedTxs.length} txs)`);
    if (burnedBurnAddr > 0) {
      console.log(`  ${burnAddrTotal} LP sent to burn addresses.`);
    }
    console.log(`  ${riskRating.color} ${riskRating.rating}`);
  } else if (lpSafety >= 50) {
    // Mostly burned - good
    console.log("  ✅ GOOD: Most LP has been burned/locked.");
    console.log(`  LP burned: ${lpSafety.toFixed(1)}% (${formatNumber(actualBurned)} total)`);
    console.log(`  ${riskRating.color} ${riskRating.rating}`);
  } else {
    console.log(`  Risk factors detected: ${riskRating.rating}`);
    console.log("  Review authorities and LP burn status below.");
  }

  console.log();
  console.log("  📋 Risk Levels:");
  console.log("  🟢 0-24:  LOW — authorities revoked, LP burned, looks safe");
  console.log("  🟡 25-49: MEDIUM — some concerns, investigate further");
  console.log("  🟠 50-75: HIGH — significant red flags");
  console.log("  🔴 76-100: CRITICAL — likely scam/rug");

  // Footer
  console.log();
  console.log(`  [🔗 View on Explorer](https://explorer.mainnet.x1.xyz/address/${tokenAddress})`);

  console.log();
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🦞 Powered by Loko_AI × X1 Token Audit Engine v2.5");
  console.log(`  🕐 ${timestamp()}`);
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
