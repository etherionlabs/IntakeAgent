import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import Opportunities, { type Opportunity } from './Opportunities';

test('lista los servicios adicionales con su estado', () => {
  const items: Opportunity[] = [
    { service: 'polarizado 20%', status: 'accepted' },
    { service: 'protección cerámica', status: 'declined', note: 'lo ve caro' },
    { service: 'PPF en el frente', status: 'offered' },
  ];
  render(<Opportunities items={items} />);
  expect(screen.getByText('polarizado 20%')).toBeInTheDocument();
  expect(screen.getByText('Aceptado')).toBeInTheDocument();
  expect(screen.getByText('Rechazado')).toBeInTheDocument();
  expect(screen.getByText('Ofrecido')).toBeInTheDocument();
  expect(screen.getByText('lo ve caro')).toBeInTheDocument();
});

test('avisa cuántos extras hay que meter en la cotización', () => {
  const items: Opportunity[] = [
    { service: 'polarizado 20%', status: 'accepted' },
    { service: 'PPF en el frente', status: 'accepted' },
  ];
  render(<Opportunities items={items} />);
  expect(screen.getByText(/aceptó 2 servicios adicionales/i)).toBeInTheDocument();
});

test('pone los aceptados antes que los rechazados', () => {
  const items: Opportunity[] = [
    { service: 'rechazado-x', status: 'declined' },
    { service: 'ofrecido-y', status: 'offered' },
    { service: 'aceptado-z', status: 'accepted' },
  ];
  render(<Opportunities items={items} />);
  const rendered = screen.getAllByText(/^(rechazado-x|ofrecido-y|aceptado-z)$/).map((el) => el.textContent);
  expect(rendered).toEqual(['aceptado-z', 'ofrecido-y', 'rechazado-x']);
});

test('sin extras muestra el estado vacío y ninguna alerta de cotización', () => {
  render(<Opportunities items={[]} />);
  expect(screen.getByText(/aún no ha ofrecido servicios adicionales/i)).toBeInTheDocument();
  expect(screen.queryByText(/cotización/i)).not.toBeInTheDocument();
});
