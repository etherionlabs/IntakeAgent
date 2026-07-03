import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect } from 'vitest';
import Landing from './Landing';
import Legal from './Legal';

test('landing muestra propuesta de valor, precios y CTA a signup', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: /recepcionista de whatsapp/i })).toBeInTheDocument();
  expect(screen.getByText(/precios/i)).toBeInTheDocument();
  const cta = screen.getByRole('link', { name: /empieza gratis/i });
  expect(cta).toHaveAttribute('href', '/signup');
});

test('página legal de whatsapp menciona el riesgo no oficial', () => {
  render(<MemoryRouter><Legal doc="whatsapp_policy" /></MemoryRouter>);
  expect(screen.getByText(/no oficial/i)).toBeInTheDocument();
});
