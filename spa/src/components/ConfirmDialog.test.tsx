import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import ConfirmDialog from './ConfirmDialog';

test('muestra el mensaje y llama onConfirm al confirmar', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog open title="Eliminar" message="¿Seguro?" confirmLabel="Eliminar" onConfirm={onConfirm} onCancel={onCancel} />,
  );
  expect(screen.getByText('¿Seguro?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

test('no renderiza nada si open=false', () => {
  const { container } = render(
    <ConfirmDialog open={false} title="x" message="y" confirmLabel="z" onConfirm={() => {}} onCancel={() => {}} />,
  );
  expect(container).toBeEmptyDOMElement();
});
