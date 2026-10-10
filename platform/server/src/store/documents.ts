import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Storage for the original uploaded documents (Emirates IDs, title deeds). Contents are personal data. */
export interface DocumentStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
}

export class MemoryDocumentStore implements DocumentStore {
  private files = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.files.set(key, Buffer.from(bytes));
  }
  async get(key: string) {
    const b = this.files.get(key);
    return b ? Buffer.from(b) : undefined;
  }
}

/**
 * Files on local disk encrypted with AES-256-GCM. Layout: iv(12) | authTag(16) | ciphertext.
 * The storage key is bound in as additional authenticated data, so a file copied or renamed
 * to another key fails to decrypt, and any tampering is detected. File names are hashes of the
 * key, so names leak nothing. The key must come from a secret manager, never from the repo.
 * For production prefer object storage in a UAE region with KMS-managed keys; this is the
 * pilot-grade equivalent behind the same interface.
 */
export class EncryptedFileDocumentStore implements DocumentStore {
  private key: Buffer;

  constructor(private dir: string, hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) throw new Error("DOCUMENT_KEY must be 64 hex characters (32 bytes)");
    this.key = Buffer.from(hexKey, "hex");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private path(key: string) {
    return join(this.dir, createHash("sha256").update(key).digest("hex") + ".bin");
  }

  async put(key: string, bytes: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(key));
    const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
    writeFileSync(this.path(key), Buffer.concat([iv, cipher.getAuthTag(), enc]), { mode: 0o600 });
  }

  async get(key: string) {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    const raw = readFileSync(p);
    if (raw.length < 28) throw new Error("Stored document is corrupt");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(raw.subarray(12, 28));
    try {
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    } catch {
      throw new Error("Stored document failed integrity check");
    }
  }
}
