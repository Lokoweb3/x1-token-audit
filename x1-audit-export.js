#!/usr/bin/env node
/**
 * x1-audit-export.js
 * X1 Token Audit with CSV/JSON Export
 * 
 * Usage:
 *   node x1-audit-export.js <TOKEN_MINT> --format csv --output file.csv
 *   node x1-audit-export.js <TOKEN_MINT> --format json --output file.json
 *   node x1-audit-export.js <TOKEN_MINT> --format csv        # output to stdout
 * 
 * Options:
 *   --format <type>  Output format: console, csv, json (default: console)
 *   --output <path>  Output file path
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const https = require("https");
const fs = require("fs");

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

function progressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${percent.toFixed(1)}%`;
}

function riskGauge(score) {
  const total = 100;
  const filled = Math.round((score / total) * 20);
  const empty = 20 - filled;
  const bar = "🟩".repeat(filled) + "🟥".repeat(empty);
  return `[${bar}]`;
}

function timestamp() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
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
    const mintInfo = await connection.getAccountInfo(mintPubkey);
    if (!mintInfo) return result;

    const data = mintInfo.data;
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

function calculateRiskScore(audit) {
  let score = 0;

  if (audit.mintAuthorityRevoked) score += 30;
  if (audit.freezeAuthorityRevoked) score += 20;
  if (audit.lpNotBurned) score += 25;

  if (audit.holderCount && audit.holderCount > 1000) score += 10;
  else if (audit.holderCount) score += 20;

  return score;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let tokenAddress = null;
  let format = "console";
  let output = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && args[i + 1]) {
      format = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      output = args[++i];
    } else if (!args[i].startsWith("--")) {
      tokenAddress = args[i];
    }
  }

  if (!tokenAddress) {
    console.error("Usage: node x1-audit-export.js <TOKEN_MINT> [--format console|csv|json] [--output path]");
    process.exit(1);
  }

  const connection = new Connection(DEFAULT_RPC, "confirmed");
  const mintPubkey = new PublicKey(tokenAddress);

  // ─── Token Authorities ───
  const tokenInfo = await checkTokenAuthorities(connection, mintPubkey);

  const mintStatus = tokenInfo.mintAuthorityRevoked ? "✅ REVOKED" : "⚠️  ACTIVE";
  const freezeStatus = tokenInfo.freezeAuthorityRevoked ? "✅ REVOKED" : "⚠️  ACTIVE";
  const supplyFormatted = formatNumber(
    tokenInfo.supply / Math.pow(10, tokenInfo.decimals)
  );

  // ─── XDEX Pools ───
  let pools = [];
  try {
    const response = await fetchJSON(`${XDEX_API}/xendex/pool/list`);
    const allPools = response.data || [];
    pools = allPools.filter(
      (p) =>
        p.token1_address === tokenAddress || p.token2_address === tokenAddress
    );
  } catch (err) {
    console.error(`Error fetching pools: ${err.message}`);
  }

  // ─── LP Burn Check (Burn Addresses) ───
  let totalBurnedLP = 0;
  let totalLPSupply = 0;

  for (const pool of pools) {
    const lpMint = pool.lpMint || pool.lp_mint;
    if (!lpMint) continue;

    try {
      const lpMintPubkey = new PublicKey(lpMint);
      const lpSupplyInfo = await connection.getTokenSupply(lpMintPubkey);
      const lpSupply = lpSupplyInfo.value.uiAmount || 0;

      const largestAccounts = await connection.getTokenLargestAccounts(lpMintPubkey);

      let poolBurnedLP = 0;

      for (const account of largestAccounts.value || []) {
        try {
          const accountInfo = await connection.getParsedAccountInfo(account.address);
          if (!accountInfo.value) continue;

          const info = accountInfo.value.data.parsed?.info;
          if (!info) continue;

          const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
          const owner = info.owner;

          if (BURN_ADDRESSES.includes(owner)) {
            poolBurnedLP += amount;
            totalBurnedLP += amount;
          }
        } catch (err) {
          // Skip individual account errors
        }
      }

      totalLPSupply += lpSupply;
    } catch (err) {
      // Skip pool errors
    }
  }

  const totalBurnCheckedLP = 0; // BurnChecked detection requires transaction scanning
  const totalEffectiveBurn = totalBurnedLP;

  // ─── Calculate Risk Score ───
  const safeFactors = [];

  if (tokenInfo.mintAuthorityRevoked) {
    safeFactors.push({
      icon: "✅",
      text: "Mint authority revoked",
      detail: "No supply inflation risk",
    });
  }

  if (tokenInfo.freezeAuthorityRevoked) {
    safeFactors.push({
      icon: "✅",
      text: "Freeze authority revoked",
      detail: "No wallet freezing risk",
    });
  }

  if (totalEffectiveBurn > 0) {
    const combinedOriginal = totalLPSupply + totalBurnCheckedLP;
    const combinedPct =
      combinedOriginal > 0 ? (totalEffectiveBurn / combinedOriginal) * 100 : 0;

    safeFactors.push({
      icon: "🔥",
      text: `LP burned: ${formatNumber(totalEffectiveBurn)}`,
      detail: `${combinedPct.toFixed(1)}% secured`,
    });
  }

  const riskScore = calculateRiskScore({
    mintAuthorityRevoked: tokenInfo.mintAuthorityRevoked,
    freezeAuthorityRevoked: tokenInfo.freezeAuthorityRevoked,
    lpNotBurned: totalEffectiveBurn === 0,
    holderCount: pools.length,
  });

  let riskRating = "LOW RISK";
  let riskEmoji = "🟢";

  if (riskScore >= 50) {
    riskRating = "HIGH RISK";
    riskEmoji = "🔴";
  } else if (riskScore >= 25) {
    riskRating = "MEDIUM RISK";
    riskEmoji = "🟡";
  }

  // ─── Export Results ───
  const result = {
    token: tokenAddress,
    timestamp: timestamp(),
    supply: supplyFormatted,
    decimals: tokenInfo.decimals,
    mintAuthorityRevoked: tokenInfo.mintAuthorityRevoked,
    freezeAuthorityRevoked: tokenInfo.freezeAuthorityRevoked,
    poolCount: pools.length,
    lpBurnedTotal: formatNumber(totalEffectiveBurn),
    burnCheckedCount: 0,
    riskScore,
    riskRating,
    safeFactors,
  };

  let outputText;

  if (format === "csv") {
    // CSV output
    const rows = [
      "field,value",
      `token,${result.token}`,
      `timestamp,${result.timestamp}`,
      `supply,${result.supply}`,
      `decimals,${result.decimals}`,
      `mintAuthorityRevoked,${result.mintAuthorityRevoked}`,
      `freezeAuthorityRevoked,${result.freezeAuthorityRevoked}`,
      `poolCount,${result.poolCount}`,
      `lpBurnedTotal,${result.lpBurnedTotal}`,
      `riskScore,${result.riskScore}`,
      `riskRating,${result.riskRating}`,
    ];
    outputText = rows.join("\n");

    // Burn addresses
    if (totalBurnedLP > 0) {
      outputText += "\n\nburnAddresses,burnedAmount";
      outputText += `\n,totalBurned,${formatNumber(totalBurnedLP)}`;
    }
  } else if (format === "json") {
    // JSON output
    outputText = JSON.stringify(result, null, 2);
  } else {
    // Console output (build the full report)
    let report = "\n";
    report += "  ╔════════════════════════════════════════════════════════╗\n";
    report += "  ║                                                        ║\n";
    report += "  ║   🦞  X1 TOKEN AUDIT ENGINE  Export                      ║\n";
    report += "  ║   ━━━━━━━━━━━━━━━━━━━━━━━━━                            ║\n";
    report += "  ║   XDEX Pool Analysis • Burn Address Detection           ║\n";
    report += "  ║   Powered by Loko_AI                                    ║\n";
    report += "  ║                                                        ║\n";
    report += "  ╚════════════════════════════════════════════════════════╝\n";
    report += "\n";
    report += `  🕐 ${timestamp()}\n`;
    report += `  🔗 ${shortAddr(tokenAddress, 10)}\n`;
    report += `  🌐 ${DEFAULT_RPC}\n`;
    report += "\n";
    report += "  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n";
    report += "  ┃ 🔐  TOKEN AUTHORITY CHECK                            ┃\n";
    report += "  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n";
    report += "\n";
    report += `  ┌──────────────────┬─────────────────────────┐\n`;
    report += `  │ Mint Authority   │ ${mintStatus.padEnd(24)}│\n`;
    report += `  ├──────────────────┼─────────────────────────┤\n`;
    report += `  │ Freeze Authority │ ${freezeStatus.padEnd(24)}│\n`;
    report += `  ├──────────────────┼─────────────────────────┤\n`;
    report += `  │ Total Supply     │ ${supplyFormatted.padEnd(24)}│\n`;
    report += `  ├──────────────────┼─────────────────────────┤\n`;
    report += `  │ Decimals         │ ${String(tokenInfo.decimals).padEnd(24)}│\n`;
    report += `  └──────────────────┴─────────────────────────┘\n`;
    report += "\n";
    report += "  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n";
    report += "  ┃ 🏊  XDEX POOL DISCOVERY                              ┃\n";
    report += "  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n";
    report += "\n";
    report += `  🔍 Discovered ${pools.length} pool(s)\n`;
    report += "\n";

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const pairName = `${pool.token1_symbol} / ${pool.token2_symbol}`;

      report += `  ┌────────────────────────────────────────────────────┐\n`;
      report += `  │  🏊 Pool ${String(i + 1).padStart(2)}/${String(pools.length).padEnd(2)} ───────────────────────────────────────────── │\n`;
      report += `  ├────────────────────────────────────────────────────┤\n`;
      report += `  │ ${pairName.padEnd(48)}│\n`;
      report += `  ├────────────────────────────────────────────────────┤\n`;
      report += `  │ DEX:        ${pool.dex_name ? pool.dex_name.padEnd(36) : 'N/A'}│\n`;
      report += `  │ Address:    ${shortAddr(pool.pool_address, 10).padEnd(36)}│\n`;
      report += `  │ TVL:        ${pool.tvl ? ("$" + formatNumber(pool.tvl)).padEnd(36) : "N/A".padEnd(36)}│\n`;
      report += `  └────────────────────────────────────────────────────┘\n`;
    }

    // LP Safety breakdown
    const combinedOriginal = totalLPSupply + totalBurnCheckedLP;
    const combinedPct =
      combinedOriginal > 0 ? (totalEffectiveBurn / combinedOriginal) * 100 : 0;
    const circulatingLP = totalLPSupply - totalBurnedLP;

    report += "\n";
    report += "  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n";
    report += "  ┃ 🛡️  LP SAFETY BREAKDOWN                               ┃\n";
    report += "  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n";
    report += "\n";
    report += `  ┌────────────────────────────────────────────────────┐\n`;
    report += `  │    Safety:    ${progressBar(combinedPct).padEnd(36)}│\n`;
    report += `  │    Burned:    ${formatNumber(totalEffectiveBurn).padEnd(36)}│\n`;
    report += `  │    Active LP: ${formatNumber(circulatingLP).padEnd(36)}│\n`;
    report += `  └────────────────────────────────────────────────────┘\n`;
    report += "\n";
    report += `  📊 Destroyed: ${formatNumber(totalEffectiveBurn)} LP (${combinedPct.toFixed(1)}%)\n`;
    report += "\n";
    report += "  ⚠️  Note: BurnChecked detection requires transaction scanning.\n";
    report += "      Use check-xdex-lp-burn.js for full BurnChecked analysis.\n";
    report += "\n";

    // Risk Assessment
    report += "  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n";
    report += "  ┃ ⚖️   RISK ASSESSMENT                                  ┃\n";
    report += "  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n";
    report += "\n";

    if (safeFactors.length > 0) {
      report += "  SAFE:\n";
      safeFactors.forEach((f) => {
        report += `    ${f.icon} ${f.text}\n`;
        report += `       ${f.detail}\n`;
      });
      report += "\n";
    }

    report += `  SCORE:  ${String(riskScore).padStart(3)}/100\n`;
    report += `  GAUGE:  ${riskGauge(riskScore)}\n`;
    report += `  LEVEL:  ${riskEmoji} ${riskRating}\n`;
    report += "\n";

    // Footer
    report += "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    report += "  🦞 Powered by Loko_AI × X1 Token Audit Engine v2.3\n";
    report += `  🕐 ${timestamp()}\n`;
    report += "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

    outputText = report;
  }

  // Output to file or stdout
  if (output) {
    fs.writeFileSync(output, outputText);
    console.log(`✅ Output saved to ${output}`);
  } else {
    console.log(outputText);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
