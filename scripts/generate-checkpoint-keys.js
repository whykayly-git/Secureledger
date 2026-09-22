#!/usr/bin/env node
/**
 * Generates a fresh P-256 ECDSA key pair for the checkpoint service and
 * prints both raw PEM and base64-encoded forms, ready to paste into .env.
 * Run once per environment: node scripts/generate-checkpoint-keys.js
 */
const { generateKeyPairSync } = require("crypto");

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

console.log("=== ECDSA P-256 key pair for SecureLedger checkpointing ===\n");

console.log("--- Public key (PEM) — set as CHECKPOINT_PUBLIC_KEY in apps/web ---");
console.log(publicKey);

console.log("--- Private key (PEM) — set as CHECKPOINT_PRIVATE_KEY in checkpoint-worker ONLY ---");
console.log(privateKey);

console.log("--- Base64-encoded (paste directly into .env / docker-compose secrets) ---");
console.log(`CHECKPOINT_PUBLIC_KEY=${Buffer.from(publicKey).toString("base64")}`);
console.log(`CHECKPOINT_PRIVATE_KEY=${Buffer.from(privateKey).toString("base64")}`);
