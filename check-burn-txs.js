const { Connection, PublicKey, SystemProgram } = require('@solana/web3.js');

// X1 Mainnet RPC
const RPC_URL = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';

// Known burn addresses
const BURN_ADDRESSES = [
  '11111111111111111111111111111111', // System program (tokens sent here are burned)
  '1nc1nerator11111111111111111111111111111111', // Common burn address
  'Burn111111111111111111111111111111111111111', // Another burn address
  'burn1111111111111111111111111111111111111111' // Lower case variant
];

const TARGET_ADDRESS = process.argv[2];

if (!TARGET_ADDRESS) {
  console.log('Usage: node check-burn-txs.js <ADDRESS>');
  console.log('Example: node check-burn-txs.js E7f7fr2hp2WNWNT8ADxbHEdSNKRvaw3CSZ3fMwb4bCFM');
  process.exit(1);
}

// Cache for token metadata to avoid duplicate fetches
const tokenCache = new Map();

async function getTokenMetadata(connection, mintAddress) {
  if (tokenCache.has(mintAddress)) {
    return tokenCache.get(mintAddress);
  }
  
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (accountInfo.value && accountInfo.value.data && accountInfo.value.data.parsed) {
      const info = accountInfo.value.data.parsed.info;
      const metadata = {
        address: mintAddress,
        decimals: info.decimals || 0,
        supply: info.supply || '0',
        isInitialized: info.isInitialized || false
      };
      
      // Try to get token metadata from Metaplex
      try {
        const metaplexMetadataPDA = PublicKey.findProgramAddressSync(
          [
            Buffer.from('metadata'),
            new PublicKey('MetaToken1111111111111111111111111111111').toBuffer(),
            mintPubkey.toBuffer()
          ],
          new PublicKey('MetaToken1111111111111111111111111111111')
        )[0];
        
        const metaAccount = await connection.getAccountInfo(metaplexMetadataPDA);
        if (metaAccount) {
          // Parse Metaplex metadata
          const data = metaAccount.data;
          let offset = 2 + 32 + 32; // Skip version, update auth, mint
          
          const nameLen = data.readUInt32LE(offset);
          offset += 4;
          metadata.name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\u0000/g, '');
          offset += nameLen;
          
          const symbolLen = data.readUInt32LE(offset);
          offset += 4;
          metadata.symbol = data.slice(offset, offset + symbolLen).toString('utf8').replace(/\u0000/g, '');
        }
      } catch (e) {
        // Metaplex metadata not available
      }
      
      tokenCache.set(mintAddress, metadata);
      return metadata;
    }
  } catch (e) {
    // Failed to fetch
  }
  
  return null;
}

// Detect if likely LP token based on metadata
function isLikelyLPToken(metadata) {
  if (!metadata) return false;
  
  const symbol = (metadata.symbol || '').toUpperCase();
  const name = (metadata.name || '').toUpperCase();
  
  return (
    symbol.includes('LP') ||
    symbol.includes('-LP') ||
    name.includes('LIQUIDITY') ||
    name.includes('POOL') ||
    name.includes('UNISWAP') ||
    name.includes('DEX') ||
    name.includes('V2') ||
    name.includes('V3')
  );
}

async function checkBurnTransactions() {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const targetPubkey = new PublicKey(TARGET_ADDRESS);
    
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          X1 Burn Transaction Checker                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Wallet: ${TARGET_ADDRESS}`);
    console.log(`RPC: ${RPC_URL}\n`);
    
    // Get signatures
    console.log('Fetching transaction signatures...');
    const signatures = await connection.getSignaturesForAddress(targetPubkey, { limit: 100 });
    
    if (signatures.length === 0) {
      console.log('No transactions found.\n');
      return;
    }
    
    console.log(`Found ${signatures.length} transactions. Analyzing for burns...\n`);
    
    let burnCount = 0;
    const burnDetails = [];
    
    for (const sigInfo of signatures) {
      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });
        
        if (!tx || !tx.meta) continue;
        
        const txDate = sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : 'Unknown';
        let isBurn = false;
        let burnType = '';
        let burnAmount = '';
        let burnDestination = '';
        let burnedMint = null;
        let tokenMetadata = null;
        
        // Check for burn patterns in instructions
        if (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) {
          for (const ix of tx.transaction.message.instructions) {
            if (!ix.parsed) continue;
            const info = ix.parsed.info;
            
            // Check for transfers to burn addresses
            if (info && info.destination) {
              if (BURN_ADDRESSES.includes(info.destination)) {
                isBurn = true;
                burnType = 'Transfer to Burn Address';
                burnAmount = info.amount || info.lamports || 'N/A';
                burnDestination = info.destination;
                burnedMint = info.mint || null;
              }
            }
            
            // Check for token burns (burn instruction)
            if (ix.parsed.type === 'burn') {
              isBurn = true;
              burnType = 'Token Burn';
              burnAmount = info.amount || 'N/A';
              burnedMint = info.mint || null;
            }
            
            // Check for token account closings
            if (ix.parsed.type === 'closeAccount') {
              isBurn = true;
              burnType = 'Account Close (Burn)';
              burnAmount = info.amount || 'N/A';
              burnedMint = info.mint || null;
            }
            
            // Check for account that was closed and SOL burned
            if (ix.parsed.type === 'closeAccount' && info.destination === '11111111111111111111111111111111') {
              isBurn = true;
              burnType = 'Token Account Closed (SOL burned)';
              burnAmount = info.amount || 'Account SOL';
            }
          }
        }
        
        // Check token balances for mint info
        if (!burnedMint && tx.meta.preTokenBalances) {
          for (const pre of tx.meta.preTokenBalances) {
            // Check if this account's balance went to zero
            const post = tx.meta.postTokenBalances?.find(
              p => p.accountIndex === pre.accountIndex && p.mint === pre.mint
            );
            
            if ((!post || parseFloat(post.uiTokenAmount.uiAmount || 0) === 0) &&
                parseFloat(pre.uiTokenAmount.uiAmount || 0) > 0) {
              burnedMint = pre.mint;
              if (!burnType) {
                isBurn = true;
                burnType = 'Token Balance Zeroed (Possible Burn)';
                burnAmount = pre.uiTokenAmount.uiAmount.toString();
              }
            }
          }
        }
        
        // Fetch token metadata if we have a mint
        if (burnedMint) {
          tokenMetadata = await getTokenMetadata(connection, burnedMint);
        }
        
        if (isBurn) {
          burnCount++;
          burnDetails.push({
            signature: sigInfo.signature,
            date: txDate,
            type: burnType,
            amount: burnAmount,
            destination: burnDestination,
            mint: burnedMint,
            metadata: tokenMetadata
          });
        }
        
      } catch (e) {
        // Skip failed transaction lookups
      }
    }
    
    // Display results
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (burnCount === 0) {
      console.log('❌ No burn transactions detected in recent history.\n');
      console.log('Note: This could mean:');
      console.log('  - LP tokens were never minted here');
      console.log('  - LP tokens were transferred elsewhere (not burned)');
      console.log('  - Burn transactions are beyond the 100 transaction limit');
    } else {
      console.log(`✅ Found ${burnCount} burn transaction(s)!\n`);
      
      // Calculate total per token
      const tokenTotals = {};
      
      for (const burn of burnDetails) {
        console.log('─'.repeat(60));
        console.log(`Transaction: ${burn.signature}`);
        console.log(`Date:        ${burn.date}`);
        console.log(`Type:        ${burn.type}`);
        
        if (burn.mint && burn.metadata) {
          const symbol = burn.metadata.symbol || 'Unknown';
          const name = burn.metadata.name || 'Unknown';
          const isLP = isLikelyLPToken(burn.metadata);
          
          console.log(`Token:       ${name} (${symbol})`);
          console.log(`Mint:        ${burn.mint}`);
          console.log(`Likely LP:   ${isLP ? '✅ YES' : '❌ No'}`);
          console.log(`Amount:      ${burn.amount} ${symbol}`);
          
          // Track totals
          const key = `${symbol}|${burn.mint}`;
          if (!tokenTotals[key]) {
            tokenTotals[key] = { name, symbol, mint: burn.mint, amount: 0, isLP };
          }
          const amt = parseFloat(burn.amount) || 0;
          tokenTotals[key].amount += amt;
          
        } else if (burn.mint) {
          console.log(`Mint:        ${burn.mint}`);
          console.log(`Amount:      ${burn.amount}`);
        } else {
          console.log(`Amount:      ${burn.amount}`);
        }
        
        if (burn.destination) {
          console.log(`Destination: ${burn.destination}`);
        }
        
        console.log(`Explorer:    https://explorer.mainnet.x1.xyz/tx/${burn.signature}`);
        console.log('');
      }
      
      // Summary by token
      console.log('══════════════════════════════════════════════════════════=');
      console.log('                     BURN SUMMARY BY TOKEN                  ');
      console.log('══════════════════════════════════════════════════════════=\n');
      
      let grandTotalLP = 0;
      let lpTokenCount = 0;
      
      for (const [key, data] of Object.entries(tokenTotals)) {
        const lpBadge = data.isLP ? ' [LP TOKEN]' : '';
        console.log(`${data.name} (${data.symbol})${lpBadge}`);
        console.log(`  Mint:   ${data.mint}`);
        console.log(`  Total:  ${data.amount.toLocaleString()} ${data.symbol}`);
        console.log('');
        
        if (data.isLP) {
          grandTotalLP += data.amount;
          lpTokenCount++;
        }
      }
      
      if (lpTokenCount > 0) {
        console.log('─'.repeat(50));
        console.log(`🔥 LP TOKENS BURNED: ${grandTotalLP.toLocaleString()} total`);
        console.log(`   Tokens: ${lpTokenCount} different LP tokens`);
        console.log('─'.repeat(50));
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
    console.log('Known Burn Addresses Checked:');
    BURN_ADDRESSES.forEach(addr => console.log(`  ${addr}`));
    
    // Cache statistics
    if (tokenCache.size > 0) {
      console.log(`\nToken metadata fetched: ${tokenCache.size} unique mint(s)`);
    }
    
    console.log('\n🔍 For complete verification, check the explorer:');
    console.log(`https://explorer.mainnet.x1.xyz/address/${TARGET_ADDRESS}`);
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkBurnTransactions();
