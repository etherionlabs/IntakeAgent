import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Contacts from './Contacts';

vi.mock('../api/client', () => ({
  api: {
    getContacts: vi.fn(),
    toggleContact: vi.fn(),
    updateContact: vi.fn(),
    archiveContact: vi.fn(),
    restoreContact: vi.fn(),
    deleteContact: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGetContacts = api.getContacts as unknown as ReturnType<typeof vi.fn>;
const mockToggleContact = api.toggleContact as unknown as ReturnType<typeof vi.fn>;
const mockUpdateContact = api.updateContact as unknown as ReturnType<typeof vi.fn>;
const mockDeleteContact = api.deleteContact as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetContacts.mockReset();
  mockToggleContact.mockReset();
  mockUpdateContact.mockReset();
  mockDeleteContact.mockReset();
  mockUpdateContact.mockResolvedValue({ ok: true, contact: { id: 'c1', phoneE164: '+34111', displayName: 'Nuevo', botActive: true, flaggedNonIntake: false } });
  mockDeleteContact.mockResolvedValue({ ok: true });

  mockGetContacts.mockResolvedValue({
    contacts: [
      {
        id: 'c1', phoneE164: '+34111', displayName: 'Ana', botActive: true, flaggedNonIntake: false,
        jobCount: 3, openJobCount: 1,
        lastMessageAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
        lastJobId: 'j1',
      },
      { id: 'c2', phoneE164: '+34222', displayName: 'Beto', botActive: false, flaggedNonIntake: false, jobCount: 0, openJobCount: 0, lastMessageAt: null, lastJobId: null },
      {
        id: 'c3', phoneE164: '+34333', displayName: 'Cleo', botActive: false,
        flaggedNonIntake: true, flaggedReason: 'spam',
        jobCount: 1, openJobCount: 0, lastMessageAt: null, lastJobId: null,
      },
    ],
  });

  mockToggleContact.mockResolvedValue({
    ok: true,
    contact: { id: 'c1', phoneE164: '+34111', displayName: 'Ana', botActive: false, flaggedNonIntake: false },
  });
});

function renderContacts() {
  return render(
    <MemoryRouter>
      <Contacts />
    </MemoryRouter>,
  );
}

/** Abre el menú ⋯ de la fila de un contacto y devuelve la fila. */
async function openRowMenu(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: new RegExp(`Acciones de ${name}`) }));
  return row;
}

test('muestra el estado de cada contacto', async () => {
  renderContacts();
  const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
  const beto = (await screen.findByText('Beto')).closest('tr') as HTMLElement;
  // "Spam" también es un filtro de la barra: acotamos a la fila del contacto.
  const cleo = (await screen.findByText('Cleo')).closest('tr') as HTMLElement;
  expect(within(ana).getByText('Activo')).toBeInTheDocument();
  expect(within(beto).getByText('Pausado')).toBeInTheDocument();
  expect(within(cleo).getByText('Spam')).toBeInTheDocument();
});

test('muestra el contexto de cada contacto: trabajos y última actividad', async () => {
  renderContacts();
  const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
  // Enlaza a sus trabajos filtrados en el tablero.
  const jobsLink = within(ana).getByRole('link', { name: /3 trabajos/ });
  expect(jobsLink).toHaveAttribute('href', '/?contact=c1');
  expect(within(ana).getByText(/1 abierto/)).toBeInTheDocument();
  // Y la última actividad entra directo a su conversación.
  expect(within(ana).getByRole('link', { name: /hace 2 h/ })).toHaveAttribute('href', '/jobs/j1');

  // Sin trabajos no inventa enlaces.
  const beto = (await screen.findByText('Beto')).closest('tr') as HTMLElement;
  expect(within(beto).queryByRole('link')).not.toBeInTheDocument();
});

test('las acciones secundarias viven en el menú de la fila, no sueltas', async () => {
  renderContacts();
  await screen.findByText('Ana');
  // Ninguna acción destructiva visible antes de abrir el menú.
  expect(screen.queryByRole('button', { name: 'Eliminar…' })).not.toBeInTheDocument();

  await openRowMenu('Ana');
  expect(screen.getByRole('menuitem', { name: 'Editar nombre' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Pausar el asistente' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Archivar' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Eliminar…' })).toBeInTheDocument();
});

test('pausar el asistente de un contacto activo llama toggleContact(id, true)', async () => {
  renderContacts();
  await openRowMenu('Ana');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pausar el asistente' }));
  expect(mockToggleContact).toHaveBeenCalledWith('c1', true);
});

test('un contacto marcado como spam ofrece quitarle la marca', async () => {
  renderContacts();
  await openRowMenu('Cleo');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Ya no es spam' }));
  expect(mockUpdateContact).toHaveBeenCalledWith('c3', { unflag: true });
});

test('editar nombre llama updateContact con displayName', async () => {
  renderContacts();
  const anaRow = await openRowMenu('Ana');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Editar nombre' }));
  const input = within(anaRow).getByLabelText('Nombre') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Nuevo' } });
  fireEvent.click(within(anaRow).getByRole('button', { name: 'Guardar' }));
  expect(mockUpdateContact).toHaveBeenCalledWith('c1', { displayName: 'Nuevo' });
});

test('eliminar pide confirmación fuerte y llama deleteContact', async () => {
  renderContacts();
  await openRowMenu('Ana');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar…' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar definitivamente' }));
  expect(mockDeleteContact).toHaveBeenCalledWith('c1');
});

test('el buscador filtra por nombre y por teléfono, ignorando el formato', async () => {
  renderContacts();
  await screen.findByText('Ana');
  const search = screen.getByLabelText('Buscar contactos');

  fireEvent.change(search, { target: { value: 'bet' } });
  expect(screen.getByText('Beto')).toBeInTheDocument();
  expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  expect(screen.getByText('1 de 3 contactos')).toBeInTheDocument();

  // Teléfono con separadores: la búsqueda los ignora.
  fireEvent.change(search, { target: { value: '+34 333' } });
  expect(screen.getByText('Cleo')).toBeInTheDocument();
  expect(screen.queryByText('Beto')).not.toBeInTheDocument();
});

test('los filtros de estado acotan la lista', async () => {
  renderContacts();
  await screen.findByText('Ana');

  fireEvent.click(screen.getByRole('button', { name: 'Pausados' }));
  expect(await screen.findByText('Beto')).toBeInTheDocument();
  expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  expect(screen.queryByText('Cleo')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Spam' }));
  expect(await screen.findByText('Cleo')).toBeInTheDocument();
  expect(screen.queryByText('Beto')).not.toBeInTheDocument();
});

test('sin coincidencias lo dice en vez de mostrar una tabla vacía', async () => {
  renderContacts();
  await screen.findByText('Ana');
  fireEvent.change(screen.getByLabelText('Buscar contactos'), { target: { value: 'zzzz' } });
  expect(screen.getByText(/Ningún contacto coincide/)).toBeInTheDocument();
});

test('solo pide archivados al servidor cuando el filtro los necesita', async () => {
  renderContacts();
  await screen.findByText('Ana');
  mockGetContacts.mockClear();

  fireEvent.click(screen.getByRole('button', { name: 'Activos' }));
  await waitFor(() => expect(mockGetContacts).toHaveBeenCalledWith(false));

  fireEvent.click(screen.getByRole('button', { name: 'Archivados' }));
  await waitFor(() => expect(mockGetContacts).toHaveBeenCalledWith(true));
});
