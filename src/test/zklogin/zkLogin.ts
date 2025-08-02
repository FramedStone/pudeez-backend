import 'dotenv/config';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  jwtToAddress,
} from '@mysten/sui/zklogin';

// 1. Get JWT token from command line
const JWT_TOKEN = process.argv[2];
if (!JWT_TOKEN) {
  console.error('Usage: ts-node login.ts <jwt_token>');
  process.exit(1);
}

// 2. Decode JWT to get steamId (sub)
const decoded = jwt.decode(JWT_TOKEN) as { steamId: string };
if (!decoded?.steamId) {
  console.error('JWT does not contain steamId');
  process.exit(1);
}
const steamId = decoded.steamId;
console.log('Steam ID from JWT:', steamId);

// 3. Generate ephemeral keypair
const ephemeralKeyPair = new Ed25519Keypair(); 

// 4. Set maxEpoch (for demo, hardcode; in production, fetch from Sui RPC)
const maxEpoch = 10;

// 5. Generate randomness and nonce
const randomness = generateRandomness();
const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);

// 6. Hardcoded salt for demo (in production, use a salt service)
const salt = '12345678901234567890123456789012'; // 16 bytes or < 2^128

// 7. Extended ephemeral public key
const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey());

// 8. Prepare payload for Mysten zkLogin Prover
const proverUrl = 'http://localhost:8080/v1';
const keyClaimName = 'sub';

async function getZkLoginProof() {
  const payload = {
    jwt: JWT_TOKEN,
    extendedEphemeralPublicKey: extendedEphemeralPublicKey.toString(), // BigInt string
    maxEpoch: maxEpoch.toString(),
    jwtRandomness: randomness.toString(),
    salt: salt.toString(),
    keyClaimName,
  };

  const response = await axios.post(proverUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data;
}

(async () => {
  try {
    const proof = await getZkLoginProof();
    const zkLoginAddress = jwtToAddress(JWT_TOKEN, salt);
    console.log('zkLogin wallet address:', zkLoginAddress);
    console.log('Steam ID:', steamId);
    console.log('Proof:', proof);
  } catch (err: any) {
    console.error('Error calling Mysten zkLogin Prover:', err.response?.data || err.message);
  }
})();
