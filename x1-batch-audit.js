#!/usr/bin/env node
/**
 * x1-batch-audit.js
 * Batch Token Audit Tool for X1 Blockchain
 * 
 * Audits multiple tokens from a file or command line list.
 * Outputs results to console, CSV, or JSON.
 * 
 * Usage:
 *   node x1-batch-audit.js --tokens TOKEN1,TOKEN2,TOKEN3
 *   node x1-batch-audit.js --file tokens.txt
 *   node x1-batch-audit.js --format csv --output results.csv
 *   node x1-batch-audit.js --format json --output results.json
 *   node x1-batch-audit.js --tokens 7SXm...,y1KE... --format json
 * 
 * Options:
 *   --tokens <LIST>  Comma-separated token mints
 *   --file <PATH>    File containing one token per line
 *   --format <TYPE>  Output format: console, csv, json (default: console)
 *   --output <PATH>  Output file path
 *   --api <URL>      XDEX API endpoint (default: https://api.xdex.xyz/api/xendex/pool/list)
 */

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────

const XDEX_API = process.env.XDEX_API || 'https://api.xdex.xyz/api/xendex/pool/list';
const DEFAULT_OUTPUT = 'console';

// Token mint addresses from memory
const SAMPLE_TOKENS = [
  '7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER', // AGI
  'y1KEaaWVoEfX2gH7X1Vougmc9yD1Bi2c9VHeD7bDnNC', // XEN
  '54uAdhRHZmbGnD1tATH7F7Qp5us7xsXJQTf6MpMEdFbg'  // JACK
];

// ──────────────────────────────────────────────────────────────
// Argument Parsing
// ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    tokens: [],
    file: null,
    format: DEFAULT_OUTPUT,
    output: null,
    api: XDEX_API
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tokens' && args[i + 1]) {
      options.tokens = args[++i].split(',').map(t => t.trim());
    } else if (arg === '--file' && args[i + 1]) {
      options.file = args[++i];
    } else if (arg === '--format' && args[i + 1]) {
      options.format = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--api' && args[i + 1]) {
      options.api = args[++i];
    }
  }

  // Load tokens from file if specified
  if (options.file) {
    const content = fs.readFileSync(options.file, 'utf8');
    options.tokens = content.split('\n')
      .map(t => t.trim())
      .filter(t => t && !t.startsWith('#'));
  }

  if (options.tokens.length === 0) {
    console.error('❌ No tokens specified. Use --tokens or --file');
    console.error('Usage: node x1-batch-audit.js --tokens TOKEN1,TOKEN2 --format csv --output results.csv');
    console.error('Example: node x1-batch-audit.js --tokens 7SXm...,y1KE...,54uA... --format json');
    process.exit(1);
  }

  return options;
}

// ──────────────────────────────────────────────────────────────
// XDEX API Helper
// ──────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getXDEXPools() {
  try {
    // Try multiple XDEX API endpoints
    const endpoints = [
      'https://api.xdex.xyz/api/xendex/pool/list',
      'https://api.xdex.xyz/api/xendex/pool/list?chain=x1',
      'https://api.xdex.xyz/api/xendex/pool'  // Alternative endpoint
    ];

    for (const url of endpoints) {
      try {
        const data = await fetchJSON(url);
        if (data && (data.pools || data.data?.pools || data.data)) {
          // Normalize response formats
          if (data.pools) return data.pools;
          if (data.data?.pools) return data.data.pools;
          if (Array.isArray(data.data)) return data.data;
        }
      } catch (e) {
        // Try next endpoint
        continue;
      }
    }
    
    console.error('⚠️  Failed to fetch XDEX pools from all endpoints');
    return [];
  } catch (e) {
    console.error(`⚠️  Failed to fetch XDEX pools: ${e.message}`);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Token Authority Check
// ──────────────────────────────────────────────────────────────

const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');

// X1 RPC endpoint
const X1_RPC_URL = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';

// Create connection with X1 RPC
function createConnection() {
  return new Connection(X1_RPC_URL, 'confirmed');
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
    const info = await connection.getTokenSupply(mintPubkey);
    result.supply = info.value.uiAmount;
    result.decimals = info.value.decimals;

    const account = await connection.getAccountInfo(mintPubkey);
    if (account && account.data) {
      // SPL Token mint data is 82 bytes
      // Bytes 35-67: Mint authority (32 bytes)
      // Byte 68: Is mint authority frozen (1 byte)
      // Bytes 69-101: Freeze authority (32 bytes)
      // Byte 102: Is freeze authority frozen (1 byte)

      const mintAuthority = account.data.slice(35, 67);
      result.mintAuthority = mintAuthority.toString('hex');
      result.mintAuthorityRevoked = mintAuthority.every(b => b === 0);

      const freezeAuthority = account.data.slice(69, 101);
      result.freezeAuthority = freezeAuthority.toString('hex');
      result.freezeAuthorityRevoked = freezeAuthority.every(b => b === 0);
    }
  } catch (e) {
    console.error(`Error-checking ${mintPubkey.toBase58()}: ${e.message}`);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
// LP Burn Detection (Simple Implementation)
// ──────────────────────────────────────────────────────────────

const BURN_ADDRESSES = [
  '1nc1nerator11111111111111111111111111111111',
  '1111111111111111111111111111111111111111',
  '00000000000000000000000000000000000000000000'
];

function formatNumber(n, decimals = 9) {
  if (typeof n === 'string') n = parseFloat(n);
  if (isNaN(n)) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(n < 1 ? 6 : 2);
}

function calculateRiskScore(audit) {
  let score = 0;
  
  // Mint authority (30 points)
  if (audit.mintAuthorityRevoked) score += 30;
  
  // Freeze authority (20 points)
  if (audit.freezeAuthorityRevoked) score += 20;
  
  // LP not burned (25 points)
  if (audit.lpNotBurned) score += 25;
  
  // Holder concentration (10-20 points based on count)
  if (audit.holderCount && audit.holderCount > 1000) score += 10;
  else if (audit.holderCount) score += 20;
  
  return score;
}

// ──────────────────────────────────────────────────────────────
// Batch Audit Logic
// ──────────────────────────────────────────────────────────────

async function auditToken(mint, pools) {
  const connection = createConnection();
  
  const result = {
    mint,
    supply: 'N/A',
    decimals: 0,
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    poolCount: 0,
    lpNotBurned: true,
    holderCount: 0,
    riskScore: 100,
    riskRating: 'UNKNOWN'
  };

  try {
    const pubkey = new PublicKey(mint);
    const auth = await checkTokenAuthorities(connection, pubkey);
    
    result.supply = formatNumber(auth.supply, auth.decimals);
    result.decimals = auth.decimals;
    result.mintAuthorityRevoked = auth.mintAuthorityRevoked;
    result.freezeAuthorityRevoked = auth.freezeAuthorityRevoked;

    // Count pools for this token
    const tokenPools = pools.filter(p => checkPoolForToken(p, mint));
    result.poolCount = tokenPools.length;

    // Check LP burn (simplified)
    const hasBurnedLP = tokenPools.some(p => {
      const lpMint = p.lpMint || p.lp_mint;
      if (!lpMint) return false;
      return BURN_ADDRESSES.some(addr => lpMint.includes(addr) || addr.includes(lpMint));
    });
    result.lpNotBurned = !hasBurnedLP;

    // Estimate holder count (from pools)
    result.holderCount = tokenPools.reduce((sum, p) => {
      return sum + (p.tkn0?.holders || 0) + (p.tkn1?.holders || 0);
    }, 0);

    // Calculate risk score
    result.riskScore = calculateRiskScore(result);
    
    // Determine risk rating
    if (result.riskScore <= 30) result.riskRating = 'LOW';
    else if (result.riskScore <= 60) result.riskRating = 'MEDIUM';
    else result.riskRating = 'HIGH';

  } catch (e) {
    console.error(`Failed to audit ${mint}: ${e.message}`);
    // Keep defaults for failed audits
  }

  return result;
}

async function batchAudit(tokens, options) {
  // Fetch all pools once
  console.log('🔍 Fetching XDEX pools...');
  const pools = await getXDEXPools();
  console.log(`📊 Found ${pools.length} pools`);

  // Audit each token
  console.log(`\n🚀 Auditing ${tokens.length} tokens...\n`);
  
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    process.stdout.write(`[${i + 1}/${tokens.length}] ${token.slice(0, 12)}... `);
    
    try {
      const result = await auditToken(token, pools);
      results.push(result);
      console.log(`✅ ${result.riskRating} (Score: ${result.riskScore})`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
      results.push({
        mint: token,
        error: e.message,
        riskRating: 'ERROR',
        riskScore: 100
      });
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────────
// Output Formatters
// ──────────────────────────────────────────────────────────────

function formatConsole(results) {
  let output = '';
  
  for (const result of results) {
    output += `┌─────────────────────────────────────────────────────────\n`;
    output += `│  ${result.mint.slice(0, 24)}...${result.mint.slice(-12)}\n`;
    output += `├─────────────────────────────────────────────────────────\n`;
    output += `│ Supply:      ${result.supply}\n`;
    output += `│ Decimals:    ${result.decimals}\n`;
    output += `│ Pools:       ${result.poolCount}\n`;
    output += `│ Holders:     ${result.holderCount}\n`;
    output += `│ Mint Auth:   ${result.mintAuthorityRevoked ? '✅ Revoked' : '❌ Active'}\n`;
    output += `│ Freeze Auth: ${result.freezeAuthorityRevoked ? '✅ Revoked' : '❌ Active'}\n`;
    output += `│ LP Not Burn: ${result.lpNotBurned ? '⚠️ Yes' : '✅ No'}\n`;
    output += `├─────────────────────────────────────────────────────────\n`;
    output += `│ Risk Score:  ${result.riskScore}/100\n`;
    output += `│ Risk:        ${result.riskRating}\n`;
    output += `└─────────────────────────────────────────────────────────\n\n`;
  }
  
  return output;
}

function formatCSV(results) {
  const headers = [
    'Token',
    'Supply',
    'Decimals',
    'Pools',
    'Holders',
    'MintAuthRevoked',
    'FreezeAuthRevoked',
    'LPNotBurned',
    'RiskScore',
    'RiskRating'
  ];

  let csv = headers.join(',') + '\n';
  
  for (const result of results) {
    csv += [
      result.mint,
      result.supply,
      result.decimals,
      result.poolCount,
      result.holderCount,
      result.mintAuthorityRevoked ? 'true' : 'false',
      result.freezeAuthorityRevoked ? 'true' : 'false',
      result.lpNotBurned ? 'true' : 'false',
      result.riskScore,
      result.riskRating
    ].join(',') + '\n';
  }
  
  return csv;
}

function formatJSON(results) {
  return JSON.stringify(results, null, 2);
}

function checkPoolForToken(pool, token) {
  // Check if pool contains the token (using token1_address/token2_address format)
  return pool.token1_address === token || pool.token2_address === token ||
         pool.tkn0?.mint === token || pool.tkn1?.mint === token ||
         (pool.mints && pool.mints.includes(token));
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs();
  
  const start = Date.now();
  const results = await batchAudit(options.tokens, options);
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  // Format output
  let output;
  switch (options.format) {
    case 'csv':
      output = formatCSV(results);
      break;
    case 'json':
      output = formatJSON(results);
      break;
    case 'console':
    default:
      output = formatConsole(results);
  }

  // Output to file or stdout
  if (options.output) {
    fs.writeFileSync(options.output, output);
    console.log(`\n✅ Output saved to ${options.output}`);
  } else {
    console.log(output);
  }

  // Summary
  const lowRisk = results.filter(r => r.riskRating === 'LOW').length;
  const mediumRisk = results.filter(r => r.riskRating === 'MEDIUM').length;
  const highRisk = results.filter(r => r.riskRating === 'HIGH').length;
  const errors = results.filter(r => r.riskRating === 'ERROR').length;

  console.log(`\n📊 Summary (completed in ${duration}s):`);
  console.log(`   Total: ${results.length}`);
  console.log(`   LOW:   ${lowRisk}`);
  console.log(`   MEDIUM:${mediumRisk}`);
  console.log(`   HIGH:  ${highRisk}`);
  console.log(`   ERROR: ${errors}`);
}

main().catch(console.error);
