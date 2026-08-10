import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { probeNow, getNetState, shouldAttemptNetwork, useNetState } from './net';

const GH_HEADER = 'x-github-request-id';

function ghResponse(): Response {
  return new Response('Design for failure.', {
    status: 200,
    headers: { [GH_HEADER]: 'ABCD:1234' },
  });
}

/** What a captive portal actually does: 200 OK, its own login page. */
function portalResponse(): Response {
  return new Response('<html><body>Sign in to ship WiFi</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

describe('net probe', () => {
  beforeEach(() => {
    useNetState.setState({ state: 'unknown', checkedAt: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports internet when the real API answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ghResponse()));
    expect(await probeNow()).toBe('internet');
    expect(getNetState()).toBe('internet');
  });

  it('is not fooled by a captive portal returning 200 HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(portalResponse()));
    expect(await probeNow()).toBe('no-internet');
  });

  it('treats a non-ok status as no-internet even with the header present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('nope', { status: 503, headers: { [GH_HEADER]: 'X' } }),
      ),
    );
    expect(await probeNow()).toBe('no-internet');
  });

  it('treats a timeout as no-internet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
    );
    expect(await probeNow()).toBe('no-internet');
  });

  it('coalesces concurrent probes into one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ghResponse());
    vi.stubGlobal('fetch', fetchMock);
    const [a, b, c] = await Promise.all([probeNow(), probeNow(), probeNow()]);
    expect([a, b, c]).toEqual(['internet', 'internet', 'internet']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records when the probe last ran', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ghResponse()));
    await probeNow();
    expect(useNetState.getState().checkedAt).toBeTypeOf('number');
  });
});

describe('shouldAttemptNetwork', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('permits attempts once we know we have internet', () => {
    useNetState.setState({ state: 'internet', checkedAt: Date.now() });
    expect(shouldAttemptNetwork()).toBe(true);
  });

  it('blocks attempts once we know we do not', () => {
    useNetState.setState({ state: 'no-internet', checkedAt: Date.now() });
    expect(shouldAttemptNetwork()).toBe(false);
  });

  it('falls back to navigator.onLine before the first probe lands', () => {
    useNetState.setState({ state: 'unknown', checkedAt: null });
    vi.stubGlobal('navigator', { onLine: true });
    expect(shouldAttemptNetwork()).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    expect(shouldAttemptNetwork()).toBe(false);
  });
});
