import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { SoarProgram } from '@magicblock-labs/soar-sdk';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { decodeUTF8 } from 'tweetnacl-util';
import crypto from 'crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const connection = new Connection(process.env.CONNECTION_URL!, "confirmed");
const defaultPayer = Keypair.fromSecretKey(bs58.decode(process.env.DEFAULT_PAYER_SECRET_KEY!));
const authWallet = Keypair.fromSecretKey(bs58.decode(process.env.AUTH_WALLET_SECRET_KEY!));

const client = SoarProgram.getFromConnection(connection, defaultPayer.publicKey);

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

// Endpoint 2: Submit a high score and get a message to sign
app.post('/submit-score', async (req: Request, res: Response) => {
  const { walletAddress, score } = req.body;
  const nonce = nonces[walletAddress];

  if (!nonce) {
    return res.status(400).json({ error: 'Nonce not found. Please prove wallet ownership first.' });
  }

  const message = `Submit your score of ${score} for wallet ${walletAddress} with nonce ${nonce}`;
  scores[walletAddress] = { score, message };

  res.json({ message });
});

// Endpoint 3: Verify signed message and write score to leaderboard
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

  const leaderboardPda = new PublicKey("<LEADERBOARD_PDA>"); // Update with actual leaderboard PDA

  try {
    const transactionIx = await client.submitScoreToLeaderBoard(
      new PublicKey(walletAddress),
      authWallet.publicKey,
      leaderboardPda,
      new BN(score)
    );

    await connection.sendTransaction(transactionIx.transaction, [authWallet], { skipPreflight: false, preflightCommitment: "confirmed" });

    res.json({ message: 'Score successfully submitted to leaderboard.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit score to leaderboard.' });
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
