#!/usr/bin/env node
/**
 * x1-token-audit.js
 * ===========================================
 * X1/SVM Token Safety Checker with XDEX API
 * ===========================================
 *
 * Uses XDEX API for pool discovery and LP burn detection.
 *
 * Usage:
 *   node x1-token-audit.js <TOKEN_MINT_ADDRESS>
 *   node x1-token-audit.js <TOKEN_MINT_ADDRESS> --rpc https://custom-rpc.example.com
 *
 * Requirements:
 *   npm install @solana/web3.js@1
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const https = require("https");

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const DEFAULT_RPC = process.env.X1_RPC_URL || "https://rpc.mainnet.x1.xyz";
const XDEX_API = "https://api.xdex.xyz/api";

// Known burn / dead addresses
const BURN_ADDRESSES = [
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
  "1111111111111111111111111111111111111111111",
];

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
    console.error("Usage: node x1-token-audit.js <TOKEN_MINT_ADDRESS> [--rpc <RPC_URL>]");
    console.error("");
    console.error("Examples:");
    console.error("  node x1-token-audit.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER");
    console.error("  node x1-token-audit.js So11111111111111111111111111111111111111112");
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
  return n.toFixed(n < 1 ? 6 : 2);
}

// ═══════════════════════════════════════
// XDEX API HELPERS
// ═══════════════════════════════════════

function fetchJSON(url) {
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

async function getXDEXPools() {
  const url = `${XDEX_API}/xendex/pool/list`;
  const response = await fetchJSON(url);
  return response.data || [];
}

async function getXDEXPoolDetails(poolAddress) {
  const url = `${XDEX_API}/xendex/pool/${poolAddress}`;
  const response = await fetchJSON(url);
  return response.data || response;
}

async function getTokenPrice(tokenAddress) {
  const url = `${XDEX_API}/token-price/price?address=${tokenAddress}`;
  const response = await fetchJSON(url);
  return response.data || response;
}

async function getLPPrice(lpMintAddress) {
  const url = `${XDEX_API}/token-price/lp-price?address=${lpMintAddress}`;
  const response = await fetchJSON(url);
  return response.data || response;
}

// ═══════════════════════════════════════
// CHECKS
// ═══════════════════════════════════════

/** Check 1: Mint Account Info */
async function checkMintAccount(connection, mintPubkey) {
  const result = {
    exists: false,
    mintAuthority: null,
    mintAuthorityRevoked: false,
    freezeAuthority: null,
    freezeAuthorityRevoked: false,
    supply: 0,
    decimals: 0,
    supplyUi: "0",
    isToken2022: false,
  };

  try {
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    if (!accountInfo) return result;

    result.exists = true;
    result.isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);

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
      const supplyRaw = (supplyHigh << BigInt(32)) | supplyLow;

      result.decimals = data.readUInt8(44);
      result.supply = Number(supplyRaw) / Math.pow(10, result.decimals);
      result.supplyUi = formatNumber(result.supply);

      const freezeAuthOption = data.readUInt32LE(46);
      if (freezeAuthOption === 1) {
        result.freezeAuthority = new PublicKey(data.slice(50, 82)).toBase58();
      } else {
        result.freezeAuthorityRevoked = true;
      }
    }
  } catch (err) {
    console.error(`  ⚠️ Error reading mint: ${err.message}`);
  }

  return result;
}

/** Check 2: Find XDEX Pools for Token */
async function findXDEXPools(tokenAddress) {
  try {
    const poolList = await getXDEXPools("mainnet");
    
    if (!poolList || !Array.isArray(poolList)) {
      return [];
    }

    // Filter pools containing our token
    const matchingPools = poolList.filter(pool => {
      return pool.token1_address === tokenAddress || 
             pool.token2_address === tokenAddress;
    });

    return matchingPools;
  } catch (err) {
    console.error(`  ⚠️ XDEX API error: ${err.message}`);
    return [];
  }
}

/** Check 3: Get Pool Details and LP Mint */
async function getPoolDetails(poolAddress) {
  try {
    const details = await getXDEXPoolDetails(poolAddress, "mainnet");
    return details;
  } catch (err) {
    console.error(`  ⚠️ Pool details error: ${err.message}`);
    return null;
  }
}

/** Check 4: Check LP Burn Status */
async function checkLPBurnStatus(connection, lpMintAddress) {
  const result = {
    lpMint: lpMintAddress,
    totalSupply: 0,
    burnedAmount: 0,
    burnPercentage: 0,
    mintAuthorityRevoked: false,
    topHolders: [],
  };

  if (!lpMintAddress || !isValidAddress(lpMintAddress)) {
    return result;
  }

  try {
    const lpMintPubkey = new PublicKey(lpMintAddress);

    // Get LP mint info
    const mintInfo = await connection.getParsedAccountInfo(lpMintPubkey);
    if (!mintInfo.value) return result;

    const data = mintInfo.value.data;
    if (data.length >= 82) {
      const supplyLow = BigInt(data.readUInt32LE(36));
      const supplyHigh = BigInt(data.readUInt32LE(40));
      result.totalSupply = Number((supplyHigh << BigInt(32)) | supplyLow);

      const decimals = data.readUInt8(44);
      
      // Check mint authority
      const mintAuthOption = data.readUInt32LE(0);
      result.mintAuthorityRevoked = mintAuthOption !== 1;
    }

    // Check burn address holdings using token largest accounts
    try {
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
    } catch {
      // Skip holder check
    }

    // Calculate burn percentage
    if (result.totalSupply > 0) {
      result.burnPercentage = (result.burnedAmount / (result.totalSupply / Math.pow(10, 0))) * 100;
    }

    result.topHolders.sort((a, b) => b.amount - a.amount);
  } catch (err) {
    console.error(`  ⚠️ LP burn check error: ${err.message}`);
  }

  return result;
}

/** Check 5: Holder Concentration for base token */
async function checkHolderConcentration(connection, mintPubkey) {
  const result = {
    totalHolders: 0,
    topHolderPct: 0,
    top10Pct: 0,
  };

  try {
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    const holders = [];
    let totalAmount = 0;

    for (const account of largestAccounts.value || []) {
      try {
        const accountInfo = await connection.getParsedAccountInfo(account.address);
        if (!accountInfo.value) continue;
        
        const info = accountInfo.value.data.parsed?.info;
        if (!info) continue;
        
        const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
        if (amount > 0) {
          holders.push({ amount });
          totalAmount += amount;
        }
      } catch {
        // Skip
      }
    }

    result.totalHolders = holders.length;

    if (holders.length > 0 && totalAmount > 0) {
      result.topHolderPct = ((holders[0].amount / totalAmount) * 100).toFixed(1);
      result.top10Pct = (
        (holders.slice(0, 10).reduce((sum, h) => sum + h.amount, 0) / totalAmount) * 100
      ).toFixed(1);
    }
  } catch (err) {
    console.error(`  ⚠️ Holder scan error: ${err.message}`);
  }

  return result;
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
async function main() {
  const { mintAddress, rpcUrl } = parseArgs();

  if (!isValidAddress(mintAddress)) {
    console.error("❌ Invalid mint address");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          X1 Token Audit Report                           ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Token: ${mintAddress}`);
  console.log(`RPC:   ${rpcUrl}\n`);

  const connection = new Connection(rpcUrl, "confirmed");
  const mintPubkey = new PublicKey(mintAddress);

  // Check 1: Mint Account
  console.log("📋 Mint Authority Check");
  console.log("─".repeat(50));
  const mintInfo = await checkMintAccount(connection, mintPubkey);

  if (!mintInfo.exists) {
    console.log("❌ Token mint not found on chain\n");
    process.exit(1);
  }

  console.log(`Mint Authority: ${mintInfo.mintAuthorityRevoked ? "✅ Revoked" : "⚠️ Active"}`);
  console.log(`Freeze Auth:    ${mintInfo.freezeAuthorityRevoked ? "✅ Revoked" : "⚠️ Active"}`);
  console.log(`Supply:         ${mintInfo.supplyUi}`);
  console.log(`Decimals:       ${mintInfo.decimals}`);
  console.log(`Type:           ${mintInfo.isToken2022 ? "Token-2022" : "Standard SPL"}\n`);

  // Check 2: XDEX Pools
  console.log("📋 XDEX Pool Discovery");
  console.log("─".repeat(50));
  
  const pools = await findXDEXPools(mintAddress);
  let poolDetails = null;
  let lpBurnStatus = null;
  let lpPriceInfo = null;

  if (pools.length > 0) {
    console.log(`✅ Found ${pools.length} pool(s) on XDEX\n`);
    
    // Use first pool for detailed analysis
    const pool = pools[0];
    console.log(`Pool Address: ${pool.pool_address || "N/A"}`);
    console.log(`DEX:          ${pool.dex_name || "XDEX"}`);
    
    if (pool.token1_address && pool.token2_address) {
      const isToken1 = pool.token1_address === mintAddress;
      const ourSymbol = isToken1 ? pool.token1_symbol : pool.token2_symbol;
      const otherSymbol = isToken1 ? pool.token2_symbol : pool.token1_symbol;
      const ourReserve = isToken1 ? pool.token1_reserve : pool.token2_reserve;
      const otherReserve = isToken1 ? pool.token2_reserve : pool.token1_reserve;
      console.log(`Pair:         ${ourSymbol || "?"} / ${otherSymbol || "?"}`);
      console.log(`Liquidity:    ${formatNumber(ourReserve || 0)} / ${formatNumber(otherReserve || 0)}`);
    }

    // Get detailed pool info
    const poolAddr = pool.pool_address;
    if (poolAddr) {
      poolDetails = await getPoolDetails(poolAddr);
      
      const lpMint = poolDetails?.pool_info?.lpMint || poolDetails?.lpMint;
      if (lpMint) {
        console.log(`\nLP Mint:      ${lpMint}`);
        
        // Check LP burn status
        lpBurnStatus = await checkLPBurnStatus(connection, lpMint);
        
        // Get LP supply from pool info (hex string)
      let lpSupplyFromPool = 0;
      if (poolDetails?.pool_info?.lpSupply) {
        try {
          const hexSupply = poolDetails.pool_info.lpSupply.replace(/"/g, '');
          lpSupplyFromPool = parseInt(hexSupply, 16) / Math.pow(10, poolDetails.pool_info.lpMintDecimals || 9);
        } catch {}
      }
      
      const effectiveSupply = lpSupplyFromPool > 0 ? lpSupplyFromPool : lpBurnStatus.totalSupply;
      
      if (effectiveSupply > 0 || lpBurnStatus.burnedAmount > 0) {
          console.log(`LP Supply:    ${formatNumber(effectiveSupply)}`);
          console.log(`LP Burned:    ${lpBurnStatus.burnedAmount > 0 ? "🔥 Yes" : "❌ No"}`);
          if (lpBurnStatus.burnedAmount > 0 && effectiveSupply > 0) {
            const burnPct = (lpBurnStatus.burnedAmount / (effectiveSupply + lpBurnStatus.burnedAmount)) * 100;
            console.log(`LP Burn %:    ${burnPct.toFixed(2)}%`);
          }
          console.log(`LP Mint Auth: ${lpBurnStatus.mintAuthorityRevoked ? "✅ Revoked" : "⚠️ Active"}`);
          
          if (lpBurnStatus.topHolders.length > 0) {
            const burnHolders = lpBurnStatus.topHolders.filter(h => h.isBurnAddress);
            if (burnHolders.length > 0) {
              console.log(`\nBurn Address Holdings:`);
              burnHolders.forEach(h => {
                console.log(`  • ${shortAddr(h.address)}: ${formatNumber(h.amount)}`);
              });
            }
          }
        }

        // Get LP price info
        try {
          lpPriceInfo = await getLPPrice(lpMint);
        } catch {
          // LP price not available
        }
      }
    }
  } else {
    console.log("❌ No pools found on XDEX\n");
  }

  // Check 3: Token Price
  console.log("\n📋 Token Price");
  console.log("─".repeat(50));
  
  let priceInfo = null;
  try {
    priceInfo = await getTokenPrice(mintAddress, "mainnet");
    if (priceInfo && priceInfo.price) {
      console.log(`Price: ${formatNumber(priceInfo.price)} XNT`);
      if (priceInfo.priceChange24h) {
        const change = parseFloat(priceInfo.priceChange24h);
        const emoji = change >= 0 ? "🟢" : "🔴";
        console.log(`24h Change: ${emoji} ${change.toFixed(2)}%`);
      }
      if (priceInfo.marketCap) {
        console.log(`Market Cap: ${formatNumber(priceInfo.marketCap)} XNT`);
      }
    } else {
      console.log("Price: Not available");
    }
  } catch (err) {
    console.log(`Price: Error fetching (${err.message})`);
  }

  // Check 4: Holder Concentration
  console.log("\n📋 Holder Distribution");
  console.log("─".repeat(50));
  const holders = await checkHolderConcentration(connection, mintPubkey);
  console.log(`Total Holders: ${holders.totalHolders}`);
  console.log(`Top Holder:    ${holders.topHolderPct}%`);
  console.log(`Top 10:        ${holders.top10Pct}%`);

  // ═══════════════════════════════════════
  // RISK SCORE CALCULATION
  // ═══════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("                     RISK ASSESSMENT                       ");
  console.log("═══════════════════════════════════════════════════════════\n");

  let riskScore = 0;
  const riskFactors = [];
  const safeFactors = [];

  // Mint authority
  if (mintInfo.mintAuthorityRevoked) {
    safeFactors.push("✅ Mint authority revoked");
  } else {
    riskScore += 30;
    riskFactors.push("🔴 Mint authority active (+30)");
  }

  // Freeze authority
  if (mintInfo.freezeAuthorityRevoked) {
    safeFactors.push("✅ Freeze authority revoked");
  } else {
    riskScore += 20;
    riskFactors.push("🔴 Freeze authority active (+20)");
  }

  // LP Burn
  if (lpBurnStatus && lpBurnStatus.burnedAmount > 0) {
    safeFactors.push(`✅ LP tokens burned (${lpBurnStatus.burnPercentage.toFixed(1)}%)`);
  } else if (pools.length > 0) {
    riskScore += 25;
    riskFactors.push("🟡 LP tokens not burned (+25)");
  }

  // LP Mint authority
  if (lpBurnStatus && lpBurnStatus.mintAuthorityRevoked) {
    safeFactors.push("✅ LP mint authority revoked");
  } else if (pools.length > 0) {
    riskScore += 15;
    riskFactors.push("🟡 LP mint authority active (+15)");
  }

  // Holder concentration
  if (parseFloat(holders.top10Pct) > 80) {
    riskScore += 10;
    riskFactors.push("🟡 High holder concentration (+10)");
  } else {
    safeFactors.push("🟢 Reasonable holder distribution");
  }

  // Display factors
  safeFactors.forEach(f => console.log(f));
  riskFactors.forEach(f => console.log(f));

  // Risk rating
  console.log("\n" + "─".repeat(50));
  let riskRating = "LOW";
  let riskEmoji = "🟢";

  if (riskScore >= 50) {
    riskRating = "HIGH";
    riskEmoji = "🔴";
  } else if (riskScore >= 25) {
    riskRating = "MEDIUM";
    riskEmoji = "🟡";
  }

  console.log(`Risk Score: ${riskScore}/100`);
  console.log(`Risk Level: ${riskEmoji} ${riskRating}`);
  console.log("─".repeat(50));

  // ═══════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    SUMMARY                               ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Token:        ${mintAddress}`);
  console.log(`Mint Auth:    ${mintInfo.mintAuthorityRevoked ? "✅ Revoked" : "⚠️ Active"}`);
  console.log(`Freeze Auth:  ${mintInfo.freezeAuthorityRevoked ? "✅ Revoked" : "⚠️ Active"}`);
  
  if (pools.length > 0) {
    const poolAddr = pools[0].pool_address;
    console.log(`XDEX Pool:    ${shortAddr(poolAddr, 8)}`);
    const lpMintAddr = poolDetails?.pool_info?.lpMint || poolDetails?.lpMint;
  console.log(`LP Mint:      ${lpMintAddr ? shortAddr(lpMintAddr, 8) : "N/A"}`);
    console.log(`LP Burned:    ${lpBurnStatus?.burnedAmount > 0 ? "🔥 Yes" : "❌ No"}`);
    if (lpBurnStatus?.burnedAmount > 0) {
      console.log(`LP Burn %:    ${lpBurnStatus.burnPercentage.toFixed(2)}%`);
    }
  } else {
    console.log(`XDEX Pool:    ❌ None found`);
  }
  
  if (priceInfo?.price) {
    console.log(`Price:        ${formatNumber(priceInfo.price)} XNT`);
  }
  
  console.log(`Risk:         ${riskEmoji} ${riskRating} (${riskScore}/100)`);

  console.log(`\n🔗 Explorer: https://explorer.mainnet.x1.xyz/address/${mintAddress}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
