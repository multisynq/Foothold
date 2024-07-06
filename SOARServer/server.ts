import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { SoarProgram } from '@magicblock-labs/soar-sdk';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { decodeUTF8 } from 'tweetnacl-util';
import crypto from 'crypto';
import BN from 'bn.js';
import Loki from 'lokijs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const connection = new Connection(process.env.CONNECTION_URL!, "confirmed");
const defaultPayer = Keypair.fromSecretKey(bs58.decode(process.env.DEFAULT_PAYER_SECRET_KEY!));
const authWallet = Keypair.fromSecretKey(bs58.decode(process.env.AUTH_WALLET_SECRET_KEY!));
const LEADERBOARD_NFT_PUBKEY = process.env.LEADERBOARD_NFT_PUBLIC_KEY!;
console.log('Default payer:', defaultPayer.publicKey.toBase58());
console.log('Auth wallet:', authWallet.publicKey.toBase58());
const client = SoarProgram.getFromConnection(connection, defaultPayer.publicKey);
let leaderboardPda: PublicKey;
if (process.env.LEADERBOARD_PDA_PUBLIC_KEY) {
  leaderboardPda = new PublicKey(process.env.LEADERBOARD_PDA_PUBLIC_KEY);
} else {
  throw new Error('LEADERBOARD_PDA_PUBLIC_KEY is not defined');
}

const db = new Loki('users.db', { autoload: true, autosave: true, autosaveInterval: 4000 });
let users = db.getCollection('users');
if (!users) {
  users = db.addCollection('users');
}

const nonces: { [key: string]: string } = {};
const scores: { [key: string]: { score: number; message: string } } = {};
const serverTimes: { [key: string]: string } = {};

app.post('/register', async (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  let user = users.findOne({ walletAddress });

  if (!user) {
    const keypair = Keypair.generate();
    user = {
      walletAddress,
      publicKey: keypair.publicKey.toBase58(),
      secretKey: bs58.encode(keypair.secretKey),
    };
    users.insert(user);
  }

  try {
    const playerKeypair = Keypair.fromSecretKey(bs58.decode(user.secretKey));

    // Initialize player account
    try {
      const { transaction: initTransaction } = await client.initializePlayerAccount(playerKeypair.publicKey, "PlayerUsername", LEADERBOARD_NFT_PUBKEY);
      initTransaction.feePayer = defaultPayer.publicKey;
      initTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

      await sendAndConfirmTransaction(connection, initTransaction, [playerKeypair, defaultPayer], { skipPreflight: false, preflightCommitment: "confirmed" });
    } catch (error) {
      if (!error.message.includes("already in use")) {
        throw error;  // Re-throw if it's not the "already in use" error
      }
    }

    // Register player entry
    const leaderboardAccount = await client.fetchLeaderBoardAccount(leaderboardPda);
    try {
      const { transaction: registerTransaction } = await client.registerPlayerEntryForLeaderBoard(playerKeypair.publicKey, leaderboardAccount.address);
      registerTransaction.feePayer = defaultPayer.publicKey;
      registerTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

      await sendAndConfirmTransaction(connection, registerTransaction, [playerKeypair, defaultPayer], { skipPreflight: false, preflightCommitment: "confirmed" });
    } catch (error) {
      if (!error.message.includes("already in use")) {
        throw error;  // Re-throw if it's not the "already in use" error
      }
    }

    res.json({ message: 'User registered and player account initialized successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize and register player account', details: error.message });
  }
});

app.post('/get-server-time', (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  const serverTime = Date.now().toString();
  serverTimes[walletAddress] = serverTime;
  res.json({ serverTime });
});

app.post('/get-nonce', (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces[walletAddress] = nonce;
  res.json({ nonce });
});

app.post('/verify-score', (req: Request, res: Response) => {
  const { walletAddress, signedMessage, score } = req.body;
  const message = serverTimes[walletAddress];
  if (!message) {
    return res.status(400).json({ error: 'Server time not found. Please request server time first.' });
  }
  const verified = verifySignature(walletAddress, message, signedMessage);
  if (!verified) {
    return res.status(400).json({ error: 'Signature verification failed.' });
  }
  scores[walletAddress] = { score, message };
  res.json({ message: 'Score verified and stored temporarily.' });
});

app.post('/submit-score', async (req: Request, res: Response) => {
  const { walletAddress, score } = req.body;

  try {
    // Fetch the leaderboard account
    const leaderboardAccount = await client.fetchLeaderBoardAccount(leaderboardPda);
    
    // Find the user in the database
    const user = users.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Retrieve the player's keypair from the secret key
    const playerKeypair = Keypair.fromSecretKey(bs58.decode(user.secretKey));
    console.log('Player keypair:', playerKeypair.publicKey.toBase58());
    
    // Create the transaction instruction
    const { transaction: submitScoreTransaction } = await client.submitScoreToLeaderBoard(
      playerKeypair.publicKey,    // Player public key
      authWallet.publicKey,       // Authority public key
      leaderboardAccount.address, // Leaderboard account address
      new BN(score)               // Score to be submitted
    );

    // Set transaction fee payer and recent blockhash
    submitScoreTransaction.feePayer = defaultPayer.publicKey;
    submitScoreTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    // Sign and send the transaction
    const signedTransaction = await sendAndConfirmTransaction(
      connection, 
      submitScoreTransaction, 
      [defaultPayer, authWallet], 
      { skipPreflight: false, preflightCommitment: "confirmed" }
    );

    // Log the transaction ID for debugging purposes
    console.log('Score submission transaction ID:', signedTransaction);

    res.json({ message: 'Score successfully submitted to leaderboard.' });
  } catch (error) {
    // Log error details for debugging purposes
    console.error('Error submitting score to leaderboard:', error.message);
    res.status(500).json({ error: 'Failed to submit score to leaderboard.', details: error.message });
  }
});

app.post('/checkPlayerStatus', async (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  try {
    const user = users.findOne({ walletAddress });
    if (!user) {
      return res.json({ isInitialized: false, isRegistered: false });
    }

    const player = new PublicKey(walletAddress);
    let isInitialized = false;
    let isRegistered = false;

    try {
      const { transaction: initPlayerTransaction } = await client.initializePlayerAccount(player, "PlayerUsername", new PublicKey(user.publicKey));
      initPlayerTransaction.feePayer = defaultPayer.publicKey;
      initPlayerTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, initPlayerTransaction, [defaultPayer]);
      isInitialized = true;
    } catch (error) {
      if (error.message.includes("already in use")) {
        isInitialized = true;
      }
    }

    try {
      const leaderboardAccount = await client.fetchLeaderBoardAccount(leaderboardPda);
      const { transaction: registerPlayerTransaction } = await client.registerPlayerEntryForLeaderBoard(player, leaderboardAccount.address);
      registerPlayerTransaction.feePayer = defaultPayer.publicKey;
      registerPlayerTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, registerPlayerTransaction, [defaultPayer]);
      isRegistered = true;
    } catch (error) {
      if (error.message.includes("already in use")) {
        isRegistered = true;
      }
    }

    res.json({ isInitialized, isRegistered });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/get-leaderboard', async (req: Request, res: Response) => {
  try {
    const leaderboardAccount = await client.fetchLeaderBoardAccount(new PublicKey(process.env.LEADERBOARD_PDA_PUBLIC_KEY!));
    const topEntriesAccount = await client.fetchLeaderBoardTopEntriesAccount(leaderboardAccount.topEntries as PublicKey);
    const myWallet = req.body.wallet;
    const max = req.body.max || 5;
    const meAndTopNScores = getMeAndTopNScores(topEntriesAccount, myWallet, max);
    res.json(meAndTopNScores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getMeAndTopNScores(topEntriesAccount: any, myWallet: any, max = 5) {
  let resList = [] as any;
  topEntriesAccount.topScores.forEach((score: any, index: number) => {
    const wallet = score.player.toBase58();
    const score1 = score.entry.score.toString();
    if (wallet === myWallet) {
      resList.push({ rank: index + 1, wallet, score1 });
    }
    if (index < max) resList.push({ rank: index + 1, wallet, score1 });
  });
  return resList.sort((a: any, b: any) => a.rank - b.rank);
}

function verifySignature(walletAddress: string, message: string, signedMessage: string): boolean {
  const messageBytes = decodeUTF8(message);
  const signedMessageBytes = bs58.decode(signedMessage);
  const publicKey = new PublicKey(walletAddress);
  return nacl.sign.detached.verify(messageBytes, signedMessageBytes, publicKey.toBytes());
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
