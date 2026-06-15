import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setUnauthorizedHandler } from './client';

function mockResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    setUnauthorizedHandler(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed body on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { token: 'abc', user: { id: '1' } })));
    const res = await api.login('u', 'p');
    expect(res).toEqual({ token: 'abc', user: { id: '1' } });
  });

  it('throws ApiError(400, message) on 400 with {error}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, { error: 'x' })));
    const err = await api.getProfile().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('x');
  });

  it('triggers the unauthorized handler and throws ApiError(401) on 401', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, {})));
    const err = await api.getProfile().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
