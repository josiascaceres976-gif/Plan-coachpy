// Corre cada 15 minutos y manda los avisos de comida, entrenamiento, cuotas y recordatorios.
import { correrAvisos } from '../../lib/core.mjs';
import { q, pushFn } from '../../lib/servidor.mjs';

export default async () => {
  const r = await correrAvisos({ q, push: pushFn() });
  console.log('Avisos', JSON.stringify(r));
};

export const config = { schedule: '*/15 * * * *' };
