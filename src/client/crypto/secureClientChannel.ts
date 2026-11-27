// Pure RFC 7748 X25519 + ASN.1 SPKI DER + WebCrypto SHA-256 + AES-256-GCM
// Matches Poseidon.Cryptography (EcdhKeyAgreement + AesGcmEncryption + SecureChannel).

const P = (1n << 255n) - 19n;
const A24 = 121665n;
const X25519_SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);

function mod(a: bigint, p: bigint = P): bigint {
  const r = a % p;
  return r >= 0n ? r : r + p;
}

function modPow(base: bigint, exp: bigint, m: bigint = P): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function clampScalar(k: Uint8Array): Uint8Array {
  const c = new Uint8Array(k);
  c[0] &= 248;
  c[31] &= 127;
  c[31] |= 64;
  return c;
}

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = 31; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return n;
}

function encodeLittleEndian(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = mod(n);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function x25519(kBytes: Uint8Array, uBytes: Uint8Array): Uint8Array {
  const k = decodeLittleEndian(clampScalar(kBytes));
  const uMasked = new Uint8Array(uBytes);
  uMasked[31] &= 127;
  const x1 = decodeLittleEndian(uMasked);

  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & 1n;
    swap ^= kt;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;

    const A = mod(x2 + z2);
    const AA = mod(A * A);
    const B = mod(x2 - z2);
    const BB = mod(B * B);
    const E = mod(AA - BB);
    const C = mod(x3 + z3);
    const D = mod(x3 - z3);
    const DA = mod(D * A);
    const CB = mod(C * B);

    const x3Sum = mod(DA + CB);
    x3 = mod(x3Sum * x3Sum);
    const x3Diff = mod(DA - CB);
    z3 = mod(x1 * mod(x3Diff * x3Diff));
    x2 = mod(AA * BB);
    z2 = mod(E * mod(AA + mod(A24 * E)));
  }

  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  const out = mod(x2 * modPow(z2, P - 2n));
  return encodeLittleEndian(out);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export type ChannelEventHandler = (message: Record<string, unknown>) => void;

export class SecureClientChannel {
  private ws: WebSocket | null = null;
  private aesKey: CryptoKey | null = null;
  private localPrivateKey: Uint8Array;
  private localPublicSpki: Uint8Array;
  private connected = false;
  private encrypted = false;
  private listeners = new Set<ChannelEventHandler>();
  private statusListeners = new Set<(encrypted: boolean) => void>();

  constructor() {
    this.localPrivateKey = crypto.getRandomValues(new Uint8Array(32));
    const basePoint = new Uint8Array(32);
    basePoint[0] = 9;
    const rawPub = x25519(this.localPrivateKey, basePoint);
    this.localPublicSpki = new Uint8Array(X25519_SPKI_PREFIX.length + 32);
    this.localPublicSpki.set(X25519_SPKI_PREFIX, 0);
    this.localPublicSpki.set(rawPub, X25519_SPKI_PREFIX.length);
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  get isEncrypted(): boolean {
    return this.encrypted && this.aesKey !== null;
  }

  onEvent(handler: ChannelEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onStatusChange(handler: (encrypted: boolean) => void): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  private emitStatus(enc: boolean): void {
    this.encrypted = enc;
    for (const cb of this.statusListeners) {
      cb(enc);
    }
  }

  async connect(jwt: string): Promise<void> {
    this.disconnect();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let resolved = false;

      ws.onopen = () => {
        this.connected = true;
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          reject(new Error('WebSocket connection error'));
        }
      };

      ws.onclose = () => {
        this.connected = false;
        this.emitStatus(false);
      };

      ws.onmessage = async evt => {
        try {
          const text = String(evt.data);
          if (!this.aesKey) {
            const hello = JSON.parse(text) as { type?: string; server_key?: string };
            if (hello.type === 'channel_hello' && hello.server_key) {
              const serverSpki = fromBase64(hello.server_key);
              const serverRawPub = serverSpki.length === 44 ? serverSpki.slice(12) : serverSpki;
              const sharedSecret = x25519(this.localPrivateKey, serverRawPub);
              const rawKeyBuf = await crypto.subtle.digest('SHA-256', sharedSecret.buffer as ArrayBuffer);
              this.aesKey = await crypto.subtle.importKey(
                'raw',
                rawKeyBuf,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
              );
              ws.send(
                JSON.stringify({
                  type: 'channel_ready',
                  client_key: toBase64(this.localPublicSpki),
                  jwt
                })
              );
            }
            return;
          }

          const decrypted = await this.decryptEnvelope(text);
          const msg = JSON.parse(decrypted) as Record<string, unknown>;
          if (msg.type === 'channel_established') {
            this.emitStatus(true);
            if (!resolved) {
              resolved = true;
              resolve();
            }
            return;
          }
          for (const listener of this.listeners) {
            listener(msg);
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        }
      };
    });
  }

  async sendEncrypted(payload: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.aesKey) {
      throw new Error('Encrypted channel not established');
    }
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cipherAndTag = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 },
        this.aesKey,
        plaintext
      )
    );
    const pkg = new Uint8Array(nonce.length + cipherAndTag.length);
    pkg.set(nonce, 0);
    pkg.set(cipherAndTag, nonce.length);
    this.ws.send(JSON.stringify({ nonce: '', body: toBase64(pkg), tag: '' }));
  }

  private async decryptEnvelope(envelopeJson: string): Promise<string> {
    if (!this.aesKey) throw new Error('Session key not established');
    const doc = JSON.parse(envelopeJson) as { body?: string };
    if (!doc.body) throw new Error('Envelope missing body');
    const pkg = fromBase64(doc.body);
    const nonce = pkg.slice(0, 12);
    const cipherAndTag = pkg.slice(12);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      this.aesKey,
      cipherAndTag
    );
    return new TextDecoder().decode(plainBuf);
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.aesKey = null;
    this.connected = false;
    this.emitStatus(false);
  }
}
