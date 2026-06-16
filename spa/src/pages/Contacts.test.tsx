import { render, screen, fireEvent, within } from '@testing-library/react';
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
      { id: 'c1', phoneE164: '+34111', displayName: 'Ana', botActive: true, flaggedNonIntake: false },
      { id: 'c2', phoneE164: '+34222', displayName: 'Beto', botActive: false, flaggedNonIntake: false },
      {
        id: 'c3',
        phoneE164: '+34333',
        displayName: 'Cleo',
        botActive: false,
        flaggedNonIntake: true,
        flaggedReason: 'spam',
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

test('renders the status chips correctly', async () => {
  renderContacts();
  expect(await screen.findByText('Activo')).toBeInTheDocument();
  expect(await screen.findByText('Pausado')).toBeInTheDocument();
  expect(await screen.findByText('No-intake')).toBeInTheDocument();
});

test('toggling the active contact calls toggleContact(id, true)', async () => {
  renderContacts();
  // Ana is active → its button pauses it
  const pauseBtn = await screen.findByRole('button', { name: 'Pausar' });
  fireEvent.click(pauseBtn);
  expect(mockToggleContact).toHaveBeenCalledWith('c1', true);
});

test('editar nombre llama updateContact con displayName', async () => {
  renderContacts();
  const anaRow = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
  fireEvent.click(within(anaRow).getByRole('button', { name: 'Editar' }));
  const input = within(anaRow).getByLabelText('Nombre') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Nuevo' } });
  fireEvent.click(within(anaRow).getByRole('button', { name: 'Guardar' }));
  expect(mockUpdateContact).toHaveBeenCalledWith('c1', { displayName: 'Nuevo' });
});

test('eliminar pide confirmación fuerte y llama deleteContact', async () => {
  renderContacts();
  const anaRow = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
  fireEvent.click(within(anaRow).getByRole('button', { name: 'Eliminar' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar definitivamente' }));
  expect(mockDeleteContact).toHaveBeenCalledWith('c1');
});
