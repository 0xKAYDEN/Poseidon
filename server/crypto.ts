import crypto from 'node:crypto';
import type { WebSocket } from 'ws';

const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

// ASN.1 SPKI DER prefix for X25519 (12 bytes)
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/**
 * AES-256-GCM authenticated encryption.
 * Package format: nonce(12) || ciphertext || tag(16) — matches Poseidon.Cryptography.AesGcmEncryption.
 */
export const AesGcmEncryption = {
  encrypt(plaintext: Buffer, key: Buffer, additionalData?: Buffer): Buffer {
    if (key.length !== KEY_SIZE) {
      throw new Error('AES-256 requires a 32-byte key');
    }
    const nonce = crypto.randomBytes(NONCE_SIZE);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    if (additionalData) {
      cipher.setAAD(additionalData);
    }
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, encrypted, tag]);
  },

  decrypt(pkg: Buffer, key: Buffer, additionalData?: Buffer): Buffer {
    if (key.length !== KEY_SIZE) {
      throw new Error('AES-256 requires a 32-byte key');
    }
    if (pkg.length < NONCE_SIZE + TAG_SIZE) {
      throw new Error('Encrypted package is too short');
    }
    const nonce = pkg.subarray(0, NONCE_SIZE);
    const ciphertext = pkg.subarray(NONCE_SIZE, pkg.length - TAG_SIZE);
    const tag = pkg.subarray(pkg.length - TAG_SIZE);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    if (additionalData) {
      decipher.setAAD(additionalData);
    }
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  },

  generateKey(): Buffer {
    return crypto.randomBytes(KEY_SIZE);
  }
};

/**
 * X25519 elliptic-curve Diffie-Hellman key agreement.
 * Matches Poseidon.Cryptography.EcdhKeyAgreement (SPKI DER public key + SHA-256 shared secret).
 */
export class EcdhKeyAgreement {
  private readonly privateKey: crypto.KeyObject;
  private readonly publicKeyDer: Buffer;

  constructor() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    this.privateKey = privateKey;
    this.publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  }

  getPublicKey(): Buffer {
    return this.publicKeyDer;
  }

  deriveKey(otherPublicKeySpki: Buffer): Buffer {
    const spkiBuf = otherPublicKeySpki.length === 32
      ? Buffer.concat([X25519_SPKI_PREFIX, otherPublicKeySpki])
      : otherPublicKeySpki;

    const otherPub = crypto.createPublicKey({
      key: spkiBuf,
      format: 'der',
      type: 'spki'
    });
    const sharedSecret = crypto.diffieHellman({
      privateKey: this.privateKey,
      publicKey: otherPub
    });
    return crypto.createHash('sha256').update(sharedSecret).digest();
  }
}

/**
 * PBKDF2-HMAC-SHA256 password hashing.
 * Format: $pbkdf2v1$iterations$salt$hash (base64 salt/hash) — matches PasswordHasher.cs.
 */
export const PasswordHasher = {
  ITERATIONS: 210_000,
  SALT_SIZE: 16,
  HASH_SIZE: 32,
  MARKER: '$pbkdf2v1$',

  hash(password: string): string {
    const salt = crypto.randomBytes(this.SALT_SIZE);
    const hash = crypto.pbkdf2Sync(password, salt, this.ITERATIONS, this.HASH_SIZE, 'sha256');
    return `${this.MARKER}${this.ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
  },

  verify(password: string, hashedPassword: string): boolean {
    if (!hashedPassword || !hashedPassword.startsWith(this.MARKER)) return false;
    const parts = hashedPassword.slice(this.MARKER.length).split('$');
    if (parts.length !== 3) return false;
    const iterations = Number.parseInt(parts[0], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const salt = Buffer.from(parts[1], 'base64');
    const expectedHash = Buffer.from(parts[2], 'base64');
    const actualHash = crypto.pbkdf2Sync(password, salt, iterations, expectedHash.length, 'sha256');
    if (actualHash.length !== expectedHash.length) return false;
    return crypto.timingSafeEqual(actualHash, expectedHash);
  }
};

/**
 * HS256 JWT implementation — matches JwtService.cs.
 */
export class JwtService {
  private readonly signingKey: Buffer;

  constructor(signingKey: Buffer) {
    if (signingKey.length !== 32) {
      throw new Error('JWT signing key must be 256 bits');
    }
    this.signingKey = signingKey;
  }

  createToken(claims: Record<string, unknown>, ttlSeconds: number): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ ...claims, exp, iat: now })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = crypto
      .createHmac('sha256', this.signingKey)
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${signature}`;
  }

  validateToken(token: string): Record<string, unknown> | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payloadPart, sigPart] = parts;
    const signingInput = `${header}.${payloadPart}`;
    const expectedSig = crypto.createHmac('sha256', this.signingKey).update(signingInput).digest();
    let actualSig: Buffer;
    try {
      actualSig = Buffer.from(sigPart, 'base64url');
    } catch {
      return null;
    }
    if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
      return null;
    }
    try {
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }
}

/**
 * AES-256-GCM encrypted credential storage — matches CredentialVault.cs.
 */
export class CredentialVault {
  private readonly masterKey: Buffer;

  constructor(masterKey: Buffer) {
    if (masterKey.length !== 32) {
      throw new Error('Master key must be 32 bytes');
    }
    this.masterKey = masterKey;
  }

  encrypt(data: Record<string, unknown>): string {
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    return AesGcmEncryption.encrypt(plaintext, this.masterKey).toString('base64');
  }

  decrypt(encryptedBase64: string): Record<string, unknown> {
    const pkg = Buffer.from(encryptedBase64, 'base64');
    const plaintext = AesGcmEncryption.decrypt(pkg, this.masterKey);
    return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  }
}

/**
 * Application-layer secure channel over WebSocket — matches SecureChannel.cs.
 */
export class SecureChannel {
  private readonly local = new EcdhKeyAgreement();
  private sessionKey: Buffer | null = null;
  private keyEstablished = false;

  get localPublicKey(): Buffer {
    return this.local.getPublicKey();
  }

  get isEncrypted(): boolean {
    return this.keyEstablished && this.sessionKey !== null;
  }

  establish(remotePublicKeySpki: Buffer): void {
    if (this.keyEstablished) {
      throw new Error('Session key already established');
    }
    this.sessionKey = this.local.deriveKey(remotePublicKeySpki);
    this.keyEstablished = true;
  }

  encrypt(jsonMessage: string): string {
    if (!this.keyEstablished || !this.sessionKey) {
      throw new Error('Session key not established');
    }
    const pkg = AesGcmEncryption.encrypt(Buffer.from(jsonMessage, 'utf8'), this.sessionKey);
    return JSON.stringify({ nonce: '', body: pkg.toString('base64'), tag: '' });
  }

  decrypt(envelopeJson: string): string {
    if (!this.keyEstablished || !this.sessionKey) {
      throw new Error('Session key not established');
    }
    const doc = JSON.parse(envelopeJson) as { body?: string };
    if (!doc.body) {
      throw new Error('Envelope missing body');
    }
    const pkg = Buffer.from(doc.body, 'base64');
    const plaintext = AesGcmEncryption.decrypt(pkg, this.sessionKey);
    return plaintext.toString('utf8');
  }

  sendHello(ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'channel_hello',
        server_key: this.localPublicKey.toString('base64')
      })
    );
  }

  sendFrame(ws: WebSocket, message: unknown): void {
    if (ws.readyState !== ws.OPEN) return;
    const json = JSON.stringify(message);
    const envelope = this.encrypt(json);
    ws.send(envelope);
  }
}
