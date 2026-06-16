import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Settings from './Settings';

vi.mock('../api/client', () => ({
  api: {
    getSettings: vi.fn(),
    updateProfileSettings: vi.fn(),
    updateConfigSettings: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGet = api.getSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateProfile = api.updateProfileSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateConfig = api.updateConfigSettings as unknown as ReturnType<typeof vi.fn>;

const PROFILE = {
  businessName: 'Tapicería Demo',
  businessDomain: 'tapicería de muebles',
  welcome: '¡Hola!',
  vars: { tone: 'cercano', coreInstructions: 'haz X' },
  businessFacts: {
    facts: [{ topic: 'ubicación', aliases: [], answer: 'Centro' }],
    freeContext: 'contexto',
  },
};

const CONFIG = {
  model: 'openai/gpt-4o-mini',
  temperature: 0.4,
  maxSteps: 6,
  hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
  owner: { phoneE164: '+13058799511', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
  limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
};

beforeEach(() => {
  mockGet.mockReset();
  mockUpdateProfile.mockReset();
  mockUpdateConfig.mockReset();
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: structuredClone(CONFIG) });
  mockUpdateProfile.mockResolvedValue({ ok: true, profile: structuredClone(PROFILE) });
  mockUpdateConfig.mockResolvedValue({ ok: true, config: structuredClone(CONFIG) });
});

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

test('carga y muestra perfil + config', async () => {
  renderSettings();
  expect(await screen.findByDisplayValue('Tapicería Demo')).toBeInTheDocument();
  expect(screen.getByDisplayValue('openai/gpt-4o-mini')).toBeInTheDocument();
  expect(screen.getByDisplayValue('cercano')).toBeInTheDocument();
});

test('editar el nombre y guardar llama a updateProfileSettings', async () => {
  renderSettings();
  const nameInput = await screen.findByDisplayValue('Tapicería Demo');
  fireEvent.change(nameInput, { target: { value: 'Tapicería Nueva' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar negocio' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  expect(mockUpdateProfile.mock.calls[0][0].businessName).toBe('Tapicería Nueva');
});

test('editar el modelo y guardar llama a updateConfigSettings', async () => {
  renderSettings();
  const modelInput = await screen.findByDisplayValue('openai/gpt-4o-mini');
  fireEvent.change(modelInput, { target: { value: 'openai/gpt-4o' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar sistema' }));
  await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
  expect(mockUpdateConfig.mock.calls[0][0].model).toBe('openai/gpt-4o');
});
