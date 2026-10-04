// Web Push with Node's own crypto, no library: VAPID keys and their signed JWT (RFC 8292), and the message encrypted
// for one browser subscription (RFC 8291, aes128gcm content coding from RFC 8188). The office's keys live in
// <SWARM_HOME>/push.json (notifier.ts); only the public key ever reaches a browser.
import crypto from 'node:crypto';

/** A browser's PushSubscription, as its toJSON() gives it. */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The office's VAPID key pair: the raw P-256 public key (65 bytes) and private scalar (32 bytes), base64url. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

export function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** Keys read back from disk, or null when they aren't a usable P-256 pair. */
export function checkVapidKeys(raw: unknown): VapidKeys | null {
  const k = raw as Partial<VapidKeys> | null;
  if (!k || typeof k.publicKey !== 'string' || typeof k.privateKey !== 'string') return null;
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(unb64u(k.privateKey));
    return b64u(ecdh.getPublicKey()) === k.publicKey ? { publicKey: k.publicKey, privateKey: k.privateKey } : null;
  } catch {
    return null;
  }
}

/** A subscription posted by a browser, or null when it isn't one (https endpoint, a P-256 key and a 16-byte secret). */
export function checkSubscription(raw: unknown): PushSub | null {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || typeof s.keys?.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
  try {
    if (new URL(s.endpoint).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const key = unb64u(s.keys.p256dh);
  const auth = unb64u(s.keys.auth);
  if (key.length !== 65 || key[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

function privateKeyObject(keys: VapidKeys) {
  const pub = unb64u(keys.publicKey);
  return crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  });
}

/** The VAPID Authorization header for a push service: an ES256 JWT for its origin, valid 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** The fixed parts of an encryption, injectable so tests can replay RFC 8291's example. */
export interface EncryptSeed {
  salt: Buffer;
  /** The sender's one-off ECDH private key. */
  senderKey: Buffer;
}

const RECORD_SIZE = 4096;

/** The push message body: a single aes128gcm record for this subscription's keys (RFC 8291 §3, RFC 8188 §2). */
export function encryptPayload(sub: PushSub, plaintext: Buffer, seed?: EncryptSeed): Buffer {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (seed) ecdh.setPrivateKey(seed.senderKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = seed?.salt ?? crypto.randomBytes(16);
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02: the padding delimiter of the last (here the only) record.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

/** Everything one push needs: POST `body` to `url` with `headers`. */
export function pushRequest(sub: PushSub, payload: string, keys: VapidKeys, subject: string, now = Date.now()) {
  return {
    url: sub.endpoint,
    headers: {
      Authorization: vapidAuthorization(sub.endpoint, keys, subject, now),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'high',
    },
    body: encryptPayload(sub, Buffer.from(payload, 'utf8')),
  };
}
