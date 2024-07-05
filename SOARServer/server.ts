import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { SoarProgram } from '@magicblock-labs/soar-sdk';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { decodeUTF8 } from 'tweetnacl-util';
import crypto from 'crypto';
import BN from 'bn.js'; // Ensure to install bn.js package

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const connection = new Connection(process.env.CONNECTION_URL!, "confirmed");
const defaultPayer = Keypair.fromSecretKey(bs58.decode(process.env.DEFAULT_PAYER_SECRET_KEY!));
const authWallet = Keypair.fromSecretKey(bs58.decode(process.env.AUTH_WALLET_SECRET_KEY!));
const client = SoarProgram.getFromConnection(connection, defaultPayer.publicKey);
let leaderboardPda: PublicKey;
if (process.env.LEADERBOARD_PDA_PUBLIC_KEY) {
  leaderboardPda = new PublicKey(process.env.LEADERBOARD_PDA_PUBLIC_KEY);
} else {
  throw new Error('LEADERBOARD_PDA_PUBLIC_KEY is not defined');
}

const nonces: { [key: string]: string } = {};  // Store nonces for wallets
const scores: { [key: string]: { score: number; message: string } } = {};  // Store scores temporarily
const serverTimes: { [key: string]: string } = {};  // Store server times for wallets

// Endpoint to get the server time
app.post('/get-server-time', (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  const serverTime = Date.now().toString();
  serverTimes[walletAddress] = serverTime;
  res.json({ serverTime });
});

// Endpoint 1: Get nonce to prove wallet ownership
app.post('/get-nonce', (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces[walletAddress] = nonce;
  res.json({ nonce });
});

// Endpoint 2: Verify signed message and write score to leaderboard
app.post('/verify-score', async (req: Request, res: Response) => {
  const { walletAddress, signedMessage } = req.body;
  const { score, message } = scores[walletAddress];
  const serverTime = serverTimes[walletAddress];

  if (!score || !message || !serverTime) {
    return res.status(400).json({ error: 'Score, message, or server time not found. Please submit a score first.' });
  }

  const verified = verifySignature(walletAddress, message, signedMessage);
  if (!verified) {
    return res.status(400).json({ error: 'Signature verification failed.' });
  }

  try {
    const transactionIx = await client.submitScoreToLeaderBoard(
      new PublicKey(walletAddress),
      authWallet.publicKey,
      leaderboardPda,
      new BN(score)
    );

    await sendAndConfirmTransaction(connection, transactionIx.transaction, [authWallet], { skipPreflight: false, preflightCommitment: "confirmed" });

    res.json({ message: 'Score successfully submitted to leaderboard.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit score to leaderboard.', details: error.message });
  }
});

// Endpoint 3: Initialize player account
app.post('/initializePlayerAccount', async (req: Request, res: Response) => {
  const { playerPublicKey } = req.body;
  try {
    const player = new PublicKey(playerPublicKey);
    const { transaction } = await client.initializePlayerAccount(player, "PlayerUsername", PublicKey.default);
    transaction.feePayer = defaultPayer.publicKey;
    transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    res.json({ transaction: transaction.serialize().toString('base64') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 4: Register player entry for leaderboard
app.post('/registerPlayerEntry', async (req: Request, res: Response) => {
  const { playerPublicKey } = req.body;
  try {
    const player = new PublicKey(playerPublicKey);
    const leaderboardAccount = await client.fetchLeaderBoardAccount(leaderboardPda);
    const { transaction } = await client.registerPlayerEntryForLeaderBoard(player, leaderboardAccount.address);
    transaction.feePayer = defaultPayer.publicKey;
    transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    res.json({ transaction: transaction.serialize().toString('base64') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 5: Submit score to leaderboard
app.post('/submitScore', async (req: Request, res: Response) => {
  const { playerPrivateKey, score } = req.body;
  try {
    const player = Keypair.fromSecretKey(bs58.decode(playerPrivateKey));
    const leaderboardAccount = await client.fetchLeaderBoardAccount(leaderboardPda);
    const { transaction } = await client.submitScoreToLeaderBoard(player.publicKey, authWallet.publicKey, leaderboardAccount.address, new BN(score));
    transaction.feePayer = defaultPayer.publicKey;
    transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    transaction.sign(defaultPayer, player, authWallet);
    const txid = await sendAndConfirmTransaction(connection, transaction, [defaultPayer, player, authWallet]);
    res.json({ transactionId: txid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function verifySignature(walletAddress: string, message: string, signedMessage: string): boolean {
  const messageBytes = decodeUTF8(message);
  const signedMessageBytes = bs58.decode(signedMessage);
  const publicKey = new PublicKey(walletAddress);
  return nacl.sign.detached.verify(messageBytes, signedMessageBytes, publicKey.toBytes());
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
