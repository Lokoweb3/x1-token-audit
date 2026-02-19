#!/usr/bin/env node
/**
 * check-xdex-lp-burn.js
 * ===========================================
 * XDEX LP Burn Checker v2.1 — Enhanced Visuals
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
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
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
  console.log("  ║   🦞  X1 TOKEN AUDIT ENGINE  v2.1                      ║");
  console.log("  ║   ━━━━━━━━━━━━━━━━━━━━━━━━━                            ║");
  console.log("  ║   XDEX Pool Analysis • BurnChecked Detection            ║");
  console.log("  ║   Powered by Loko_AI                                    ║");
  console.log("  ║                                                        ║");
  console.log("  ╚════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  🕐 ${timestamp()}`);
  console.log(`  🔗 ${shortAddr(tokenAddress, 10)}`);
  console.log(`  🌐 ${DEFAULT_RPC}`);

  const connection = new Connection(DEFAULT_RPC, "confirmed");
  const mintPubkey = new PublicKey(tokenAddress);

  // ─── Token Authorities ───
  console.log();
  console.log("  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
  console.log("  ┃ 🔐  TOKEN AUTHORITY CHECK                            ┃");
  console.log("  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛");

  const tokenInfo = await checkTokenAuthorities(connection, mintPubkey);

  const mintStatus = tokenInfo.mintAuthorityRevoked ? "✅ REVOKED" : "⚠️  ACTIVE";
  const freezeStatus = tokenInfo.freezeAuthorityRevoked ? "✅ REVOKED" : "⚠️  ACTIVE";
  const supplyFormatted = formatNumber(tokenInfo.supply / Math.pow(10, tokenInfo.decimals));

  console.log();
  console.log(`  ┌──────────────────┬─────────────────────────┐`);
  console.log(`  │ Mint Authority   │ ${mintStatus.padEnd(24)}│`);
  console.log(`  ├──────────────────┼─────────────────────────┤`);
  console.log(`  │ Freeze Authority │ ${freezeStatus.padEnd(24)}│`);
  console.log(`  ├──────────────────┼─────────────────────────┤`);
  console.log(`  │ Total Supply     │ ${supplyFormatted.padEnd(24)}│`);
  console.log(`  ├──────────────────┼─────────────────────────┤`);
  console.log(`  │ Decimals         │ ${String(tokenInfo.decimals).padEnd(24)}│`);
  console.log(`  └──────────────────┴─────────────────────────┘`);

  if (!tokenInfo.mintAuthorityRevoked && tokenInfo.mintAuthority) {
    console.log(`  ⚠️  Mint Auth: ${shortAddr(tokenInfo.mintAuthority)}`);
  }
  if (!tokenInfo.freezeAuthorityRevoked && tokenInfo.freezeAuthority) {
    console.log(`  ⚠️  Freeze Auth: ${shortAddr(tokenInfo.freezeAuthority)}`);
  }

  // ─── XDEX Pools ───
  console.log();
  console.log("  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
  console.log("  ┃ 🏊  XDEX POOL DISCOVERY                              ┃");
  console.log("  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛");
  console.log("\n  🔍 Scanning XDEX for liquidity pools...");

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

  if (pools.length === 0) {
    console.log("  ❌ No pools found on XDEX\n");
    process.exit(0);
  }

  console.log(`  ✅ Discovered ${pools.length} pool(s)\n`);

  // ─── Analyze Pools ───
  let totalBurnedLP = 0;
  let totalBurnCheckedLP = 0;
  let totalLPSupply = 0;
  let allBurnTxs = [];

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const pairName = `${pool.token1_symbol} / ${pool.token2_symbol}`;

    console.log(`  ┌${"─".repeat(52)}┐`);
    console.log(`  │ 🏊 Pool ${i + 1}/${pools.length}: ${pairName.padEnd(38)}│`);
    console.log(`  └${"─".repeat(52)}┘`);
    console.log(`    DEX:        ${pool.dex_name || "XDEX"}`);
    console.log(`    Address:    ${shortAddr(pool.pool_address, 10)}`);
    console.log(`    TVL:        ${pool.tvl ? "$" + formatNumber(pool.tvl) : "N/A"}`);
    console.log(`    Vol 24h:    ${pool.token1_volume_usd_24h ? "$" + formatNumber(pool.token1_volume_usd_24h) : "N/A"}`);
    console.log(`    TXNs 24h:   ${pool.txns_24h || 0}`);
    console.log(`    APR 24h:    ${pool.apr_24h ? pool.apr_24h.toFixed(2) + "%" : "N/A"}`);

    try {
      const details = await fetchJSON(`${XDEX_API}/xendex/pool/${pool.pool_address}`);
      const poolData = details.data || {};
      const lpMint = poolData.pool_info?.lpMint;

      if (!lpMint) {
        console.log("    ❌ No LP mint found\n");
        continue;
      }

      console.log(`    LP Mint:    ${shortAddr(lpMint, 10)}`);

      const lpStatus = await checkLPBurnStatus(connection, lpMint);

      let lpSupplyFromPool = 0;
      if (poolData.pool_info?.lpSupply) {
        try {
          const hexSupply = poolData.pool_info.lpSupply.replace(/"/g, "");
          lpSupplyFromPool = parseInt(hexSupply, 16) / Math.pow(10, poolData.pool_info.lpMintDecimals || 9);
        } catch {}
      }

      const effectiveSupply = lpSupplyFromPool > 0 ? lpSupplyFromPool : lpStatus.totalSupply;
      totalLPSupply += effectiveSupply;
      totalBurnedLP += lpStatus.burnedAmount;

      console.log(`    LP Supply:  ${formatNumber(effectiveSupply)}`);

      // Burn address status
      if (lpStatus.burnedAmount > 0) {
        const burnPct = (lpStatus.burnedAmount / (effectiveSupply + lpStatus.burnedAmount)) * 100;
        console.log(`    🗑️  Burn Addr: ${formatNumber(lpStatus.burnedAmount)} ${progressBar(burnPct, 15)}`);
      } else {
        console.log(`    🗑️  Burn Addr: None detected`);
      }

      console.log(`    LP Mint Auth: ${lpStatus.mintAuthorityRevoked ? "✅ Revoked" : "⚠️  Active (normal for AMM)"}`);

      // Burn address holdings
      if (lpStatus.topHolders.length > 0) {
        const burnHolders = lpStatus.topHolders.filter(h => h.isBurnAddress);
        if (burnHolders.length > 0) {
          console.log(`\n    📍 Burn Address Holdings:`);
          burnHolders.forEach(h => {
            console.log(`       • ${shortAddr(h.address)}: ${formatNumber(h.amount)}`);
          });
        }
      }

      // BurnChecked transactions
      console.log(`\n    🔥 Scanning for BurnChecked transactions...`);
      const burnTxs = await checkBurnCheckedTxs(connection, lpMint);

      if (burnTxs.length > 0) {
        let poolBurnChecked = 0;
        console.log(`    ✅ Found ${burnTxs.length} BurnChecked transaction(s)!\n`);

        burnTxs.forEach((b, idx) => {
          poolBurnChecked += b.amount;
          const typeLabel = b.type === "burnChecked" ? "BurnChecked" : "Burn";
          const dateStr = b.date.split("T")[0];
          const txShort = shortAddr(b.signature, 12);

          console.log(`    ┌${"─".repeat(50)}`);
          console.log(`    │  🔥 BURN #${idx + 1} ${"─".repeat(36)} │`);
          console.log(`    ├${"─".repeat(50)}`);
          console.log(`    │ Amount:      ${formatNumber(b.amount)} LP tokens         │`);
          console.log(`    │ Method:      ${typeLabel} ✅ (permanent destruction) │`);
          console.log(`    │ Date:        ${dateStr}                            │`);
          console.log(`    │ Authority:   ${shortAddr(b.authority)}                        │`);
          console.log(`    │ Explorer:    https://explorer.mainnet.x1.xyz/tx/${b.signature} │`);
          console.log(`    └${"─".repeat(50)}`);
          console.log();
        });

        const originalSupply = effectiveSupply + poolBurnChecked;
        const destroyedPct = (poolBurnChecked / originalSupply) * 100;

        console.log(`    📊 Destroyed: ${formatNumber(poolBurnChecked)} LP`);
        console.log(`    📊 Progress:  ${progressBar(destroyedPct)}`);

        totalBurnCheckedLP += poolBurnChecked;
        allBurnTxs = allBurnTxs.concat(burnTxs);
      } else {
        console.log(`    ❌ No BurnChecked transactions found`);
      }

      console.log();
    } catch (err) {
      console.error(`    Error analyzing pool: ${err.message}\n`);
    }
  }

  // ─── Risk Summary ───
  let riskScore = 0;
  const safeFactors = [];
  const riskFactors = [];

  if (tokenInfo.mintAuthorityRevoked) {
    safeFactors.push({ icon: "✅", text: "Mint authority revoked", detail: "No new tokens can be created" });
  } else {
    riskScore += 30;
    riskFactors.push({ icon: "🔴", text: "Mint authority ACTIVE", detail: "New tokens can be minted (+30)" });
  }

  if (tokenInfo.freezeAuthorityRevoked) {
    safeFactors.push({ icon: "✅", text: "Freeze authority revoked", detail: "Wallets cannot be frozen" });
  } else {
    riskScore += 20;
    riskFactors.push({ icon: "🔴", text: "Freeze authority ACTIVE", detail: "Wallets can be frozen (+20)" });
  }

  if (totalBurnedLP > 0) {
    const pct = totalLPSupply > 0 ? (totalBurnedLP / (totalLPSupply + totalBurnedLP)) * 100 : 0;
    safeFactors.push({ icon: "🗑️", text: `LP in burn addresses (${pct.toFixed(1)}%)`, detail: `${formatNumber(totalBurnedLP)} LP tokens` });
  }

  if (totalBurnCheckedLP > 0) {
    const originalTotal = totalLPSupply + totalBurnCheckedLP;
    const destroyedPct = (totalBurnCheckedLP / originalTotal) * 100;
    safeFactors.push({ icon: "🔥", text: `LP destroyed via BurnChecked (${destroyedPct.toFixed(1)}%)`, detail: `${formatNumber(totalBurnCheckedLP)} LP gone forever` });
  }

  const totalEffectiveBurn = totalBurnedLP + totalBurnCheckedLP;
  if (totalEffectiveBurn <= 0) {
    riskScore += 25;
    riskFactors.push({ icon: "🟡", text: "No LP burned or destroyed", detail: "Liquidity can be pulled (+25)" });
  }

  let riskRating = "LOW RISK";
  let riskEmoji = "🟢";

  if (riskScore >= 50) {
    riskRating = "HIGH RISK";
    riskEmoji = "🔴";
  } else if (riskScore >= 25) {
    riskRating = "MEDIUM RISK";
    riskEmoji = "🟡";
  }

  console.log();
  console.log("  ╔════════════════════════════════════════════════════════╗");
  console.log("  ║                                                        ║");
  console.log("  ║              ⚖️   RISK ASSESSMENT                       ║");
  console.log("  ║                                                        ║");
  console.log("  ╠════════════════════════════════════════════════════════╣");

  // Safe factors
  if (safeFactors.length > 0) {
    console.log("  ║                                                        ║");
    console.log("  ║  SAFE:                                                 ║");
    safeFactors.forEach(f => {
      console.log(`  ║    ${f.icon} ${f.text.padEnd(49)}║`);
      console.log(`  ║       ${f.detail.padEnd(47)}║`);
    });
  }

  // Risk factors
  if (riskFactors.length > 0) {
    console.log("  ║                                                        ║");
    console.log("  ║  RISKS:                                                ║");
    riskFactors.forEach(f => {
      console.log(`  ║    ${f.icon} ${f.text.padEnd(49)}║`);
      console.log(`  ║       ${f.detail.padEnd(47)}║`);
    });
  }

  // LP Safety breakdown
  if (totalEffectiveBurn > 0) {
    const combinedOriginal = totalLPSupply + totalBurnCheckedLP;
    const combinedPct = combinedOriginal > 0 ? (totalEffectiveBurn / combinedOriginal) * 100 : 0;
    const circulatingLP = totalLPSupply - totalBurnedLP;

    console.log("  ║                                                        ║");
    console.log("  ╠════════════════════════════════════════════════════════╣");
    console.log("  ║                                                        ║");
    console.log("  ║  🛡️  LP SAFETY BREAKDOWN                               ║");
    console.log("  ║                                                        ║");
    console.log(`  ║    Safety:    ${progressBar(combinedPct).padEnd(40)}║`);
    console.log(`  ║    Destroyed: ${formatNumber(totalBurnCheckedLP).padEnd(40)}║`);
    console.log(`  ║    Burn Addr: ${formatNumber(totalBurnedLP).padEnd(40)}║`);
    console.log(`  ║    Active LP: ${formatNumber(circulatingLP).padEnd(40)}║`);
  }

  // Final score
  console.log("  ║                                                        ║");
  console.log("  ╠════════════════════════════════════════════════════════╣");
  console.log("  ║                                                        ║");
  console.log(`  ║    SCORE:  ${String(riskScore).padStart(3)}/100                                    ║`);
  console.log(`  ║    GAUGE:  ${riskGauge(riskScore)}                             ║`);
  console.log(`  ║    LEVEL:  ${riskEmoji} ${riskRating.padEnd(42)}║`);
  console.log("  ║                                                        ║");
  console.log("  ╚════════════════════════════════════════════════════════╝");

  // BurnChecked explainer
  if (totalBurnCheckedLP > 0) {
    console.log();
    console.log("  ┌────────────────────────────────────────────────────┐");
    console.log("  │ 💡 What is BurnChecked?                            │");
    console.log("  │                                                    │");
    console.log("  │ BurnChecked permanently destroys tokens on-chain.  │");
    console.log("  │ Unlike sending to a burn address, the total supply │");
    console.log("  │ is reduced. The tokens cease to exist forever.     │");
    console.log("  │                                                    │");
    console.log("  │ 🔒 Irreversible • 🔗 On-chain verified             │");
    console.log("  │ 💎 Strongest form of LP security                   │");
    console.log("  └────────────────────────────────────────────────────┘");
    console.log();
    console.log("  🔥 BurnExplorer:");
    console.log(`  https://explorer.mainnet.x1.xyz/address/${tokenAddress}`);
    console.log();
  }

  // Footer
  console.log();
  console.log(`  🔗 Explorer: https://explorer.mainnet.x1.xyz/address/${tokenAddress}`);

  if (allBurnTxs.length > 0) {
    console.log();
    console.log("  🔥 Burn Transaction Log:");
    console.log(`  ${"─".repeat(54)}`);
    allBurnTxs.forEach((b, idx) => {
      console.log(`   ${String(idx + 1).padStart(2)}. ${formatNumber(b.amount).padEnd(10)} │ ${b.date.split("T")[0]} │ ${shortAddr(b.signature, 10)}`);
    });
    console.log(`  ${"─".repeat(54)}`);
  }

  console.log();
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🦞 Powered by Loko_AI × X1 Token Audit Engine v2.2");
  console.log(`  🕐 ${timestamp()}`);
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
