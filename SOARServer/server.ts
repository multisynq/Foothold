import cors from 'cors';
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
app.use(cors()); /* NEW */

app.use(express.json());
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

const db = new Loki('users.db', { 
  autoload: true, 
  autosave: true, 
  autosaveInterval: 4000, 
  autoloadCallback: () => {
    users = db.getCollection('users');
    if (!users) {
      users = db.addCollection('users');
    }
  } 
});

let users = db.getCollection('users');
if (!users) {
  users = db.addCollection('users');
}

const nonces: { [key: string]: string } = {};
const scores: { [key: string]: { score: number; message: string } } = {};
const serverTimes: { [key: string]: string } = {};

app.post('/register', async (req: Request, res: Response) => {
  console.log('Received /register request with body:', req.body);

  const { walletAddress } = req.body;
  console.log('Extracted walletAddress:', walletAddress);

  let user = users.findOne({ walletAddress });
  console.log('User lookup result:', user);

  if (!user) {
    console.log('User not found, creating a new one.');
    const keypair = Keypair.generate();
    user = {
      walletAddress,
      publicKey: keypair.publicKey.toBase58(),
      secretKey: bs58.encode(keypair.secretKey),
    };
    users.insert(user);
    console.log('Inserted new user into database:', user);

    db.saveDatabase((err) => {
      if (err) {
        console.error('Error saving database:', err);
      } else {
        console.log('Database saved successfully.');
      }
    });
  } else {
    console.log('User already exists:', user);
  }

  try {
    const playerKeypair = Keypair.fromSecretKey(bs58.decode(user.secretKey));
    console.log('Player keypair generated:', playerKeypair.publicKey.toBase58());

    // Initialize player account
    try {
      console.log('Initializing player account...');
      const { transaction: initTransaction } = await client.initializePlayerAccount(playerKeypair.publicKey, "PlayerUsername", LEADERBOARD_NFT_PUBKEY);
      initTransaction.feePayer = defaultPayer.publicKey;
      initTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      console.log('Initialization transaction prepared:', initTransaction);

      await sendAndConfirmTransaction(connection, initTransaction, [playerKeypair, defaultPayer], { skipPreflight: false, preflightCommitment: "confirmed" });
      console.log('Player account initialized successfully.');
    } catch (error) {
      if (!error.message.includes("already in use")) {
        console.error('Error during player account initialization:', error);
        throw error;  // Re-throw if it's not the "already in use" error
      } else {
        console.log('Player account already in use, skipping initialization.');
      }
    }

    // Register player entry
    console.log('Fetching leaderboard account...');
    const leaderboardAccount = await client.fetchLeaderBoardAccount(leaderboardPda);
    console.log('Fetched leaderboard account:', leaderboardAccount.address);

    try {
      console.log('Registering player entry for leaderboard...');
      const { transaction: registerTransaction } = await client.registerPlayerEntryForLeaderBoard(playerKeypair.publicKey, leaderboardAccount.address);
      registerTransaction.feePayer = defaultPayer.publicKey;
      registerTransaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      console.log('Registration transaction prepared:', registerTransaction);

      await sendAndConfirmTransaction(connection, registerTransaction, [playerKeypair, defaultPayer], { skipPreflight: false, preflightCommitment: "confirmed" });
      console.log('Player entry registered successfully.');
    } catch (error) {
      if (!error.message.includes("already in use")) {
        console.error('Error during player entry registration:', error);
        throw error;  // Re-throw if it's not the "already in use" error
      } else {
        console.log('Player entry already in use, skipping registration.');
      }
    }

    res.json({ message: 'User registered and player account initialized successfully' });
  } catch (error) {
    console.error('Failed to initialize and register player account:', error);
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
    // console.dir(submitScoreTransaction, { depth: null });
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

const enum Seeds {
  GAME = "game",
  LEADER = "leaderboard",
  ACHIEVEMENT = "achievement",
  PLAYER = "player",
  PLAYER_SCORES = "player-scores-list",
  PLAYER_ACHIEVEMENT = "player-achievement",
  LEADER_TOP_ENTRIES = "top-scores",
  NFT_CLAIM = "nft-claim",
}

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
      const { transaction: initPlayerTransaction } = await client.initializePlayerAccount(new PublicKey(user.publicKey), "PlayerUsername", LEADERBOARD_NFT_PUBKEY);
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
      const { transaction: registerPlayerTransaction } = await client.registerPlayerEntryForLeaderBoard(new PublicKey(user.publicKey), leaderboardAccount.address);
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

    // Fetch user from the database
    const user = users.findOne({ walletAddress: myWallet });
    const myPublicKey = user ? new PublicKey(user.publicKey).toBase58() : null;
    console.log('myPublicKey:', myPublicKey);
    const meAndTopNScores = getMeAndTopNScores(topEntriesAccount, myPublicKey, max);
    res.json(meAndTopNScores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
const PROGRAM_ADDRESS = "SoarNNzwQHMwcfdkdLc6kvbkoMSxcHy89gTHrjhJYkk";
const PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);
function derivePlayerAddress(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(Seeds.PLAYER), user.toBuffer()],
    PROGRAM_ID
  );
}
function getMeAndTopNScores(topEntriesAccount: any, myPublicKey: any, max = 5) {
  let resList = [] as any;
  let myScore: any = null;

  // Filter out invalid scores
  topEntriesAccount.topScores = topEntriesAccount.topScores.filter((score: any) => {
    const player = score.player.toBase58();
    const playerScore = score.entry.score.toString();
    const timestamp = score.entry.timestamp;
    return !(player === '11111111111111111111111111111111' || playerScore === '18446744073709551615' || timestamp === 0);
  });
  myPublicKey = derivePlayerAddress(new PublicKey(myPublicKey))[0].toBase58();
  // Push valid scores into the array and label "YOU"
  topEntriesAccount.topScores.forEach((score: any) => {
    console.log(myPublicKey, score.player.toBase58());
    const wallet = score.player.toBase58();
    const score1 = parseInt(score.entry.score.toString(), 10);
    if (wallet === myPublicKey) {
      myScore = { wallet: 'You', score: score1 };
      resList.push({ wallet: 'You', score: score1 });
    } else {
      resList.push({ wallet, score: score1 });
    }
  });

  // Sort the array by score in descending order
  resList.sort((a: any, b: any) => b.score - a.score);

  // Recalculate ranks
  resList.forEach((score: any, index: number) => {
    score.rank = index + 1;
  });

  // Ensure "YOU" is included if it exists and is not in the top 5
  const topNScores = resList.slice(0, max);
  if (myScore && !topNScores.some((score: any) => score.wallet === 'You')) {
    topNScores.push(myScore);
  }

  // Recalculate ranks after ensuring "YOU" is included
  topNScores.sort((a: any, b: any) => b.score - a.score);
  topNScores.forEach((score: any, index: number) => {
    score.rank = index + 1;
  });

  return topNScores;
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
