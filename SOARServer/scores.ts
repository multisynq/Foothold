import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { SoarProgram } from '@magicblock-labs/soar-sdk';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import BN from 'bn.js';

dotenv.config();

const connection = new Connection(process.env.CONNECTION_URL!, 'confirmed');
const defaultPayer = Keypair.fromSecretKey(bs58.decode(process.env.DEFAULT_PAYER_SECRET_KEY!));
const authority = Keypair.fromSecretKey(bs58.decode(process.env.AUTH_WALLET_SECRET_KEY!)); // Authority keypair

if (!process.env.TEST_PLAYER_PRIV_KEY) {
  throw new Error('PLAYER_PUBLIC_KEY is not defined in the environment variables');
}
const player = Keypair.fromSecretKey(bs58.decode(process.env.TEST_PLAYER_PRIV_KEY!)); // Public key of the player

const client = SoarProgram.getFromConnection(connection, defaultPayer.publicKey);

(async () => {
  const leaderboardAccount = await client.fetchLeaderBoardAccount(new PublicKey(process.env.LEADERBOARD_PDA_PUBLIC_KEY!));
  console.log('Leaderboard account:', leaderboardAccount);

  // Step 1: Initialize the player account if not already initialized
  try {
    console.log('Initializing player account:', player.publicKey);
    const { transaction: initPlayerTransaction } = await client.initializePlayerAccount(player.publicKey, "PlayerUsername", PublicKey.default);
    console.log('Player account initialization transaction:', initPlayerTransaction);
    initPlayerTransaction.feePayer = defaultPayer.publicKey;
    console.log('Fee payer:', defaultPayer.publicKey.toBase58());
    initPlayerTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    console.log('Recent blockhash:', (await connection.getRecentBlockhash()).blockhash);
    const signedTransaction = await sendAndConfirmTransaction(connection, initPlayerTransaction, [defaultPayer, player]);
    console.log('Player account initialization transaction ID:', signedTransaction);
  } catch (error) {
    console.log('Player account already initialized or error initializing:', error.message);
  }

  // Step 2: Register the player entry for the leaderboard if not already registered
  try {
    const { transaction: registerPlayerTransaction } = await client.registerPlayerEntryForLeaderBoard(player.publicKey, leaderboardAccount.address);
    registerPlayerTransaction.feePayer = defaultPayer.publicKey;
    registerPlayerTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    const signedTransaction = await sendAndConfirmTransaction(connection, registerPlayerTransaction, [defaultPayer, player]);
    console.log('Player entry registration transaction ID:', signedTransaction);
  } catch (error) {
    console.log('Player entry already registered or error registering:', error.message);
  }

  // Step 3: Submitting a test score
  const score = new BN(100); // Example score
  const { transaction: submitScoreTransaction } = await client.submitScoreToLeaderBoard(player.publicKey, authority.publicKey, leaderboardAccount.address, score);

  // Sign and send the transaction
  submitScoreTransaction.feePayer = defaultPayer.publicKey;
  submitScoreTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  const signedTransaction = await sendAndConfirmTransaction(connection, submitScoreTransaction, [defaultPayer, authority]);
  console.log('Score submission transaction ID:', signedTransaction);

  // Fetch the updated leaderboard
  const topEntriesAccount = await client.fetchLeaderBoardTopEntriesAccount(leaderboardAccount.topEntries);
  console.log('Top Entries account:', topEntriesAccount);

  topEntriesAccount.topScores.forEach((score, index) => {
    const player = score.player.toBase58();
    const playerScore = score.entry.score.toString();
    const timestamp = score.entry.timestamp.toNumber();

    if (player === '11111111111111111111111111111111' || playerScore === '18446744073709551615' || timestamp === 0) {
      console.log(`Score ${index + 1}: Default/Uninitialized Entry`);
    } else {
      console.log(`Score ${index + 1}:`);
      console.log(`  Player: ${player}`);
      console.log(`  Score: ${playerScore}`);
      console.log(`  Timestamp: ${new Date(timestamp * 1000).toLocaleString()}`);
    }
  });
})();
