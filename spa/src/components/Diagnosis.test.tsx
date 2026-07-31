import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import Diagnosis from './Diagnosis';

test('sin diagnóstico lo dice en vez de mostrar una caja vacía', () => {
  render(<Diagnosis diagnosis={null} />);
  expect(screen.getByText(/aún no ha profundizado/i)).toBeInTheDocument();
});

test('un diagnóstico con solo objeciones vacías también cuenta como vacío', () => {
  render(<Diagnosis diagnosis={{ objections: [] }} />);
  expect(screen.getByText(/aún no ha profundizado/i)).toBeInTheDocument();
});

test('muestra el problema, lo que le cuesta y la urgencia', () => {
  render(
    <Diagnosis
      diagnosis={{
        pain: 'la tela del sillón ya está rota',
        implication: 'le da pena recibir visitas',
        urgency: 'alta',
      }}
    />,
  );
  expect(screen.getByText('la tela del sillón ya está rota')).toBeInTheDocument();
  expect(screen.getByText('le da pena recibir visitas')).toBeInTheDocument();
  expect(screen.getByText('Le urge')).toBeInTheDocument();
});

test('avisa cuántas dudas siguen sin resolver, que es lo que tumba el trato', () => {
  render(
    <Diagnosis
      diagnosis={{
        pain: 'x',
        objections: [
          { type: 'precio', note: 'lo compara con otra cotización', resolved: false },
          { type: 'tiempo', note: 'lo necesita antes del sábado', resolved: true },
        ],
      }}
    />,
  );
  expect(screen.getByText(/1 duda del cliente sin resolver/)).toBeInTheDocument();
  expect(screen.getByText('lo compara con otra cotización')).toBeInTheDocument();
  expect(screen.getByText('Precio')).toBeInTheDocument();
  // La resuelta se muestra, pero sin la alarma.
  expect(screen.getByText('lo necesita antes del sábado')).toBeInTheDocument();
  expect(screen.getAllByText('sin resolver')).toHaveLength(1);
});

test('con todas las dudas resueltas no hay alarma', () => {
  render(
    <Diagnosis
      diagnosis={{
        pain: 'x',
        objections: [{ type: 'precio', note: 'ya entendió el alcance', resolved: true }],
      }}
    />,
  );
  expect(screen.queryByText(/sin resolver/)).not.toBeInTheDocument();
});
