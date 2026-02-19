const { Connection, PublicKey, SystemProgram } = require('@solana/web3.js');

// X1 Mainnet RPC
const RPC_URL = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';

// Token program IDs (as strings first, converted to PublicKey later)
const TOKEN_PROGRAM_ID_STR = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID_STR = 'TokenzQdBNbLqP5VEhdkAS6EPFvuU7GWf5cD4T8z8Q';

// Burn address
const BURN_ADDRESS = '11111111111111111111111111111111';

// Validate base58 string
function isValidBase58(str) {
  try {
    // Try to create PublicKey to validate
    new PublicKey(str);
    return true;
  } catch {
    return false;
  }
}

// Check if token is likely an LP token
function isLikelyLPToken(mintInfo, balance) {
  if (!mintInfo) return false;
  
  // LP tokens often have specific characteristics
  const symbol = (mintInfo.symbol || '').toUpperCase();
  const name = (mintInfo.name || '').toUpperCase();
  
  // Check for LP indicators
  const isLPIndicator = 
    symbol.includes('LP') ||
    symbol.includes('-LP') ||
    name.includes('LIQUIDITY') ||
    name.includes('POOL') ||
    name.includes('UNISWAP') ||
    name.includes('DEX') ||
    name.includes('V2') ||
    name.includes('V3');
  
  // LP tokens usually have 6-9 decimals and reasonable supply
  const decimals = mintInfo.decimals || 0;
  const hasReasonableDecimals = decimals >= 6 && decimals <= 9;
  
  return isLPIndicator && hasReasonableDecimals;
}

async function checkLPTokens(address) {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          X1 LP Token Checker                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const walletKey = new PublicKey(address);
    
    console.log(`Wallet Address: ${address}`);
    console.log(`RPC Endpoint:   ${RPC_URL}\n`);
    
    // Check account
    const accountInfo = await connection.getAccountInfo(walletKey);
    if (!accountInfo) {
      console.log('❌ Account not found on chain\n');
      return;
    }
    
    console.log(`✓ Account exists`);
    console.log(`  Balance: ${accountInfo.lamports / 1e9} XN\n`);
    
    // Get all token accounts
    console.log('Fetching token accounts...\n');
    
    const allTokenAccounts = [];
    const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ID_STR);
    let TOKEN_2022_PROGRAM_ID;
    try {
      TOKEN_2022_PROGRAM_ID = new PublicKey(TOKEN_2022_PROGRAM_ID_STR);
    } catch (e) {
      TOKEN_2022_PROGRAM_ID = null;
    }
    
    // Check Token Program accounts
    try {
      const tokenResponse = await connection.getParsedTokenAccountsByOwner(
        walletKey,
        { programId: TOKEN_PROGRAM_ID },
        'confirmed'
      );
      
      for (const account of tokenResponse.value) {
        allTokenAccounts.push({
          address: account.pubkey.toBase58(),
          program: 'Token Program',
          data: account.account.data.parsed
        });
      }
    } catch (e) {
      // No token accounts
    }
    
    // Check Token-2022 Program accounts (if available)
    if (TOKEN_2022_PROGRAM_ID) {
      try {
        const token2022Response = await connection.getParsedTokenAccountsByOwner(
          walletKey,
          { programId: TOKEN_2022_PROGRAM_ID },
          'confirmed'
        );
        
        for (const account of token2022Response.value) {
          allTokenAccounts.push({
            address: account.pubkey.toBase58(),
            program: 'Token-2022 Program',
            data: account.account.data.parsed
          });
        }
      } catch (e) {
        // No token-2022 accounts
      }
    }
    
    if (allTokenAccounts.length === 0) {
      console.log('❌ No token accounts found for this wallet\n');
      return;
    }
    
    console.log(`Found ${allTokenAccounts.length} token account(s)\n`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Analyze each token account
    let lpTokenCount = 0;
    let totalLPTokenBalance = 0;
    const lpTokens = [];
    
    for (const tokenAccount of allTokenAccounts) {
      const info = tokenAccount.data.info;
      const mint = info.mint;
      const balance = parseFloat(info.tokenAmount.uiAmount || 0);
      const decimals = info.tokenAmount.decimals;
      
      // Try to get mint info
      let mintInfo = null;
      try {
        const mintAccount = await connection.getParsedAccountInfo(new PublicKey(mint));
        if (mintAccount.value && mintAccount.value.data && mintAccount.value.data.parsed) {
          mintInfo = mintAccount.value.data.parsed.info;
        }
      } catch (e) {
        // Could not fetch mint info
      }
      
      const isLP = isLikelyLPToken(mintInfo, balance);
      
      // Display token info
      console.log(`Token Account: ${tokenAccount.address}`);
      console.log(`  Program:     ${tokenAccount.program}`);
      console.log(`  Mint:        ${mint}`);
      console.log(`  Balance:     ${balance.toLocaleString()} (${decimals} decimals)`);
      
      if (mintInfo) {
        console.log(`  Symbol:      ${mintInfo.symbol || 'Unknown'}`);
        console.log(`  Name:        ${mintInfo.name || 'Unknown'}`);
        
        if (mintInfo.supply) {
          const supply = mintInfo.supply / Math.pow(10, decimals);
          console.log(`  Supply:      ${supply.toLocaleString()}`);
        }
      }
      
      if (isLP) {
        console.log(`  Type:        🟢 LIKELY LP TOKEN`);
        lpTokenCount++;
        totalLPTokenBalance += balance;
        lpTokens.push({
          address: tokenAccount.address,
          mint: mint,
          balance: balance,
          symbol: mintInfo?.symbol || 'Unknown',
          name: mintInfo?.name || 'Unknown'
        });
      } else if (mintInfo && (mintInfo.symbol || '').includes('UNKNOWN')) {
        console.log(`  Type:        ⚠️  UNKNOWN (may be LP)`);
      } else {
        console.log(`  Type:        Regular Token`);
      }
      
      console.log('');
    }
    
    // Summary
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('SUMMARY');
    console.log(`Total Token Accounts: ${allTokenAccounts.length}`);
    console.log(`LP Tokens Found:      ${lpTokenCount}`);
    
    if (lpTokenCount > 0) {
      console.log(`Total LP Balance:     ${totalLPTokenBalance.toLocaleString()}\n`);
      
      console.log('LP Token Holdings:');
      for (const lp of lpTokens) {
        console.log(`  • ${lp.symbol} - ${lp.balance.toLocaleString()}`);
        console.log(`    Mint: ${lp.mint}`);
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
    
    // Check transactions for burns
    console.log('Checking recent transactions for burns...\n');
    
    try {
      const signatures = await connection.getSignaturesForAddress(walletKey, { limit: 50 });
      
      if (signatures.length > 0) {
        let burnTxCount = 0;
        
        for (const sig of signatures) {
          try {
            const tx = await connection.getParsedTransaction(sig.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            });
            
            if (!tx || !tx.meta) continue;
            
            // Check for burn instructions
            if (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) {
              for (const ix of tx.transaction.message.instructions) {
                // Check for transfer to burn address or close account
                if (ix.parsed && ix.parsed.info) {
                  const info = ix.parsed.info;
                  
                  // Transfer to system program (burn)
                  if (info.destination === BURN_ADDRESS) {
                    console.log(`🔥 Potential Burn Detected:`);
                    console.log(`  Tx: ${sig.signature}`);
                    console.log(`  Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'Unknown'}`);
                    console.log(`  Amount: ${info.amount || 'N/A'}`);
                    burnTxCount++;
                  }
                  
                  // Token account closure
                  if (ix.programId && (
                    ix.programId.toBase58() === TOKEN_PROGRAM_ID_STR ||
                    ix.programId.toBase58() === TOKEN_2022_PROGRAM_ID_STR
                  )) {
                    if (ix.parsed.type === 'closeAccount') {
                      console.log(`🚪 Token Account Closed:`);
                      console.log(`  Tx: ${sig.signature}`);
                      burnTxCount++;
                    }
                  }
                }
              }
            }
          } catch (e) {
            // Skip failed transaction lookups
          }
        }
        
        if (burnTxCount === 0) {
          console.log('No burn transactions found in recent history\n');
        }
      } else {
        console.log('No transaction history available\n');
      }
    } catch (e) {
      console.log(`Could not fetch transactions: ${e.message}\n`);
    }
    
    // Explorer links
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('QUICK LINKS:');
    console.log(`  Explorer: https://explorer.mainnet.x1.xyz/address/${address}`);
    console.log(`  Tokens:   https://explorer.mainnet.x1.xyz/address/${address}/tokens`);
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('Invalid public key')) {
      console.error('\nThe address you entered is not valid.');
      console.error('Solana/X1 addresses are base58-encoded and typically 32-44 characters long.');
    }
    process.exit(1);
  }
}

// Main execution
const address = process.argv[2];

if (!address) {
  console.log('Usage: node check-lp-token.js <WALLET_ADDRESS>');
  console.log('Example: node check-lp-token.py 73js7JXRu9SzfwWdUnE45KtZ7GzkD9tcUhVXrYD6dW7x');
  console.log('\nThis script checks for LP tokens and burn activity in an X1 wallet.');
  process.exit(1);
}

// Validate address
if (!isValidBase58(address)) {
  console.error('❌ ERROR: Invalid wallet address');
  console.error('Address:', address);
  console.error('Length:', address.length);
  console.error('\nPlease check that you have entered a valid Solana/X1 address.');
  process.exit(1);
}

checkLPTokens(address);
