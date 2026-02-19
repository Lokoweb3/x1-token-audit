# X1 Token Audit

X1 blockchain token safety analyzer with XDEX API integration.

## What It Does

- 🔍 **Mint Authority Check** — Can new tokens be minted?
- ❄️ **Freeze Authority Check** — Can wallets be frozen?
- 🏊 **XDEX Pool Discovery** — Find all liquidity pools
- 🔥 **LP Burn Detection** — Check if LP tokens were burned (v2.0+)
- 🔥 **BurnChecked Detection** — Find permanently destroyed tokens via on-chain burns (v2.1+)
- ⚖️ **Risk Scoring** — 0-100 scale with clear categories

## Quick Start

```bash
# Install dependencies
npm install @solana/web3.js

# Run audit (recommended)
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
| `telegram-bot.js` | Telegram bot for audits (see [README_TG.md](README_TG.md)) |

## v2.1 Features - BurnChecked Detection

The v2.1 update adds **BurnChecked transaction detection** - a more secure form of LP burning that permanently removes tokens from supply.

### What is BurnChecked?

BurnChecked transactions use Solana's token burn instruction, which:
- Permanently destroys tokens (removes from total supply)
- Is irreversible (unlike sending to burn addresses)
- Is verified on-chain as a legitimate burn instruction

### Example Output

```
Pool 1/5: WXNT / AGI
  🔥 Found 2 BurnChecked transactions!
    BURN #1:
      Amount:      200.00K LP tokens
      Method:      BurnChecked ✅ (permanent destruction)
      Date:        2026-02-17
      Authority:   8QXh51...BjggHX
      
    BURN #2:
      Amount:      1.00 LP tokens
      Method:      BurnChecked ✅ (permanent destruction)
      Date:        2026-02-17
      Authority:   8QXh51...BjggHX

  📊 Destroyed: 200.00K LP (48.1%)
```

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

## Telegram Bot Reference

See [README_TG.md](README_TG.md) for complete Telegram bot documentation and command reference.

## GitHub Repository

https://github.com/Lokoweb3/x1-token-audit

## Version

2.2.0 (includes v2.1 BurnChecked detection + v2.2 enhanced visuals)
