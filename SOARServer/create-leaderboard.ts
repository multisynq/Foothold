import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { SoarProgram, GameType, Genre } from '@magicblock-labs/soar-sdk';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

const connection = new Connection(process.env.CONNECTION_URL!, "confirmed");
const defaultPayer = Keypair.fromSecretKey(bs58.decode(process.env.DEFAULT_PAYER_SECRET_KEY!));
const authWallet = Keypair.fromSecretKey(bs58.decode(process.env.AUTH_WALLET_SECRET_KEY!));
const leaderboardNft = new PublicKey(process.env.LEADERBOARD_NFT_PUBLIC_KEY!);
console.log('Leaderboard NFT:', leaderboardNft.toString());

const client = SoarProgram.getFromConnection(connection, defaultPayer.publicKey);

const gameTitle = "Foothold";
const gameDescription = "Foothold is an instantly-joinable multiplayer game where players compete to hold the foothold for the longest time.";
const genre = Genre.Action;
const gameType = GameType.Web;
const nftMeta = leaderboardNft; // Assuming you have minted NFT for the game
const auths = [authWallet];  // Replace with actual array of authorized Keypairs
const _auths = auths.map((keypair) => keypair.publicKey);

let newKeypair = Keypair.generate();

async function createGameAndLeaderboard() {
  try {
    // Create the game on-chain
    console.log('New keypair:', newKeypair.publicKey.toString(), newKeypair.secretKey.toString());
    const { newGame, transaction } = await client.initializeNewGame(
      newKeypair.publicKey,
      gameTitle,
      gameDescription,
      genre,
      gameType,
      nftMeta,
      _auths
    );

    // Send and confirm the transaction
    const signature = await sendAndConfirmTransaction(connection, transaction, [defaultPayer, newKeypair], { skipPreflight: false, preflightCommitment: "confirmed" });
    console.log('Transaction signature:', signature);

    // Ensure the new game account exists
    const gameAccount = await client.fetchGameAccount(newGame);
    if (!gameAccount) {
      throw new Error(`Failed to fetch game account: ${newGame.toString()}`);
    }

    console.log('Game created:', newGame.toString());

    // Create the leaderboard on-chain
    const transactionIx = await client.addNewGameLeaderBoard(
      newGame,
      authWallet.publicKey,
      "Foothold Leaderboard",
      leaderboardNft,
      100, // maximum entries
      true // isAscending
    );

    // Send and confirm the transaction for leaderboard
    const leaderboardSignature = await sendAndConfirmTransaction(connection, transactionIx.transaction, [defaultPayer, authWallet], { skipPreflight: false, preflightCommitment: "confirmed" });
    console.log('Leaderboard transaction signature:', leaderboardSignature);

    console.log('Leaderboard created');
  } catch (error) {
    console.error('Error creating game and leaderboard:', error);
  }
}

createGameAndLeaderboard();
