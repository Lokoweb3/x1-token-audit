const { Connection, PublicKey } = require('@solana/web3.js');

// X1 Mainnet RPC
const RPC_URL = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';

// Token Program ID
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Known burn addresses
const BURN_ADDRESSES = [
  '11111111111111111111111111111111',
  '1nc1nerator11111111111111111111111111111111',
  'Burn111111111111111111111111111111111111111',
  'burn1111111111111111111111111111111111111111'
];

// Known AMM/DEX programs that create LP tokens
const KNOWN_AMM_PROGRAMS = {
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn6UaB': 'Meteora',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Lifinity',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpools',
};

const TARGET_ADDRESS = process.argv[2];

if (!TARGET_ADDRESS) {
  console.log('Usage: node check-lp-detailed.js <MINT_OR_WALLET_ADDRESS>');
  console.log('Example: node check-lp-detailed.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ER');
  process.exit(1);
}

// Validate address
function isValidAddress(addr) {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

// Parse raw mint account data
function parseMintData(data) {
  if (data.length < 82) return null;
  
  const result = {
    mintAuthorityOption: data.readUInt32LE(0),
    supplyRaw: BigInt(0),
    decimals: 0,
    isInitialized: false,
    freezeAuthorityOption: 0,
    mintAuthority: null,
    freezeAuthority: null,
    supply: 0
  };
  
  // Mint authority
  if (result.mintAuthorityOption === 1) {
    result.mintAuthority = new PublicKey(data.slice(4, 36)).toBase58();
  }
  
  // Supply (u64 little-endian)
  const supplyLow = BigInt(data.readUInt32LE(36));
  const supplyHigh = BigInt(data.readUInt32LE(40));
  result.supplyRaw = (supplyHigh << BigInt(32)) | supplyLow;
  
  // Decimals and initialization
  result.decimals = data.readUInt8(44);
  result.isInitialized = data.readUInt8(45) === 1;
  
  // Calculate UI supply
  result.supply = Number(result.supplyRaw) / Math.pow(10, result.decimals);
  
  // Freeze authority
  result.freezeAuthorityOption = data.readUInt32LE(46);
  if (result.freezeAuthorityOption === 1) {
    result.freezeAuthority = new PublicKey(data.slice(50, 82)).toBase58();
  }
  
  return result;
}

// Check if likely LP token based on characteristics
function isLikelyLPToken(metadata, mintData) {
  const symbol = (metadata?.symbol || '').toUpperCase();
  const name = (metadata?.name || '').toUpperCase();
  
  // Check naming patterns
  const hasLPIndicator = 
    symbol.includes('LP') ||
    symbol.includes('-LP') ||
    name.includes('LIQUIDITY') ||
    name.includes('POOL') ||
    symbol.includes('UNI-V2') ||
    symbol.includes('SLP') ||
    symbol.includes('CAMLPT') ||
    symbol.includes('RAY-LP');
  
  // LP tokens typically have specific characteristics
  const hasReasonableDecimals = mintData?.decimals >= 6 && mintData?.decimals <= 9;
  const hasReasonableSupply = mintData?.supply > 0 && mintData?.supply < 1e15;
  
  return hasLPIndicator || (hasReasonableDecimals && hasReasonableSupply);
}

async function analyzeToken(connection, targetPubkey) {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          X1 Token & LP Burn Analyzer                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Target: ${TARGET_ADDRESS}`);
  console.log(`RPC:    ${RPC_URL}\n`);
  
  // Step 1: Check if this is a mint account
  console.log('Step 1: Checking if target is a token mint...');
  let mintData = null;
  let isMint = false;
  
  try {
    const accountInfo = await connection.getAccountInfo(targetPubkey);
    
    if (!accountInfo) {
      console.log('  ❌ Account not found on chain\n');
      return;
    }
    
    console.log(`  ✓ Account exists`);
    console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
    console.log(`  Data size: ${accountInfo.data.length} bytes`);
    
    // Check if it's a token mint (owned by Token Program, 82 bytes)
    if (accountInfo.owner.equals(TOKEN_PROGRAM_ID) && accountInfo.data.length === 82) {
      mintData = parseMintData(accountInfo.data);
      if (mintData) {
        isMint = true;
        console.log(`  ✅ This IS a token mint!\n`);
      }
    } else {
      console.log(`  ℹ️ Not a token mint (may be a wallet or other account)\n`);
    }
  } catch (err) {
    console.log(`  ⚠️ Error: ${err.message}\n`);
  }
  
  // Step 2: If it's a mint, show details
  if (isMint && mintData) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('                    TOKEN MINT DETAILS                     ');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log(`Mint Address:     ${TARGET_ADDRESS}`);
    console.log(`Decimals:         ${mintData.decimals}`);
    console.log(`Current Supply:   ${mintData.supply.toLocaleString()}`);
    console.log(`Raw Supply:       ${mintData.supplyRaw.toString()}`);
    console.log(`Initialized:      ${mintData.isInitialized ? '✅ Yes' : '❌ No'}`);
    console.log(`Mint Authority:   ${mintData.mintAuthority || '❌ Revoked'}`);
    console.log(`Freeze Authority: ${mintData.freezeAuthority || '❌ Revoked'}`);
    console.log('');
    
    // Check LP indicators
    const lpIndicators = [];
    if (mintData.decimals >= 6 && mintData.decimals <= 9) lpIndicators.push('Reasonable decimals (6-9)');
    if (mintData.supply > 0 && mintData.supply < 1e12) lpIndicators.push('Reasonable supply');
    if (!mintData.mintAuthority) lpIndicators.push('Mint authority revoked (LP-like)');
    
    console.log('LP Token Indicators:');
    lpIndicators.forEach(ind => console.log(`  • ${ind}`));
    console.log('');
  }
  
  // Step 3: Find pool vaults (token accounts owned by AMMs)
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    POOL VAULT ANALYSIS                    ');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const poolsFound = [];
  try {
    console.log('Scanning for pool vaults...');
    const tokenAccounts = await connection.getParsedProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: TARGET_ADDRESS } }
        ]
      }
    );
    
    for (const { pubkey, account } of tokenAccounts) {
      const info = account.data.parsed?.info;
      if (!info) continue;
      
      const owner = info.owner;
      const ammName = KNOWN_AMM_PROGRAMS[owner];
      
      if (ammName) {
        poolsFound.push({
          vault: pubkey.toBase58(),
          amm: ammName,
          ammProgram: owner,
          amount: parseFloat(info.tokenAmount?.uiAmountString || '0')
        });
      }
    }
    
    if (poolsFound.length > 0) {
      console.log(`✅ Found ${poolsFound.length} pool vault(s):\n`);
      poolsFound.forEach((pool, i) => {
        console.log(`Pool ${i + 1}:`);
        console.log(`  AMM:    ${pool.amm}`);
        console.log(`  Vault:  ${pool.vault}`);
        console.log(`  Amount: ${pool.amount.toLocaleString()}`);
        console.log('');
      });
    } else {
      console.log('❌ No pool vaults found\n');
    }
  } catch (err) {
    console.log(`⚠️ Pool scan error: ${err.message}\n`);
  }
  
  // Step 4: Check burn addresses for holdings
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    BURN ADDRESS CHECK                     ');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const burnHoldings = [];
  for (const burnAddr of BURN_ADDRESSES) {
    if (!isValidAddress(burnAddr)) continue;
    
    try {
      const burnPubkey = new PublicKey(burnAddr);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        burnPubkey,
        { mint: targetPubkey }
      );
      
      for (const { pubkey, account } of tokenAccounts.value) {
        const info = account.data.parsed.info;
        const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
        
        if (amount > 0) {
          burnHoldings.push({
            burnAddress: burnAddr,
            tokenAccount: pubkey.toBase58(),
            amount,
            decimals: info.tokenAmount.decimals
          });
        }
      }
    } catch {
      // No holdings
    }
  }
  
  if (burnHoldings.length > 0) {
    console.log(`🔥 Found ${burnHoldings.length} burn address holding(s):\n`);
    burnHoldings.forEach(h => {
      console.log(`Burn Address: ${h.burnAddress}`);
      console.log(`Token Account: ${h.tokenAccount}`);
      console.log(`Amount: ${h.amount.toLocaleString()}`);
      console.log('');
    });
  } else {
    console.log('ℹ️ No tokens found at burn addresses\n');
  }
  
  // Step 5: Check transaction history for burns
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                 TRANSACTION BURN ANALYSIS                 ');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    console.log('Fetching transaction history...');
    const signatures = await connection.getSignaturesForAddress(targetPubkey, { limit: 100 });
    
    if (signatures.length === 0) {
      console.log('❌ No transactions found\n');
    } else {
      console.log(`Found ${signatures.length} transactions. Analyzing...\n`);
      
      let burnCount = 0;
      const burnTxs = [];
      
      for (const sigInfo of signatures) {
        try {
          const tx = await connection.getParsedTransaction(sigInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (!tx || !tx.meta) continue;
          
          let isBurn = false;
          let burnType = '';
          let burnAmount = '';
          
          // Check instructions for burns
          if (tx.transaction?.message?.instructions) {
            for (const ix of tx.transaction.message.instructions) {
              if (!ix.parsed) continue;
              
              if (ix.parsed.type === 'burn') {
                isBurn = true;
                burnType = 'Token Burn';
                burnAmount = ix.parsed.info?.amount || 'N/A';
              } else if (ix.parsed.type === 'closeAccount') {
                isBurn = true;
                burnType = 'Account Close';
              }
            }
          }
          
          // Check token balance changes
          if (tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
            for (const pre of tx.meta.preTokenBalances) {
              if (pre.mint !== TARGET_ADDRESS) continue;
              
              const post = tx.meta.postTokenBalances.find(
                p => p.accountIndex === pre.accountIndex && p.mint === pre.mint
              );
              
              const preAmt = parseFloat(pre.uiTokenAmount.uiAmount || 0);
              const postAmt = post ? parseFloat(post.uiTokenAmount.uiAmount || 0) : 0;
              
              if (postAmt === 0 && preAmt > 0) {
                isBurn = true;
                burnType = burnType || 'Balance Zeroed';
                burnAmount = preAmt.toString();
              }
            }
          }
          
          if (isBurn) {
            burnCount++;
            burnTxs.push({
              sig: sigInfo.signature,
              date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : 'Unknown',
              type: burnType,
              amount: burnAmount
            });
          }
        } catch {
          // Skip failed lookups
        }
      }
      
      if (burnCount > 0) {
        console.log(`✅ Found ${burnCount} burn transaction(s)!\n`);
        burnTxs.slice(0, 5).forEach((tx, i) => {
          console.log(`Burn ${i + 1}:`);
          console.log(`  Tx:     ${tx.sig.slice(0, 20)}...`);
          console.log(`  Date:   ${tx.date}`);
          console.log(`  Type:   ${tx.type}`);
          console.log(`  Amount: ${tx.amount}`);
          console.log('');
        });
        
        if (burnTxs.length > 5) {
          console.log(`... and ${burnTxs.length - 5} more\n`);
        }
      } else {
        console.log('❌ No burn transactions detected\n');
      }
    }
  } catch (err) {
    console.log(`⚠️ Error: ${err.message}\n`);
  }
  
  // Final summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                        SUMMARY                            ');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  if (isMint) {
    console.log(`Token Type:     ${poolsFound.length > 0 ? '✅ POOL TOKEN' : 'Standard Token'}`);
    console.log(`Pool Vaults:    ${poolsFound.length}`);
    console.log(`Burn Holdings:  ${burnHoldings.length}`);
    console.log(`Current Supply: ${mintData.supply.toLocaleString()}`);
    
    if (mintData.supply === 0) {
      console.log('\n🔥 TOKEN SUPPLY IS ZERO - Fully Burned!');
    } else if (mintData.supply < 1000) {
      console.log('\n⚠️ Very low supply remaining');
    }
  }
  
  console.log(`\nExplorer: https://explorer.mainnet.x1.xyz/address/${TARGET_ADDRESS}`);
}

// Main execution
async function main() {
  if (!isValidAddress(TARGET_ADDRESS)) {
    console.error('❌ Invalid address');
    process.exit(1);
  }
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const targetPubkey = new PublicKey(TARGET_ADDRESS);
  
  await analyzeToken(connection, targetPubkey);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
