import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, type SecretPayload } from './crypto';

const payload: SecretPayload = {
  pat: 'github_pat_example_token_value',
  owner: 'someowner',
  repo: 'some-private-repo',
  displayName: 'Test User',
  role: 'parent',
};

describe('crypto', () => {
  it('round-trips a secret payload with the correct passphrase', async () => {
    const bundle = await encryptSecret(payload, 'correct horse battery staple');
    const out = await decryptSecret(bundle, 'correct horse battery staple');
    expect(out).toEqual(payload);
  });

  it('produces opaque ciphertext that does not contain plaintext', async () => {
    const bundle = await encryptSecret(payload, 'pw');
    const blob = JSON.stringify(bundle);
    expect(blob).not.toContain(payload.pat);
    expect(blob).not.toContain(payload.owner);
    expect(blob).not.toContain(payload.repo);
    expect(blob).not.toContain(payload.displayName);
  });

  it('rejects a wrong passphrase', async () => {
    const bundle = await encryptSecret(payload, 'right');
    await expect(decryptSecret(bundle, 'wrong')).rejects.toThrow(/wrong passphrase/);
  });

  it('uses a fresh salt + iv per encryption', async () => {
    const a = await encryptSecret(payload, 'pw');
    const b = await encryptSecret(payload, 'pw');
    expect(a.salt).not.toEqual(b.salt);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });
});
