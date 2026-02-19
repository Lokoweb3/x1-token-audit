# X1 Token Audit

X1 blockchain token safety analyzer with XDEX API integration.

## What It Does

- 🔍 **Mint Authority Check** — Can new tokens be minted?
- ❄️ **Freeze Authority Check** — Can wallets be frozen?
- 🏊 **XDEX Pool Discovery** — Find all liquidity pools
- 🔥 **LP Burn Detection** — Check if LP tokens were burned
- ⚖️ **Risk Scoring** — 0-100 scale with clear categories

## Quick Start

```bash
# Install dependencies
npm install @solana/web3.js

# Run audit
node check-xdex-lp-burn.js <TOKEN_MINT>

# Example
node check-xdex-lp-burn.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER
```

## Available Scripts

| Script | Purpose |
|--------|---------|
| `check-xdex-lp-burn.js` | Full audit with XDEX pools (recommended) |
| `x1-token-audit.js` | Legacy comprehensive audit |
| `check-lp-by-mint.js` | Check specific LP mint |
| `x1-lp-audit.js` | Find pools for token |
| `check-lp-detailed.js` | Detailed LP analysis |
| `check-burn-txs.js` | Burn transaction history |
| `decode-tx.js` | Decode and analyze any transaction |
| `telegram-bot.js` | Run audio audits from Telegram |

## Environment Variables

```bash
export X1_RPC_URL=https://rpc.mainnet.x1.xyz
export TELEGRAM_BOT_TOKEN=<your-token>  # Optional
```

## Risk Scoring

| Score | Level | Meaning |
|-------|-------|---------|
| 0-24 | 🟢 LOW | Token is relatively safe |
| 25-49 | 🟡 MEDIUM | Some concerns |
| 50-100 | 🔴 HIGH | High risk |

## Telegram Bot

Run token audits from Telegram!

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN` environment variable
3. Run: `node telegram-bot.js`

### Commands
- `/start` or `/help` — Show help
- `/audit <TOKEN>` — Full token audit
- `/lp <TOKEN>` — Check LP burn
- `/watch <TOKEN>` — Add to watchlist
- `/watch list` — Show watchlist
- `/stats` — Show audit statistics

## Example Output

```
╔══════════════════════════════════════════════════════════╗
║          X1 Token Audit Report                           ║
╚══════════════════════════════════════════════════════════╝

Token: 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER
RPC:   https://rpc.mainnet.x1.xyz

📋 Token Authority Check
─────────────────────────────────────────────────
Mint Authority: ✅ Revoked
Freeze Auth:    ✅ Revoked
Supply:         499.98M
Decimals:       9

📋 XDEX Pool Discovery
─────────────────────────────────────────────────
✅ Found 5 pool(s)

Pool 1/5: WXNT / AGI
Pool Address: 4sn8oCQWPikDxBkyRdd1S6bJ24oYjGF16aR7ZqCSXy4v
LP Mint:      9GYcTvLdC281FAJEQfvTZ15uGHY5ioGUbsY2iCxJqseV
LP Burned:    ❌ No
LP Mint Auth: ✅ Revoked

═══════════════════════════════════════════════════════
                    RISK SUMMARY
═══════════════════════════════════════════════════════
✅ Mint authority revoked
✅ Freeze authority revoked
✅ LP tokens burned
Risk Score: 0/100
Risk Level: 🟢 LOW
```

## GitHub Repository

https://github.com/Lokoweb3/x1-token-audit

## Version

1.2.0 (includes Telegram bot)
