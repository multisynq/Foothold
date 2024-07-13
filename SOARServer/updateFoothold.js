import { SoarProgram, GameType, Genre } from "@magicblock-labs/soar-sdk";
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import bs58 from 'bs58'; // Use * as bs58 to correctly import the module
import dotenv from 'dotenv';

dotenv.config();

// Load environment variables
const connectionUrl = process.env.CONNECTION_URL;
const defaultPayerSecretKey = process.env.DEFAULT_PAYER_SECRET_KEY;
const authWalletSecretKey = process.env.AUTH_WALLET_SECRET_KEY;
const leaderboardNftPublicKey = process.env.LEADERBOARD_NFT_PUBLIC_KEY;

// Initialize connection and keypairs
const connection = new Connection(connectionUrl, "confirmed");
const defaultPayer = Keypair.fromSecretKey(bs58.decode(defaultPayerSecretKey));
const authWallet = Keypair.fromSecretKey(bs58.decode(authWalletSecretKey));
const leaderboardNft = new PublicKey(leaderboardNftPublicKey);

// Initialize Soar client
const client = SoarProgram.getFromConnection(connection, defaultPayer);

// Define game details
const game = Keypair.generate();
const title = "Foothold";
const description = "Foothold is an instantly-joinable multiplayer game where you and your friends are defending your central spaceship from increasingly large waves of Guardian bots. If the bots reach your ship, they detonate - use your tank's rebound rounds to eliminate the threat to your evil invasion!";
const genre = Genre.Action;
const gameType = GameType.Web;
const nftMeta = Keypair.generate().publicKey;
const auths = [/* array of Keypair objects */];  // Populate with actual keypairs
const _auths = auths.map((keypair) => keypair.publicKey);

async function createGame() {
  // Create the game on-chain
  const { newGame, transaction } = await client.initializeNewGame(
    game.publicKey,
    title,
    description,
    genre,
    gameType,
    nftMeta,
    _auths
  );

  // Send and confirm the transaction
  await web3.sendAndConfirmTransaction(connection, transaction, [game]);

  console.log('Game created:', newGame.toString());

  return newGame;
}

async function createLeaderboard(newGame) {
  // Create the leaderboard on-chain
  const transactionIx = await client.updateGameLeaderBoard(
    newGame,
    authWallet.publicKey,
    "Foothold Leaderboard",
    leaderboardNft,
    100, // maximum entries
    false // isAscending
  );

  await web3.sendAndConfirmTransaction(connection, transactionIx.transaction, [authWallet]);

  console.log('Leaderboard created');
}
async function updateLeaderboard() {
    const leaderboardPublicKey = new PublicKey("H5T3xgV7KxyY7cLuJpHj4GNycdCGrHEWsZf5MirgLiUn");

    const newIsAscending = true; // Change this to the desired value
    const newAllowMultipleScores = true; // Change this to the desired value
    const newDescription = "Foothold Leaderboard"; // Change this to the desired value
    const transactionIx = await client.updateGameLeaderboard(
        authWallet.publicKey,
        leaderboardPublicKey,
        newDescription, // newDescription
        undefined, // newNftMeta
        undefined, // newMinScore
        undefined, // newMaxScore
        newIsAscending,
        newAllowMultipleScores,
        undefined  // topEntries
    );
console.log(transactionIx);
    const transaction = new Transaction().add(transactionIx);

    await connection.sendTransaction(transaction, [authWallet], { skipPreflight: false, preflightCommitment: "confirmed" });

    console.log('Leaderboard updated successfully');
}
async function submitScore(playerAddress, leaderboardPda, score) {
  // Submit the score to the leaderboard
  const transactionIx = await client.submitScoreToLeaderBoard(
    playerAddress,
    authWallet.publicKey,
    leaderboardPda,
    new BN(score)
  );

  await web3.sendAndConfirmTransaction(connection, transactionIx.transaction, [authWallet]);

  console.log('Score submitted:', score);
}

(async () => {
//   const newGame = await createGame();
//   newGame = new PublicKey("yaZAk1ZviM3Ba1oHfXnuAYWioPTN68RBKfP2Dqxxj4b)");
//   await createLeaderboard(newGame);
await updateLeaderboard();
  // Example: Submit a score
//   const playerAddress = new PublicKey("<PLAYER_PUBLIC_KEY>");
//   const leaderboardPda = new PublicKey("<LEADERBOARD_PDA>");
//   const score = 10;

  await submitScore(playerAddress, leaderboardPda, score);
})();
