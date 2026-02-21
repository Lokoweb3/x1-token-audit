#!/bin/bash
# Fix burn detection in check-xdex-lp-burn.js
# Replaces lines 470-510 with improved LP mint scanning + closeAccount detection

FILE="/root/.openclaw/workspace/skills/x1-token-audit/check-xdex-lp-burn.js"

# Find the line numbers
START=$(grep -n "// Count BurnChecked transactions - search by token mint" "$FILE" | head -1 | cut -d: -f1)
END=$(grep -n "// Calculate total burn from BurnChecked" "$FILE" | head -1 | cut -d: -f1)

if [ -z "$START" ] || [ -z "$END" ]; then
  echo "❌ Could not find the section to replace"
  exit 1
fi

echo "Replacing lines $START to $((END-1))"

# Create the new section
cat > /tmp/new-burn-section.js << 'NEWCODE'
  // Count burn transactions - search each LP mint directly
  const burnCheckedTxs = [];
  const lpMints = pools.map(p => p.pool_info?.lpMint).filter(Boolean);
  const uniqueLpMints = [...new Set(lpMints)];

  for (const lpMint of uniqueLpMints) {
    try {
      const lpMintPubkey = new PublicKey(lpMint);
      const lpSignatures = await connection.getSignaturesForAddress(lpMintPubkey, { limit: 100 });

      for (const sigInfo of lpSignatures) {
        try {
          const tx = await connection.getParsedTransaction(sigInfo.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          if (!tx || !tx.transaction?.message?.instructions) continue;

          // Method 1: burnChecked / burn instructions
          for (const ix of tx.transaction.message.instructions) {
            if (!ix.parsed) continue;
            if (ix.parsed.type === "burnChecked" || ix.parsed.type === "burn") {
              const info = ix.parsed.info;
              const decimals = info.tokenAmount?.decimals || 9;
              const amount =
                info.tokenAmount?.uiAmount ||
                parseFloat(info.amount || 0) / Math.pow(10, decimals);
              burnCheckedTxs.push({
                signature: sigInfo.signature,
                date: sigInfo.blockTime
                  ? new Date(sigInfo.blockTime * 1000).toISOString()
                  : "Unknown",
                type: ix.parsed.type,
                amount: amount,
                authority: info.authority || "Unknown",
                mint: info.mint || lpMint,
              });
            }
          }

          // Method 2: closeAccount burn pattern (balance zeroed + account closed)
          if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
            for (const pre of tx.meta.preTokenBalances) {
              if (pre.mint !== lpMint) continue;
              const preAmount = parseFloat(pre.uiTokenAmount?.uiAmountString || "0");
              if (preAmount <= 0) continue;

              const post = tx.meta.postTokenBalances.find(
                p => p.accountIndex === pre.accountIndex && p.mint === lpMint
              );
              const postAmount = post ? parseFloat(post.uiTokenAmount?.uiAmountString || "0") : 0;

              if (postAmount === 0 && preAmount > 0) {
                const hasClose = tx.transaction.message.instructions.some(
                  ix => ix.parsed && (ix.parsed.type === "closeAccount" || ix.parsed.type === "closeChecked")
                );
                if (hasClose && !burnCheckedTxs.find(b => b.signature === sigInfo.signature)) {
                  burnCheckedTxs.push({
                    signature: sigInfo.signature,
                    date: sigInfo.blockTime
                      ? new Date(sigInfo.blockTime * 1000).toISOString()
                      : "Unknown",
                    type: "closeAccount (burn)",
                    amount: preAmount,
                    authority: "closeAccount",
                    mint: lpMint,
                  });
                }
              }
            }
          }
        } catch {
          // Skip individual tx errors
        }
      }
    } catch (err) {
      console.error(`  ⚠️ Error scanning LP mint ${lpMint.slice(0,8)}...: ${err.message}`);
    }
  }

NEWCODE

# Build the new file
head -n $((START-1)) "$FILE" > /tmp/patched.js
cat /tmp/new-burn-section.js >> /tmp/patched.js
tail -n +$END "$FILE" >> /tmp/patched.js

# Replace
cp /tmp/patched.js "$FILE"
echo "✅ Burn detection patched successfully"
echo "Lines replaced: $START to $((END-1))"
