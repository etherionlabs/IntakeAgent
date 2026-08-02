import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { vi, beforeEach, test, expect } from 'vitest';
import ConfigChat, { emptyChat, type ChatState } from './ConfigChat';
import type { ConfigSnapshot } from '../api/client';

vi.mock('../api/client', () => ({ api: { assistChat: vi.fn() } }));

import { api } from '../api/client';
const mockChat = api.assistChat as unknown as ReturnType<typeof vi.fn>;

const SNAPSHOT: ConfigSnapshot = {
  businessName: 'Tapicería Demo',
  businessDomain: 'tapicería',
  welcome: '',
  tone: '',
  freeContext: '',
  facts: [],
  sections: [],
};

beforeEach(() => mockChat.mockReset());

/**
 * El hilo lo lleva la página, así que el test hace de página: guarda el estado
 * y lo vuelve a pintar, igual que Settings.
 */
function setup(props: Partial<Parameters<typeof ConfigChat>[0]> = {}) {
  const onPatch = vi.fn();
  const onSaveAll = vi.fn();

  function Host() {
    const [state, setState] = useState<ChatState>(emptyChat);
    return (
      <ConfigChat
        snapshot={SNAPSHOT}
        state={state}
        onState={setState}
        onPatch={onPatch}
        onSaveAll={onSaveAll}
        saving={false}
        dirty={false}
        {...props}
      />
    );
  }
  render(<Host />);
  return { onPatch, onSaveAll };
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Escríbele a tu asistente'), { target: { value: text } });
}

test('abre saludando con el nombre del negocio, sin llamar al modelo', () => {
  setup();
  expect(screen.getByText(/Tapicería Demo/)).toBeTruthy();
  expect(mockChat).not.toHaveBeenCalled();
});

test('manda el turno con el historial y aplica lo propuesto al formulario', async () => {
  mockChat.mockResolvedValue({
    ok: true,
    reply: '¿Qué necesitas saber de cada cliente?',
    patch: { businessDomain: 'tapicería de sillones' },
    done: false,
  });
  const { onPatch } = setup();

  type('tapizamos sillones');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

  await waitFor(() => expect(screen.getByText('¿Qué necesitas saber de cada cliente?')).toBeTruthy());
  expect(onPatch).toHaveBeenCalledWith({ businessDomain: 'tapicería de sillones' });

  // El hilo que viaja al modelo incluye el saludo inicial y lo que escribió el dueño.
  const [turns, snapshot] = mockChat.mock.calls[0];
  expect(turns).toHaveLength(2);
  expect(turns[1]).toEqual({ role: 'user', content: 'tapizamos sillones' });
  expect(snapshot).toEqual(SNAPSHOT);

  // Se dice qué se tocó: aplicar cambios en silencio sería magia.
  expect(screen.getByText(/Apliqué a qué se dedica al formulario/)).toBeTruthy();
});

test('un turno sin propuesta no anuncia cambios', async () => {
  mockChat.mockResolvedValue({ ok: true, reply: '¿Cobras anticipo?', patch: null, done: false });
  const { onPatch } = setup();

  type('listo');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

  await waitFor(() => expect(screen.getByText('¿Cobras anticipo?')).toBeTruthy());
  expect(onPatch).not.toHaveBeenCalled();
  expect(screen.queryByText(/Apliqué/)).toBeNull();
});

test('si el modelo falla, el mensaje del dueño no se pierde y puede reintentar', async () => {
  mockChat.mockRejectedValueOnce(new Error('no se pudo continuar'));
  setup();

  type('abrimos de 9 a 7');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText('abrimos de 9 a 7')).toBeTruthy();

  mockChat.mockResolvedValue({ ok: true, reply: 'Anotado.', patch: null, done: false });
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(screen.getByText('Anotado.')).toBeTruthy());

  // El reintento manda el mismo hilo, no lo duplica.
  expect(mockChat.mock.calls[1][0]).toHaveLength(2);
});

test('no envía mensajes vacíos', () => {
  setup();
  expect(screen.getByRole('button', { name: 'Enviar' }).hasAttribute('disabled')).toBe(true);
  type('   ');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  expect(mockChat).not.toHaveBeenCalled();
});

test('con cambios sin guardar ofrece guardar todo', () => {
  const { onSaveAll } = setup({ dirty: true });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar todo' }));
  expect(onSaveAll).toHaveBeenCalled();
});

test('sin cambios pendientes no hay botón de guardar', () => {
  setup();
  expect(screen.queryByRole('button', { name: 'Guardar todo' })).toBeNull();
});

test('tras enviar, el cuadro de texto queda vacío', async () => {
  // La respuesta llega después: si el turno se escribe leyendo el estado de
  // cuando se envió, el borrador ya enviado reaparece al recibir la respuesta.
  mockChat.mockResolvedValue({ ok: true, reply: 'Anotado.', patch: null, done: false });
  setup();

  type('abrimos de 9 a 7');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  await waitFor(() => expect(screen.getByText('Anotado.')).toBeTruthy());

  expect((screen.getByLabelText('Escríbele a tu asistente') as HTMLTextAreaElement).value).toBe('');
});
