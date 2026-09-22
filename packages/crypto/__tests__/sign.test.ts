import { generateSigningKeyPair, signRoot, verifyRootSignature } from "../src/sign";
import { sha256Hex } from "../src/hash";

describe("ECDSA checkpoint signing", () => {
  const { publicKey, privateKey } = generateSigningKeyPair();
  const root = sha256Hex("merkle-root-example");

  it("produces a signature that verifies against the matching public key", () => {
    const signature = signRoot(root, privateKey);
    expect(verifyRootSignature(root, signature, publicKey)).toBe(true);
  });

  it("fails verification if the root was tampered with", () => {
    const signature = signRoot(root, privateKey);
    const tamperedRoot = sha256Hex("different-root");
    expect(verifyRootSignature(tamperedRoot, signature, publicKey)).toBe(false);
  });

  it("fails verification against a different key pair's public key", () => {
    const signature = signRoot(root, privateKey);
    const other = generateSigningKeyPair();
    expect(verifyRootSignature(root, signature, other.publicKey)).toBe(false);
  });

  it("fails gracefully (not throws) on a malformed signature", () => {
    expect(verifyRootSignature(root, "not-a-real-signature", publicKey)).toBe(false);
  });

  it("fails gracefully on an empty-string signature", () => {
    expect(verifyRootSignature(root, "", publicKey)).toBe(false);
  });

  it("fails on a signature that is valid base64 but not a valid DER-encoded signature", () => {
    const garbage = Buffer.from("not a real der signature at all").toString("base64");
    expect(verifyRootSignature(root, garbage, publicKey)).toBe(false);
  });

  it("generates PEM-formatted public and private keys", () => {
    expect(publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it("generates a different key pair on every call", () => {
    const a = generateSigningKeyPair();
    const b = generateSigningKeyPair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it("produces a base64-encoded signature", () => {
    const signature = signRoot(root, privateKey);
    expect(() => Buffer.from(signature, "base64")).not.toThrow();
    expect(Buffer.from(signature, "base64").length).toBeGreaterThan(0);
  });

  it("produces a different signature each time (ECDSA uses a random nonce), yet both verify", () => {
    const sigA = signRoot(root, privateKey);
    const sigB = signRoot(root, privateKey);
    expect(sigA).not.toBe(sigB);
    expect(verifyRootSignature(root, sigA, publicKey)).toBe(true);
    expect(verifyRootSignature(root, sigB, publicKey)).toBe(true);
  });

  it("round-trips correctly for an empty-string root", () => {
    const emptyRoot = "";
    const signature = signRoot(emptyRoot, privateKey);
    expect(verifyRootSignature(emptyRoot, signature, publicKey)).toBe(true);
  });

  it("a signature for one root does not verify against a different, unsigned root", () => {
    const rootA = sha256Hex("root-a");
    const rootB = sha256Hex("root-b");
    const signature = signRoot(rootA, privateKey);
    expect(verifyRootSignature(rootB, signature, publicKey)).toBe(false);
  });
});
