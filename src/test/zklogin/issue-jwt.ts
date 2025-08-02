import 'dotenv/config';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in environment variables');
}

// Example: get steamId from command line argument
const steamId = process.argv[2];
if (!steamId) {
  console.error('Usage: ts-node issue-jwt.ts <steamId>');
  process.exit(1);
}

// Craft the payload
const payload = {
  steamId,
  iss: 'https://steamcommunity.com/openid', // steam openid issuer
  aud: 'http://localhost:3000', // TODO: change to actual deployed backend
  sub: steamId,
};

// Sign the JWT
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

console.log('JWT token:', token);
