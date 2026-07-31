import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect } from 'vitest';
import Landing from './Landing';
import Legal from './Legal';

test('la landing vende un asistente que VENDE, no un recepcionista', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: /no solo toma el pedido\. vende\./i })).toBeInTheDocument();
  // Las tres capacidades que sostienen esa promesa.
  expect(screen.getByRole('heading', { name: /ofrece lo que suma/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /da seguimiento solo/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /levanta el trabajo/i })).toBeInTheDocument();
});

test('la landing es honesta sobre los límites antes de registrarte', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByText(/no oficial/i)).toBeInTheDocument();
  expect(screen.getByText(/no cotiza precios/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /política de uso/i })).toHaveAttribute('href', '/whatsapp-policy');
});

test('lleva a crear cuenta', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByRole('link', { name: /empieza gratis/i })).toHaveAttribute('href', '/signup');
  expect(screen.getByRole('link', { name: /crear mi cuenta/i })).toHaveAttribute('href', '/signup');
  expect(screen.getByRole('link', { name: /inicia sesión/i })).toHaveAttribute('href', '/login');
});

test('página legal de whatsapp menciona el riesgo no oficial', () => {
  render(<MemoryRouter><Legal doc="whatsapp_policy" /></MemoryRouter>);
  expect(screen.getByText(/no oficial/i)).toBeInTheDocument();
});
