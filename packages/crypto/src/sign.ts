import { createSign, createVerify, generateKeyPairSync } from "crypto";

export type ECKeyPair = {
  publicKey: string;
  privateKey: string;
};

/**
 * Generates a P-256 ECDSA key pair (PEM-encoded). Used once, offline, to
 * provision the checkpoint-worker's signing key. The private key must only
 * ever live in the worker's environment.
 */
export function generateSigningKeyPair(): ECKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

/** Signs a Merkle root with the ECDSA private key. Worker-only operation. */
export function signRoot(merkleRoot: string, privateKeyPem: string): string {
  const signer = createSign("SHA256");
  signer.update(merkleRoot, "utf8");
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

/** Verifies a checkpoint signature against the public key only. Read-only. */
export function verifyRootSignature(
  merkleRoot: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(merkleRoot, "utf8");
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
