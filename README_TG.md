# X1 Token Audit Engine v2.2

Run token audits and LP burn checks from **Telegram** or command line.

## Telegram Bot (Recommended)

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Get your bot token (looks like `123456:ABC-DEF1234...`)
3. Run the bot:

```bash
# Set environment variable
export TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234...

# Start the bot
node telegram-bot.js
```

### Commands

| Command | Description |
|---------|-------------|
| `/start` / `/help` | Show help |
| `/audit <TOKEN>` | Full token audit with risk score |
| `/lp <TOKEN>` | Check LP burn status |
| `/watch <TOKEN>` | Add to watchlist |
| `/watch list` | Show watchlist |
| `/stats` | Show audit statistics |

### Example

```
User: /audit 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER
Bot: [Full audit report with risk score and BurnChecked detection]
```

---

## Command Line

### Installation

```bash
git clone https://github.com/Lokoweb3/x1-token-audit.git
cd x1-token-audit
npm install @solana/web3.js
```

### Usage

```bash
# Full audit (recommended)
node check-xdex-lp-burn.js <TOKEN_MINT>

# Examples
node check-xdex-lp-burn.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER
node check-xdex-lp-burn.js y1KEaaWVoEfX2gH7X1Vougmc9yD1Bi2c9VHeD7bDnNC

# Check specific LP mint
node check-lp-by-mint.js <LP_MINT>

# Detailed LP analysis
node check-lp-detailed.js <TOKEN_MINT>
```

---

## Available Scripts

| Script | Purpose |
|--------|---------|
| `check-xdex-lp-burn.js` | Full audit with XDEX pools (recommended) |
| `check-lp-by-mint.js` | Check specific LP mint |
| `check-lp-detailed.js` | Detailed LP analysis |
| `check-burn-txs.js` | Burn transaction history |
| `decode-tx.js` | Decode transactions |
| `telegram-bot.js` | Telegram bot for audits |

---

## v2.1+ Features

### BurnChecked Detection 🔥

Permanently destroyed tokens via on-chain burn instruction (stronger security signal than burn addresses).

---

## Environment Variables

```bash
export X1_RPC_URL=https://rpc.mainnet.x1.xyz
export TELEGRAM_BOT_TOKEN=<your-token>  # For Telegram bot
export PORT=8080                         # For Telegram bot (optional)
```
