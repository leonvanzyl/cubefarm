import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkSubscription, checkVapidKeys, encryptPayload, generateVapidKeys, pushRequest, vapidAuthorization } from './webPush.ts';

// RFC 8291 §5 and Appendix A: the example push message, byte for byte.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const rfcSub = { endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };

/** The browser's side: decrypt an aes128gcm body with the subscription's private key (RFC 8291 §3.4 in reverse). */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const sealed = body.subarray(21 + idlen);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(sealed.subarray(-16));
  const padded = Buffer.concat([d.update(sealed.subarray(0, -16)), d.final()]);
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8');
}

describe('push message encryption', () => {
  it("matches RFC 8291's example exactly", () => {
    const body = encryptPayload(rfcSub, Buffer.from(RFC.plaintext), { salt: Buffer.from(RFC.salt, 'base64url'), senderKey: Buffer.from(RFC.asPrivate, 'base64url') });
    expect(body.toString('base64url')).toBe(RFC.body);
  });

  it('decrypts with the subscription keys, with a fresh salt and key every time', () => {
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
    const a = encryptPayload(sub, Buffer.from('{"title":"⚠️ PR #4 needs you"}'));
    const b = encryptPayload(sub, Buffer.from('{"title":"⚠️ PR #4 needs you"}'));
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, ua.getPrivateKey(), ua.getPublicKey(), auth)).toBe('{"title":"⚠️ PR #4 needs you"}');
    expect(a.readUInt32BE(16)).toBe(4096);
  });
});

describe('VAPID', () => {
  it('signs an ES256 JWT for the push service origin that verifies with the public key', () => {
    const keys = generateVapidKeys();
    const now = Date.UTC(2026, 9, 4, 12);
    const auth = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://github.com/leonvanzyl/cubefarm', now);
    const m = auth.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
    expect(m).not.toBeNull();
    const [, header, claims, sig, k] = m!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://github.com/leonvanzyl/cubefarm' });
    const pub = Buffer.from(keys.publicKey, 'base64url');
    const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
    expect(crypto.verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('accepts only a matching key pair read back from disk', () => {
    const keys = generateVapidKeys();
    expect(checkVapidKeys(keys)).toEqual(keys);
    expect(checkVapidKeys({ ...keys, publicKey: generateVapidKeys().publicKey })).toBeNull();
    expect(checkVapidKeys({ publicKey: 'x' })).toBeNull();
    expect(checkVapidKeys(null)).toBeNull();
  });

  it('builds the request a push service expects', () => {
    const req = pushRequest(rfcSub, '{"title":"hi"}', generateVapidKeys(), 'https://github.com/leonvanzyl/cubefarm');
    expect(req.url).toBe(rfcSub.endpoint);
    expect(req.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400', Urgency: 'high' });
    expect(req.headers.Authorization).toMatch(/^vapid t=/);
    expect(decrypt(req.body, Buffer.from(RFC.uaPrivate, 'base64url'), Buffer.from(RFC.uaPublic, 'base64url'), Buffer.from(RFC.auth, 'base64url'))).toBe('{"title":"hi"}');
  });
});

describe('subscriptions from browsers', () => {
  it('keeps a well-formed https subscription and nothing else', () => {
    expect(checkSubscription(rfcSub)).toEqual(rfcSub);
    expect(checkSubscription({ ...rfcSub, extra: 1 })).toEqual(rfcSub);
    expect(checkSubscription({ ...rfcSub, endpoint: 'http://push.example.net/x' })).toBeNull();
    expect(checkSubscription({ ...rfcSub, endpoint: 'not a url' })).toBeNull();
    expect(checkSubscription({ ...rfcSub, keys: { p256dh: RFC.uaPublic, auth: 'short' } })).toBeNull();
    expect(checkSubscription({ ...rfcSub, keys: { p256dh: RFC.auth, auth: RFC.auth } })).toBeNull();
    expect(checkSubscription('nope')).toBeNull();
  });
});
