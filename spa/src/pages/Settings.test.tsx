import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Settings from './Settings';

vi.mock('../api/client', () => ({
  api: {
    getSettings: vi.fn(),
    updateProfileSettings: vi.fn(),
    updateConfigSettings: vi.fn(),
    updateMediaSettings: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGet = api.getSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateProfile = api.updateProfileSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateConfig = api.updateConfigSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateMedia = api.updateMediaSettings as unknown as ReturnType<typeof vi.fn>;

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
const MEDIA = { describeImages: false, transcribeAudio: true, editImages: false, skills: ['ventas'] };
const AVAILABLE_SKILLS = [
  { name: 'ventas', title: 'Venta consultiva', description: 'Cerrar sin presionar.' },
];

beforeEach(() => {
  mockGet.mockReset();
  mockUpdateProfile.mockReset();
  mockUpdateConfig.mockReset();
  mockUpdateMedia.mockReset();
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: structuredClone(CONFIG), media: { ...MEDIA }, availableSkills: structuredClone(AVAILABLE_SKILLS) });
  mockUpdateProfile.mockResolvedValue({ ok: true, profile: structuredClone(PROFILE) });
  mockUpdateConfig.mockResolvedValue({ ok: true, config: structuredClone(CONFIG) });
  mockUpdateMedia.mockResolvedValue({ ok: true, media: { describeImages: true, transcribeAudio: true, editImages: false, skills: ['ventas'] } });
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

test('muestra los toggles de imágenes y audio', async () => {
  renderSettings();
  const img = await screen.findByLabelText(/Describir las fotos del cliente/);
  expect(img).not.toBeChecked();
  expect(screen.getByLabelText(/Transcribir las notas de voz/)).toBeChecked();
});

test('activar visión y guardar llama a updateMediaSettings', async () => {
  renderSettings();
  const img = await screen.findByLabelText(/Describir las fotos del cliente/);
  fireEvent.click(img);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imágenes y audio' }));
  await waitFor(() => expect(mockUpdateMedia).toHaveBeenCalledTimes(1));
  expect(mockUpdateMedia.mock.calls[0][0]).toEqual({ describeImages: true, transcribeAudio: true, editImages: false, skills: ['ventas'] });
});

test('muestra el selector de skills y alterna una skill al guardar', async () => {
  renderSettings();
  const ventas = await screen.findByLabelText('Venta consultiva');
  expect(ventas).toBeChecked();
  fireEvent.click(ventas); // desmarca
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imágenes y audio' }));
  await waitFor(() => expect(mockUpdateMedia).toHaveBeenCalledTimes(1));
  expect(mockUpdateMedia.mock.calls[0][0].skills).toEqual([]);
});

test('sin fila de media (tenant legado) no muestra la sección', async () => {
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: structuredClone(CONFIG), media: null });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  expect(screen.queryByText('Imágenes y audio')).not.toBeInTheDocument();
});

test('config null (global, no se expone al tenant) → NO muestra la sección Sistema', async () => {
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: null, media: { ...MEDIA }, availableSkills: structuredClone(AVAILABLE_SKILLS) });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  expect(screen.queryByText('Sistema')).not.toBeInTheDocument();
});
