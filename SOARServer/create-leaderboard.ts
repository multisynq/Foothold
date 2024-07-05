import { Connection, Keypair, PublicKey } from '@solana/web3.js';
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
const gameDescription = "Foothold is an instantly-joinable multiplayer game where you and your friends are defending your central spaceship from increasingly large waves of Guardian bots. If the bots reach your ship, they detonate - use your tank's rebound rounds to eliminate the threat to your evil invasion!";
const genre = Genre.Action;
const gameType = GameType.Web;
const nftMeta = Keypair.generate().publicKey; // Assuming you have minted NFT for the game
const auths = [authWallet];  // Replace with actual array of authorized Keypairs
const _auths = auths.map((keypair) => keypair.publicKey);

async function createGameAndLeaderboard() {
  try {
    // Create the game on-chain
    let newKeypair = Keypair.generate();
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
    await connection.sendTransaction(transaction, [defaultPayer], { skipPreflight: false, preflightCommitment: "confirmed" });

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

    await connection.sendTransaction(transactionIx.transaction, [authWallet], { skipPreflight: false, preflightCommitment: "confirmed" });

    console.log('Leaderboard created');
  } catch (error) {
    console.error('Error creating game and leaderboard:', error);
  }
}

createGameAndLeaderboard();
