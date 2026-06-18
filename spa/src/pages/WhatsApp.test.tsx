import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import WhatsApp from './WhatsApp';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test-qr'),
  },
}));

vi.mock('../api/client', () => ({
  api: {
    getWaStatus: vi.fn(),
    waLogout: vi.fn(),
    waReconnect: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGetWaStatus = api.getWaStatus as unknown as ReturnType<typeof vi.fn>;
const mockWaLogout = api.waLogout as unknown as ReturnType<typeof vi.fn>;
const mockWaReconnect = api.waReconnect as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  mockGetWaStatus.mockReset();
  mockWaLogout.mockReset();
  mockWaReconnect.mockReset();
  mockGetWaStatus.mockResolvedValue({ connected: true, qr: null, phone: '+5215555555555' });
  mockWaLogout.mockResolvedValue({ ok: true });
  mockWaReconnect.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

test('shows "Conectado" when getWaStatus returns connected:true', async () => {
  render(
    <MemoryRouter>
      <WhatsApp />
    </MemoryRouter>,
  );

  // resolve the initial fetch promise without advancing the 5s interval
  await vi.waitFor(() => {
    expect(screen.getByText('Conectado')).toBeInTheDocument();
  });
  expect(screen.getByText(/\+5215555555555/)).toBeInTheDocument();
});

test('renders the WhatsApp QR value as an image when disconnected', async () => {
  mockGetWaStatus.mockResolvedValue({
    connected: false,
    qr: 'whatsapp-qr-payload',
    phone: '',
  });

  render(
    <MemoryRouter>
      <WhatsApp />
    </MemoryRouter>,
  );

  await vi.waitFor(() => {
    expect(
      screen.getByRole('img', { name: /codigo qr para conectar whatsapp/i }),
    ).toHaveAttribute('src', 'data:image/png;base64,test-qr');
  });

  expect(screen.queryByText('whatsapp-qr-payload')).not.toBeInTheDocument();
});

test('Reconectar llama waReconnect', async () => {
  render(
    <MemoryRouter>
      <WhatsApp />
    </MemoryRouter>,
  );
  let btn: HTMLElement;
  await vi.waitFor(() => {
    btn = screen.getByRole('button', { name: 'Reconectar' });
  });
  fireEvent.click(btn!);
  expect(mockWaReconnect).toHaveBeenCalled();
});

test('Desvincular pide confirmación y llama waLogout', async () => {
  render(
    <MemoryRouter>
      <WhatsApp />
    </MemoryRouter>,
  );
  await vi.waitFor(() => {
    screen.getByRole('button', { name: 'Desvincular' });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }));
  fireEvent.click(screen.getByRole('button', { name: 'Desvincular definitivamente' }));
  expect(mockWaLogout).toHaveBeenCalled();
});
