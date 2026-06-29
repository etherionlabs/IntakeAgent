import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: { getBillingStatus: vi.fn(), startCheckout: vi.fn(), openBillingPortal: vi.fn() } };
});

import { api } from '../api/client';
import Billing from './Billing';

const mockStatus = api.getBillingStatus as unknown as ReturnType<typeof vi.fn>;
const mockCheckout = api.startCheckout as unknown as ReturnType<typeof vi.fn>;
const mockPortal = api.openBillingPortal as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockStatus.mockReset(); mockCheckout.mockReset(); mockPortal.mockReset();
  // jsdom no implementa navegación; stub de window.location.href
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
});

test('sin suscripción muestra "Suscribirme" y redirige a Checkout', async () => {
  mockStatus.mockResolvedValue({ status: 'none', planName: null });
  mockCheckout.mockResolvedValue({ url: 'https://checkout/x' });
  render(<Billing />);
  const btn = await screen.findByRole('button', { name: /suscribirme/i });
  fireEvent.click(btn);
  await waitFor(() => expect(window.location.href).toBe('https://checkout/x'));
});

test('con suscripción activa muestra estado y "Gestionar facturación"', async () => {
  mockStatus.mockResolvedValue({ status: 'active', planName: 'Plan Test', amountCents: 4900, currency: 'usd', interval: 'month' });
  mockPortal.mockResolvedValue({ url: 'https://portal/y' });
  render(<Billing />);
  expect(await screen.findByTestId('billing-status')).toHaveTextContent('Activa');
  fireEvent.click(screen.getByRole('button', { name: /gestionar facturación/i }));
  await waitFor(() => expect(window.location.href).toBe('https://portal/y'));
});

test('past_due muestra aviso de pago fallido', async () => {
  mockStatus.mockResolvedValue({ status: 'past_due', planName: 'Plan Test' });
  render(<Billing />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/pago falló/i);
});
