import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: {
      getOnboardingState: vi.fn(),
      patchOnboardingBusiness: vi.fn().mockResolvedValue({ ok: true }),
      patchOnboardingWelcome: vi.fn().mockResolvedValue({ ok: true }),
      startCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/x' }),
    },
  };
});

import { api } from '../api/client';
import Onboarding from './Onboarding';

const mockState = api.getOnboardingState as unknown as ReturnType<typeof vi.fn>;
const mockBusiness = api.patchOnboardingBusiness as unknown as ReturnType<typeof vi.fn>;

function renderOnboarding() {
  return render(<MemoryRouter><Onboarding /></MemoryRouter>);
}

beforeEach(() => { mockState.mockReset(); mockBusiness.mockClear(); });

test('reanuda en el paso del servidor (business) y guarda el negocio', async () => {
  mockState.mockResolvedValue({ step: 'business', tenantStatus: 'active', subStatus: 'active', flags: {} });
  renderOnboarding();
  expect(await screen.findByTestId('onboarding-step')).toHaveTextContent('business');
  fireEvent.change(screen.getByLabelText(/nombre del negocio/i), { target: { value: 'Acme' } });
  fireEvent.click(screen.getByRole('button', { name: /guardar y continuar/i }));
  await waitFor(() => expect(mockBusiness).toHaveBeenCalledWith({ businessName: 'Acme', ownerPhoneE164: undefined }));
});

test('paso subscription muestra "Suscribirme"', async () => {
  mockState.mockResolvedValue({ step: 'subscription', tenantStatus: 'verified', subStatus: null, flags: {} });
  renderOnboarding();
  expect(await screen.findByRole('button', { name: /suscribirme/i })).toBeInTheDocument();
});

test('paso verify_email muestra instrucción de verificar', async () => {
  mockState.mockResolvedValue({ step: 'verify_email', tenantStatus: 'pending_verification', subStatus: null, flags: {} });
  renderOnboarding();
  expect(await screen.findByText(/verifica tu correo/i)).toBeInTheDocument();
});
