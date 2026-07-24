import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import MessageList, { type Message } from './MessageList';

vi.mock('../api/client', () => ({
  mediaUrl: (id: string) => `/api/messages/${id}/media`,
}));

test('renderiza una imagen para mensajes kind=image con mediaPath', () => {
  const messages: Message[] = [
    { id: 'm1', direction: 'inbound', kind: 'text', body: 'Hola' },
    { id: 'm2', direction: 'outbound', kind: 'image', body: 'Previsualización', mediaPath: 'c/j/m2.png' },
  ];
  render(<MessageList messages={messages} />);
  const img = screen.getByRole('img', { name: /imagen del mensaje/i }) as HTMLImageElement;
  expect(img).toBeInTheDocument();
  expect(img.getAttribute('src')).toBe('/api/messages/m2/media');
  // El texto/caption sigue mostrándose junto a la imagen.
  expect(screen.getByText('Previsualización')).toBeInTheDocument();
});

test('no renderiza imagen para kind=image sin mediaPath (legado)', () => {
  const messages: Message[] = [
    { id: 'm1', direction: 'inbound', kind: 'image', body: 'foto vieja', mediaPath: null },
  ];
  render(<MessageList messages={messages} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('oculta la imagen si el archivo falla al cargar', () => {
  const messages: Message[] = [
    { id: 'm2', direction: 'outbound', kind: 'image', body: 'x', mediaPath: 'c/j/m2.png' },
  ];
  render(<MessageList messages={messages} />);
  const img = screen.getByRole('img');
  fireEvent.error(img);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
