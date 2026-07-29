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
    updateFieldsSettings: vi.fn(),
    assistSettings: vi.fn(),
    assistStatus: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGet = api.getSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateProfile = api.updateProfileSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateConfig = api.updateConfigSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateMedia = api.updateMediaSettings as unknown as ReturnType<typeof vi.fn>;
const mockUpdateFields = api.updateFieldsSettings as unknown as ReturnType<typeof vi.fn>;
const mockAssist = api.assistSettings as unknown as ReturnType<typeof vi.fn>;
const mockAssistStatus = api.assistStatus as unknown as ReturnType<typeof vi.fn>;

const PROFILE = {
  businessName: 'Tapicería Demo',
  businessDomain: 'tapicería de muebles',
  welcome: '¡Hola!',
  vars: { tone: 'cercano', coreInstructions: 'haz X', hardRules: 'nunca inventes precios' },
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
const MEDIA = { describeImages: false, transcribeAudio: true, editImages: false, followUpEnabled: false, skills: ['ventas'] };
const AVAILABLE_SKILLS = [
  { name: 'ventas', title: 'Venta consultiva', description: 'Cerrar sin presionar.' },
];
const FIELDS = [
  {
    key: 'client',
    label: 'Cliente',
    fields: [{ key: 'name', label: 'Nombre', type: 'string' as const, required: true }],
  },
];

beforeEach(() => {
  for (const m of [mockGet, mockUpdateProfile, mockUpdateConfig, mockUpdateMedia, mockUpdateFields, mockAssist, mockAssistStatus]) m.mockReset();
  mockGet.mockResolvedValue({
    profile: structuredClone(PROFILE),
    config: structuredClone(CONFIG),
    media: { ...MEDIA },
    availableSkills: structuredClone(AVAILABLE_SKILLS),
    fields: structuredClone(FIELDS),
  });
  mockUpdateProfile.mockResolvedValue({ ok: true, profile: structuredClone(PROFILE) });
  mockUpdateConfig.mockResolvedValue({ ok: true, config: structuredClone(CONFIG) });
  mockUpdateMedia.mockResolvedValue({ ok: true, media: { ...MEDIA, describeImages: true } });
  mockUpdateFields.mockResolvedValue({ ok: true, fields: structuredClone(FIELDS) });
  mockAssistStatus.mockResolvedValue({ available: false });
});

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

/** Cambia de pestaña por su etiqueta visible. */
function goTo(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

test('abre en "Tu negocio" con los datos cargados', async () => {
  renderSettings();
  expect(await screen.findByDisplayValue('Tapicería Demo')).toBeInTheDocument();
  expect(screen.getByDisplayValue('tapicería de muebles')).toBeInTheDocument();
});

test('las instrucciones internas NO se ven en las pestañas del día a día', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  // El wall de texto de coreInstructions no aparece hasta entrar en Avanzado.
  expect(screen.queryByDisplayValue('haz X')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('nunca inventes precios')).not.toBeInTheDocument();

  goTo('Avanzado');
  expect(screen.getByDisplayValue('haz X')).toBeInTheDocument();
  expect(screen.getByDisplayValue('nunca inventes precios')).toBeInTheDocument();
  // Y con una advertencia, no como un campo cualquiera.
  expect(screen.getByText(/cambia cómo razona el asistente/i)).toBeInTheDocument();
});

test('el tono sí se edita en "Cómo atiende", no en Avanzado', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Cómo atiende');
  expect(screen.getByDisplayValue('cercano')).toBeInTheDocument();
  goTo('Avanzado');
  expect(screen.queryByDisplayValue('cercano')).not.toBeInTheDocument();
});

test('un preset de tono rellena el campo', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Cómo atiende');
  fireEvent.click(screen.getByRole('button', { name: 'Formal (de usted)' }));
  expect((screen.getByLabelText('Tono personalizado') as HTMLTextAreaElement).value).toMatch(/usted/);
});

test('editar el nombre y guardar llama a updateProfileSettings', async () => {
  renderSettings();
  const nameInput = await screen.findByDisplayValue('Tapicería Demo');
  fireEvent.change(nameInput, { target: { value: 'Tapicería Nueva' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  expect(mockUpdateProfile.mock.calls[0][0].businessName).toBe('Tapicería Nueva');
});

test('editar los campos del intake y guardar llama a updateFieldsSettings', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Qué datos pides');

  fireEvent.change(screen.getByLabelText(/Etiqueta del dato 1 de Cliente/), {
    target: { value: 'Nombre completo' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Guardar los datos que pides/ }));
  await waitFor(() => expect(mockUpdateFields).toHaveBeenCalledTimes(1));

  const sent = mockUpdateFields.mock.calls[0][0];
  expect(sent[0].fields[0].label).toBe('Nombre completo');
  // Renombrar NO cambia la clave: es la identidad con la que ya se guardaron datos.
  expect(sent[0].fields[0].key).toBe('name');
});

test('añadir un dato lo crea con una clave válida', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Qué datos pides');

  fireEvent.click(screen.getByRole('button', { name: /Añadir dato a «Cliente»/ }));
  fireEvent.change(screen.getByLabelText(/Etiqueta del dato 2 de Cliente/), {
    target: { value: 'Ciudad o zona' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Guardar los datos que pides/ }));
  await waitFor(() => expect(mockUpdateFields).toHaveBeenCalledTimes(1));

  const sent = mockUpdateFields.mock.calls[0][0];
  expect(sent[0].fields).toHaveLength(2);
  expect(sent[0].fields[1].key).toMatch(/^[a-z_][a-z0-9_]*$/);
});

test('quitar un dato avisa de la consecuencia antes de hacerlo', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Qué datos pides');

  fireEvent.click(screen.getByRole('button', { name: 'Quitar Nombre' }));
  expect(screen.getByText(/deja de verse/)).toBeInTheDocument();
});

test('elegir "Lista de opciones" siembra opciones para que el campo sea válido', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Qué datos pides');

  fireEvent.change(screen.getByLabelText('Tipo de Nombre'), { target: { value: 'enum' } });
  const options = screen.getByLabelText('Opciones de Nombre') as HTMLTextAreaElement;
  expect(options.value.split('\n').filter(Boolean).length).toBeGreaterThan(0);
});

test('los toggles de medios y seguimiento viven en "Cómo atiende"', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Cómo atiende');

  expect(screen.getByLabelText(/Entender las fotos/)).not.toBeChecked();
  expect(screen.getByLabelText(/Escuchar las notas de voz/)).toBeChecked();
  expect(screen.getByLabelText(/Dar seguimiento a los clientes/)).not.toBeChecked();

  fireEvent.click(screen.getByLabelText(/Entender las fotos/));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(mockUpdateMedia).toHaveBeenCalledTimes(1));
  expect(mockUpdateMedia.mock.calls[0][0].describeImages).toBe(true);
});

test('el ayudante no se ofrece si no hay modelo disponible', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  expect(screen.queryByRole('button', { name: /Proponer bienvenida/ })).not.toBeInTheDocument();
});

test('con modelo disponible, la propuesta se aplica al formulario sin guardarla', async () => {
  mockAssistStatus.mockResolvedValue({ available: true });
  mockAssist.mockResolvedValue({ ok: true, suggestion: { welcome: '¡Hola! Soy el asistente de Tapicería Demo.' } });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');

  const btn = await screen.findByRole('button', { name: /Proponer bienvenida/ });
  fireEvent.click(btn);

  await waitFor(() =>
    expect(screen.getByDisplayValue('¡Hola! Soy el asistente de Tapicería Demo.')).toBeInTheDocument(),
  );
  // La propuesta NO se guarda sola: el dueño la revisa y pulsa Guardar.
  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

test('los datos del negocio propuestos se añaden a los que ya había', async () => {
  mockAssistStatus.mockResolvedValue({ available: true });
  mockAssist.mockResolvedValue({
    ok: true,
    suggestion: { facts: [{ topic: 'horarios', answer: 'Lunes a viernes de 9 a 7.' }] },
  });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Lo que debe saber');

  fireEvent.change(screen.getByLabelText(/Cuéntamelo y yo lo ordeno/), {
    target: { value: 'Abrimos de lunes a viernes de 9 a 7.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ordenar en datos' }));

  await waitFor(() => expect(screen.getByDisplayValue('horarios')).toBeInTheDocument());
  // El dato que ya existía sigue ahí.
  expect(screen.getByDisplayValue('ubicación')).toBeInTheDocument();
});

test('sin fila de media (tenant legado) no muestra sus toggles', async () => {
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: structuredClone(CONFIG), media: null, fields: structuredClone(FIELDS) });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Cómo atiende');
  expect(screen.queryByLabelText(/Entender las fotos/)).not.toBeInTheDocument();
});

test('config null (global) → la sección Sistema no aparece ni en Avanzado', async () => {
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: null, media: { ...MEDIA }, availableSkills: structuredClone(AVAILABLE_SKILLS), fields: structuredClone(FIELDS) });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Avanzado');
  expect(screen.queryByText('Sistema')).not.toBeInTheDocument();
});

test('editar el modelo y guardar llama a updateConfigSettings', async () => {
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  goTo('Avanzado');
  fireEvent.change(screen.getByDisplayValue('openai/gpt-4o-mini'), { target: { value: 'openai/gpt-4o' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar sistema' }));
  await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
  expect(mockUpdateConfig.mock.calls[0][0].model).toBe('openai/gpt-4o');
});
