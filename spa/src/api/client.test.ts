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

  it('NO envía content-type cuando no hay body (evita 400 de Fastify en DELETE)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.deleteContact('c1');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
    expect(opts.headers['content-type']).toBeUndefined();
  });

  it('POST sin body (desvincular WhatsApp) tampoco manda content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.waLogout();
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeUndefined();
    expect(opts.headers['content-type']).toBeUndefined();
  });

  it('SÍ envía content-type cuando hay body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true, contact: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await api.updateContact('c1', { displayName: 'X' });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.headers['content-type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ displayName: 'X' }));
  });
});
