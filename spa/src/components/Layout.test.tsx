import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, expect } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import Layout from './Layout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('intake_token', 'tok123');
});

test('renders the nav links', () => {
  renderLayout();
  expect(screen.getByRole('link', { name: 'Jobs' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contactos' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Uso' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
});

test('clicking logout clears the token', () => {
  renderLayout();
  expect(localStorage.getItem('intake_token')).toBe('tok123');
  fireEvent.click(screen.getByRole('button', { name: /salir/i }));
  expect(localStorage.getItem('intake_token')).toBeNull();
});
