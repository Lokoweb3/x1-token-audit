const { Connection, PublicKey, SystemProgram } = require('@solana/web3.js');

// X1 Mainnet RPC
const RPC_URL = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';

// The address to check (passed as argument or default)
const TARGET_ADDRESS = process.argv[2];

if (!TARGET_ADDRESS) {
  console.log('Usage: node check-lp-burn.js <ADDRESS>');
  console.log('Example: node check-lp-burn.js 7SXmUpcBGSAwW5LmtzQVF9jHswZ7xzmdKqWa4nDgL3ERe');
  process.exit(1);
}

// Validate the address
let targetPubkey;
try {
  targetPubkey = new PublicKey(TARGET_ADDRESS);
} catch (e) {
  console.error('❌ ERROR: Invalid Solana/X1 address');
  console.error('Address:', TARGET_ADDRESS);
  console.error('Length:', TARGET_ADDRESS.length, 'characters');
  console.error('\nMake sure the address is a valid base58-encoded public key (usually 32-44 characters)');
  process.exit(1);
}

async function checkLPBurns() {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const burnAddress = SystemProgram.programId;

    console.log('========================================');
    console.log('X1 LP Burn Checker');
    console.log('========================================');
    console.log(`Target Address: ${TARGET_ADDRESS}`);
    console.log(`Burn Address: ${burnAddress.toBase58()}`);
    console.log(`RPC Endpoint: ${RPC_URL}\n`);

    // Check if target address exists
    const accountInfo = await connection.getAccountInfo(targetPubkey);
    if (!accountInfo) {
      console.log('❌ Target account not found on chain');
      console.log('The address may be invalid or has no transaction history yet.\n');
      return;
    }

    console.log('✓ Account exists');
    console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
    console.log(`  Balance: ${accountInfo.lamports / 1e9} XN\n`);

    // Get recent transaction signatures
    console.log('Fetching recent transactions...');
    const signatures = await connection.getSignaturesForAddress(targetPubkey, { limit: 100 });
    
    if (signatures.length === 0) {
      console.log('No transactions found for this address\n');
    } else {
      console.log(`Found ${signatures.length} transactions\n`);
      console.log('View on explorer:', `https://explorer.mainnet.x1.xyz/address/${TARGET_ADDRESS}`);
    }

    // Check for token accounts
    console.log('\nChecking token accounts...');
    
    let tokenCount = 0;
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        targetPubkey, 
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );
      tokenCount += tokenAccounts.value.length;
    } catch (e) { }

    try {
      const token2022Accounts = await connection.getParsedTokenAccountsByOwner(
        targetPubkey,
        { programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFvuU7GWf5cD4T8z8Q') }
      );
      tokenCount += token2022Accounts.value.length;
    } catch (e) { }

    console.log(`Found ${tokenCount} token account(s)\n`);

    // Summary with manual verification steps
    console.log('========================================');
    console.log('How to check for LP burns manually:');
    console.log('========================================');
    console.log(`1. Open X1 Explorer: https://explorer.mainnet.x1.xyz/address/${TARGET_ADDRESS}`);
    console.log(`2. Check the "Transactions" tab for token transfers`);
    console.log(`3. Look for transfers to burn address: ${burnAddress.toBase58()}`);
    console.log('4. LP tokens typically:');
    console.log('   - Have "LP" in the token name/symbol');
    console.log('   - Are sent to the system program (burn) address');
    console.log('   - Show "Burn" or "CloseAccount" in transaction details');
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkLPBurns();
