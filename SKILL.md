# X1 Token Audit

X1 blockchain token safety analyzer with XDEX API integration and transaction decoding.

## Overview

Comprehensive token auditing tool for X1 (SVM) blockchain that checks:
- Mint authority status (can new tokens be minted?)
- Freeze authority status (can wallets be frozen?)
- XDEX pool discovery and analysis
- LP (Liquidity Provider) token burn status
- LP mint authority
- Holder distribution
- Risk scoring (0-100)

### Transaction Decoder

New in v1.1.0: Transaction decoder for detailed analysis of any transaction on X1:

- **Instruction breakdown**: Learn exactly what each instruction does
- **Token balance changes**: Visualize token inflows/outflows with 📈📉 indicators
- **Error diagnosis**: See failed transactions with their errors
- **Log messages**: Review first 10 log entries for debugging

### Telegram Bot

New in v2.0: Telegram bot for running token audits directly from chat!

**See [README_TG.md](README_TG.md) for complete Telegram bot documentation.**

### Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-xdex-lp-burn.js` | Full audit with XDEX pools | `node check-xdex-lp-burn.js <TOKEN_MINT>` |
| `x1-token-audit.js` | Legacy comprehensive audit | `node x1-token-audit.js <TOKEN_MINT>` |
| `check-lp-by-mint.js` | Check specific LP mint | `node check-lp-by-mint.js <LP_MINT>` |
| `x1-lp-audit.js` | Find pools for token | `node x1-lp-audit.js <TOKEN_MINT>` |
| `check-lp-detailed.js` | Detailed LP analysis | `node check-lp-detailed.js <TOKEN_MINT>` |
| `check-burn-txs.js` | Burn transaction history | `node check-burn-txs.js <ADDRESS>` |
| `decode-tx.js` | Decode and analyze any transaction | `node decode-tx.js <TX_HASH>` |
| `telegram-bot.js` | Telegram bot for audits | `node telegram-bot.js` |

## Quick Start

```bash
# Install dependencies
npm install @solana/web3.js

# Audit a token (recommended)
node check-xdex-lp-burn.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER

# Check specific LP mint
node check-lp-by-mint.js 9GYcTvLdC281FAJEQfvTZ15uGHY5ioGUbsY2iCxJqseV

# Decode a transaction (new in v1.1.0)
node decode-tx.js 5xGqvK7p...vK7p

# Run Telegram bot
export TELEGRAM_BOT_TOKEN=<your-token>
node telegram-bot.js

# See README_TG.md for complete Telegram bot documentation
```

## Environment Variables

- `X1_RPC_URL` - X1 RPC endpoint (default: `https://rpc.mainnet.x1.xyz`)
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token from @BotFather
- `PORT` - HTTP port for webhook server (default: 8080)

## Risk Scoring

| Factor | Weight | Description |
|--------|--------|-------------|
| Mint authority active | +30 | Can mint unlimited tokens |
| Freeze authority active | +20 | Can freeze wallets |
| LP not burned | +25 | Liquidity can be pulled |
| LP mint authority active | +15 | Can mint more LP tokens |
| High holder concentration | +10 | Whales control supply |

**Risk Levels:**
- 🟢 0-24: LOW RISK
- 🟡 25-49: MEDIUM RISK
- 🔴 50-100: HIGH RISK

## XDEX API Integration

The tool fetches pool data from XDEX API:
- `GET /api/xendex/pool/list` - All pools
- `GET /api/xendex/pool/{address}` - Pool details
- `GET /api/token-price/price` - Token price
- `GET /api/token-price/lp-price` - LP token price

## Example Output

```
╔══════════════════════════════════════════════════════════╗
║          XDEX LP Burn Checker                            ║
╚══════════════════════════════════════════════════════════╝

Token: 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER

📋 Token Authority Check
──────────────────────────────────────────────────
Mint Authority: ✅ Revoked
Freeze Auth:    ✅ Revoked
Supply:         499.98M

🔍 Fetching XDEX pools...
✅ Found 5 pool(s)

Pool 1/5: WXNT / AGI
Pool Address: 4sn8oCQWPikDxBkyRdd1S6bJ24oYjGF16aR7ZqCSXy4v
TVL (USD):    $1.51K
LP Mint:      9GYcTvLdC281FAJEQfvTZ15uGHY5ioGUbsY2iCxJqseV
LP Supply:    200.00K
LP Burned:    ❌ No

═══════════════════════════════════════════════════════
                    RISK SUMMARY
═══════════════════════════════════════════════════════
✅ Mint authority revoked
✅ Freeze authority revoked
Risk Score: 0/100
Risk Level: 🟢 LOW
```

## Known Burn Addresses

- `1nc1nerator11111111111111111111111111111111` (primary incinerator)
- `11111111111111111111111111111111`
- `1111111111111111111111111111111111111111111`

## Network Support

- ✅ X1 Mainnet (default)
- ✅ X1 Testnet (via `X1_RPC_URL` env var)
- ✅ Solana Mainnet (via custom RPC)

## Telegram Bot

Run token audits directly from Telegram!

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Set the environment variable:
   ```bash
   export TELEGRAM_BOT_TOKEN=<your-token>
   ```

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` or `/help` | Show help | `/help` |
| `/audit <TOKEN>` | Full token audit | `/audit 7SXm...` |
| `/lp <TOKEN>` | Check LP burn | `/lp y1KE...` |
| `/watch <TOKEN>` | Add to watchlist | `/watch 7SXm...` |
| `/watch list` | Show watchlist | `/watch list` |
| `/stats` | Show audit stats | `/stats` |

### Example Chat

```
You: /audit 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER
Bot: 🔍 Auditing 7SXm...DnNC...
Bot: [Full audit results with risk score]
```

### Run

```bash
# Polling mode (default)
node telegram-bot.js

# With custom port
PORT=3000 node telegram-bot.js
```

## GitHub Repository

https://github.com/Lokoweb3/x1-token-audit

## Version

2.2.0 (includes v2.1 BurnChecked detection + v2.2 enhanced visuals + Telegram bot)
