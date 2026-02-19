# Examples

## Basic Usage

```bash
# Simple token audit
node check-xdex-lp-burn.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER

# Token audit with custom RPC
node check-xdex-lp-burn.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER --rpc https://rpc.testnet.x1.xyz

# Decode a specific transaction
node decode-tx.js 5xGqvK7p...vK7p

# Decode with custom RPC
node decode-tx.js 5xGqvK7p...vK7p --rpc https://rpc.testnet.x1.xyz
```

## Workflow: Find & Analyze LP Burn

```bash
# Step 1: Check if LP is burned
node check-xdex-lp-burn.js <TOKEN_MINT>

# Step 2: If LP burned, find the burn transaction in output
# Step 3: Decode the burn transaction in detail
node decode-tx.js <TX_HASH_FROM_STEP_2>
```

## Workflow: Debug Failed Transaction

```bash
# Step 1: Decode failed transaction
node decode-tx.js 5xGqvK7p...vK7p

# Step 2: Look for error in "Status" line
# Step 3: Review log messages for more details
```

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `https://rpc.mainnet.x1.xyz` | Get transaction details |
| `https://api.xdex.xyz/api/xendex/pool/list` | Get all pools |
| `https://api.xdex.xyz/api/xendex/pool/{address}` | Get pool details |

## Integration in Scripts

```javascript
// In your x1-token-audit script, you can call decode-tx.js
const { execSync } = require('child_process');

const txHash = '5xGqvK7p...vK7p';
const output = execSync(`node decode-tx.js ${txHash} --rpc https://rpc.mainnet.x1.xyz`, { encoding: 'utf8' });
console.log(output);
```

## Output Format

### Transaction Decoder (decode-tx.js)
```
╔══════════════════════════════════════════════════════════╗
║           X1 Transaction Decoder                         ║
╚══════════════════════════════════════════════════════════╝

Transaction: 5xGqvK7p...vK7p
RPC:         https://rpc.mainnet.x1.xyz

Date/Time:   2026-02-18 14:30:22 UTC
Slot:        123456789
Status:      ✅ Success
Fee:         0.000005 XN

═══════════════════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════════════════

1. Program: SPL Token (Tokn...)

   Type: transfer
   From:  7SXm...DnNC
   To:    1nc1...7bDnNC
   Amount: 1000.00
   Mint:  y1KE...DnNC

═══════════════════════════════════════════════════════════
TOKEN BALANCE CHANGES
═══════════════════════════════════════════════════════════

  Token: y1KE...DnNC
  Owner: 7SXm...DnNC
  Change: 📉 -1000.00 (5000.00 → 4000.00)

═══════════════════════════════════════════════════════════
LOG MESSAGES (first 10)
═══════════════════════════════════════════════════════════

  Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
  Success

🔗 Explorer: https://explorer.mainnet.x1.xyz/tx/5xGqvK7p...vK7p
═══════════════════════════════════════════════════════════
```

### X1 Token Audit (check-xdex-lp-burn.js)
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

═══════════════════════════════════════════════════════
                    RISK SUMMARY
═══════════════════════════════════════════════════════
✅ Mint authority revoked
✅ Freeze authority revoked
✅ LP tokens burned
Risk Score: 0/100
Risk Level: 🟢 LOW
```
