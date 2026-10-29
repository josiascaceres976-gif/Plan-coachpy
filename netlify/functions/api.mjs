import { api } from '../../lib/core.mjs';
import { q, env, pushFn } from '../../lib/servidor.mjs';

export default async (req) => api(req, { q, env: env(), push: pushFn() });

export const config = {
  path: '/api/*',
  rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
