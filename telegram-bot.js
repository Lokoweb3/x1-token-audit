#!/usr/bin/env node
/**
 * x1-token-audit Telegram Bot
 * ===========================================
 * Run token audits and LP burn checks from Telegram
 *
 * Commands:
 *   /audit <TOKEN_MINT> - Full token audit with risk score
 *   /lp <TOKEN_MINT>    - Check LP burn status
 *   /watch <TOKEN_MINT> - Add token to watchlist
 *   /watch list         - Show watchlist
 *   /stats              - Show audit statistics
 *
 * Environment Variables:
 *   TELEGRAM_BOT_TOKEN - Your bot token from @BotFather
 *   X1_RPC_URL         - RPC endpoint (default: https://rpc.mainnet.x1.xyz)
 *
 * Usage:
 *   node telegram-bot.js
 *   node telegram-bot.js --port 8080
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');

const TELEGRAM_API = 'https://api.telegram.org/bot';
const DEFAULT_RPC = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';

// Configuration
const CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  port: parseInt(process.env.PORT) || 8080,
  watchlistFile: path.join(__dirname, 'watchlist.json'),
  auditHistoryFile: path.join(__dirname, 'audit-history.json'),
  maxHistory: 50
};

// State
let watchlist = new Set();
let auditHistory = [];

// Load data files
function loadWatchlist() {
  try {
    if (fs.existsSync(CONFIG.watchlistFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.watchlistFile, 'utf8'));
      watchlist = new Set(data);
    }
  } catch (err) {
    console.error('⚠️  Failed to load watchlist:', err.message);
  }
}

function saveWatchlist() {
  try {
    fs.writeFileSync(CONFIG.watchlistFile, JSON.stringify([...watchlist], null, 2));
  } catch (err) {
    console.error('⚠️  Failed to save watchlist:', err.message);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(CONFIG.auditHistoryFile)) {
      auditHistory = JSON.parse(fs.readFileSync(CONFIG.auditHistoryFile, 'utf8'));
    }
  } catch (err) {
    console.error('⚠️  Failed to load history:', err.message);
  }
}

function saveHistory() {
  try {
    auditHistory = auditHistory.slice(-CONFIG.maxHistory);
    fs.writeFileSync(CONFIG.auditHistoryFile, JSON.stringify(auditHistory, null, 2));
  } catch (err) {
    console.error('⚠️  Failed to save history:', err.message);
  }
}

function shortAddr(addr, len = 6) {
  if (!addr) return 'N/A';
  const s = typeof addr === 'string' ? addr : addr.toBase58();
  return s.length > len * 2 ? `${s.slice(0, len)}...${s.slice(-len)}` : s;
}

function formatNumber(n, decimals = 9) {
  if (typeof n === 'string') n = parseFloat(n);
  if (isNaN(n)) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(n < 1 ? 6 : 2);
}

function sendMessage(chatId, text, replyToMessageId = null) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_to_message_id: replyToMessageId || undefined
    });

    const options = {
      hostname: 'api.telegram.org',
      path: '/bot' + CONFIG.botToken + '/sendMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.ok) {
            resolve(result.result);
          } else {
            reject(new Error(result.description || 'Telegram API error'));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function editMessage(chatId, messageId, text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'Markdown'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: '/bot' + CONFIG.botToken + '/editMessageText',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.ok) {
            resolve(result.result);
          } else {
            reject(new Error(result.description || 'Telegram API error'));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
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

async function runFullAudit(tokenAddress, chatId, messageId) {
  await sendMessage(chatId, `🔍 Auditing ${shortAddr(tokenAddress)}...`, messageId);

  try {
    const BURN_ADDRESSES = [
      '1nc1nerator11111111111111111111111111111111',
      '11111111111111111111111111111111',
      '1111111111111111111111111111111111111111111',
    ];

    const connection = new Connection(DEFAULT_RPC, 'confirmed');
    const mintPubkey = new PublicKey(tokenAddress);

    // Check authorities
    const tokenInfo = await checkTokenAuthorities(connection, mintPubkey);

    // Fetch pools
    let pools = [];
    try {
      const response = await fetchJSON('https://api.xdex.xyz/api/xendex/pool/list');
      const allPools = response.data || [];
      pools = allPools.filter(p =>
        p.token1_address === tokenAddress || p.token2_address === tokenAddress
      );
    } catch (err) {
      console.error('Failed to fetch pools:', err.message);
    }

    // Calculate LP burn
    let totalBurned = 0;
    let totalSupply = 0;

    for (const pool of pools) {
      try {
        const poolData = await fetchJSON(`https://api.xdex.xyz/api/xendex/pool/${pool.pool_address}`);
        const lpMint = poolData.data?.pool_info?.lpMint;
        if (!lpMint) continue;

        const lpMintPubkey = new PublicKey(lpMint);
        const lpAccount = await connection.getAccountInfo(lpMintPubkey);
        if (!lpAccount || lpAccount.data.length < 82) continue;

        const lpSupplyLow = BigInt(lpAccount.data.readUInt32LE(36));
        const lpSupplyHigh = BigInt(lpAccount.data.readUInt32LE(40));
        const lpSupply = Number((lpSupplyHigh << BigInt(32)) | lpSupplyLow);
        const lpDecimals = lpAccount.data.readUInt8(44);

        const largestAccounts = await connection.getTokenLargestAccounts(lpMintPubkey);
        for (const account of largestAccounts.value || []) {
          try {
            const accInfo = await connection.getParsedAccountInfo(account.address);
            if (!accInfo.value) continue;
            const info = accInfo.value.data.parsed?.info;
            if (!info) continue;
            const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
            if (BURN_ADDRESSES.includes(info.owner)) {
              totalBurned += amount;
            }
          } catch {}
        }
        totalSupply += lpSupply / Math.pow(10, lpDecimals);
      } catch (err) {
        console.error(`Failed to process pool ${pool.pool_address}:`, err.message);
      }
    }

    const burnPct = totalSupply > 0 ? (totalBurned / (totalSupply + totalBurned)) * 100 : 0;

    // Calculate risk score
    let riskScore = 0;
    const riskFactors = [];
    const safeFactors = [];

    if (tokenInfo.mintAuthorityRevoked) {
      safeFactors.push('✅ Mint authority revoked');
    } else {
      riskScore += 30;
      riskFactors.push('🔴 Mint authority active (+30)');
    }

    if (tokenInfo.freezeAuthorityRevoked) {
      safeFactors.push('✅ Freeze authority revoked');
    } else {
      riskScore += 20;
      riskFactors.push('🔴 Freeze authority active (+20)');
    }

    if (totalBurned > 0) {
      safeFactors.push(`✅ LP tokens burned (${burnPct.toFixed(1)}%)`);
    } else {
      riskScore += 25;
      riskFactors.push('🟡 LP tokens not burned (+25)');
    }

    let riskRating = 'LOW';
    let riskEmoji = '🟢';
    if (riskScore >= 50) {
      riskRating = 'HIGH';
      riskEmoji = '🔴';
    } else if (riskScore >= 25) {
      riskRating = 'MEDIUM';
      riskEmoji = '🟡';
    }

    // Build response
    let response = `*Token Audit: ${shortAddr(tokenAddress)}*\n\n`;
    response += `*📋 Token Info*\n`;
    response += `Mint Authority: ${tokenInfo.mintAuthorityRevoked ? '✅ Revoked' : '⚠️ Active'}\n`;
    response += `Freeze Auth:    ${tokenInfo.freezeAuthorityRevoked ? '✅ Revoked' : '⚠️ Active'}\n`;
    response += `Supply:         ${formatNumber(tokenInfo.supply / Math.pow(10, tokenInfo.decimals), tokenInfo.decimals)}\n`;
    response += `Decimals:       ${tokenInfo.decimals}\n`;
    response += `Pools:          ${pools.length}\n\n`;

    if (pools.length > 0) {
      response += `*🔍 Pools (${pools.length})*\n`;
      for (let i = 0; i < Math.min(3, pools.length); i++) {
        const p = pools[i];
        response += `${i + 1}. ${p.token1_symbol || '?'} / ${p.token2_symbol || '?'}\n`;
        response += `   TVL: $${formatNumber(p.tvl || 0)}\n`;
      }
      response += '\n';
    }

    response += `*🔥 LP Burn Status*\n`;
    response += `Total Burned:   ${formatNumber(totalBurned)}\n`;
    response += `Burn Percentage: ${burnPct.toFixed(1)}%\n`;
    response += `LP Burned:      ${totalBurned > 0 ? '✅ Yes' : '❌ No'}\n\n`;

    response += `*📊 Risk Summary*\n`;
    safeFactors.forEach(f => response += `${f}\n`);
    riskFactors.forEach(f => response += `${f}\n`);
    response += `\n`;
    response += `*Risk Score: ${riskScore}/100*\n`;
    response += `*Risk Level: ${riskEmoji} ${riskRating}*\n`;
    response += `\n`;
    response += `_Audit completed at ${new Date().toISOString()}_\n`;
    response += `🔗 Explorer: https://explorer.mainnet.x1.xyz/address/${tokenAddress}`;

    // Update message
    await editMessage(chatId, messageId, response);

    // Log history
    auditHistory.push({
      token: tokenAddress,
      timestamp: Date.now(),
      riskScore,
      riskRating,
      user: chatId
    });
    saveHistory();

  } catch (err) {
    await editMessage(chatId, messageId, `❌ Error: ${err.message}`);
  }
}

// Parse command
function parseCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { command, args };
}

// Handle Telegram update
async function handleUpdate(update) {
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text;
  const messageId = update.message.message_id;
  const user = update.message.from.username || update.message.from.first_name;

  if (!text) return;

  console.log(`Message from ${user}: ${text}`);

  // Show help
  if (text === '/help' || text === '/start') {
    const help = `*X1 Token Audit Bot*

Commands:
/audit <TOKEN>  - Full token audit with risk score
/lp <TOKEN>     - Check LP burn status
/watch <TOKEN>  - Add token to watchlist
/watch list     - Show watchlist
/stats          - Show audit statistics

Example:
/audit 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER
    `;
    await sendMessage(chatId, help);
    return;
  }

  const { command, args } = parseCommand(text);

  switch (command) {
    case '/audit':
      if (!args[0]) {
        await sendMessage(chatId, 'Usage: /audit <TOKEN_MINT>', messageId);
        return;
      }
      await sendMessage(chatId, `🔍 Auditing ${shortAddr(args[0])}...`, messageId);
      await runFullAudit(args[0], chatId, messageId);
      break;

    case '/lp':
      await sendMessage(chatId, 'LP burn checker coming soon...', messageId);
      break;

    case '/watch':
      if (args[0] === 'list') {
        if (watchlist.size === 0) {
          await sendMessage(chatId, '📋 Watchlist is empty');
        } else {
          let list = '*Your Watchlist*\n\n';
          let count = 0;
          for (const mint of watchlist) {
            list += `${++count}. ${shortAddr(mint)}\n`;
            if (count >= 10) {
              list += `... and ${watchlist.size - 10} more`;
              break;
            }
          }
          await sendMessage(chatId, list);
        }
      } else if (args[0]) {
        const mint = args[0];
        if (watchlist.has(mint)) {
          await sendMessage(chatId, '⚠️  Token already in watchlist');
        } else {
          watchlist.add(mint);
          saveWatchlist();
          await sendMessage(chatId, `✅ Added ${shortAddr(mint)} to watchlist`);
        }
      } else {
        await sendMessage(chatId, 'Usage: /watch <TOKEN> /watch list');
      }
      break;

    case '/stats':
      const totalAudits = auditHistory.length;
      let lowRisk = 0, mediumRisk = 0, highRisk = 0;
      for (const audit of auditHistory) {
        if (audit.riskRating === 'LOW') lowRisk++;
        else if (audit.riskRating === 'MEDIUM') mediumRisk++;
        else highRisk++;
      }

      const stats = `*📊 Audit Statistics*

Total audits: ${totalAudits}
🟢 LOW risk:   ${lowRisk}
🟡 MEDIUM risk: ${mediumRisk}
🔴 HIGH risk:  ${highRisk}
🔥 Watchlist:  ${watchlist.size}`;

      await sendMessage(chatId, stats);
      break;

    default:
      await sendMessage(chatId, 'Unknown command. Use /help for commands.');
  }
}

// Polling
async function polling() {
  let offset = 0;
  console.log('🤖 Polling for Telegram messages...');

  while (true) {
    try {
      const response = await fetchJSON(`https://api.telegram.org/bot${CONFIG.botToken}/getUpdates?offset=${offset}&timeout=30`);
      if (response.ok && response.result) {
        for (const update of response.result) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            console.error('Error handling update:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// HTTP webhook (alternative to polling)
function createWebhookServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const update = JSON.parse(body);
          await handleUpdate(update);
          res.writeHead(200);
          res.end('OK');
        } catch (err) {
          res.writeHead(400);
          res.end('Error: ' + err.message);
        }
      });
    } else {
      res.writeHead(200);
      res.end('X1 Token Audit Bot is running');
    }
  });

  return server;
}

// Main
async function main() {
  if (!CONFIG.botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set');
    console.error('Run: export TELEGRAM_BOT_TOKEN=<your-token>');
    process.exit(1);
  }

  loadWatchlist();
  loadHistory();

  console.log('🤖 X1 Token Audit Bot Starting...');
  console.log('📊 Watchlist:', watchlist.size, 'tokens');
  console.log('📝 History:', auditHistory.length, 'audits');

  // Use polling
  await polling();
}

main().catch(console.error);
