// Conexión a la base de Netlify y envío de notificaciones, compartido por las funciones.
import { getDatabase } from '@netlify/database';
import webpush from 'web-push';

let db = null;
export async function q(texto, params = []) {
  db ??= getDatabase();
  const r = await db.pool.query(texto, params);
  return r.rows;
}
export function env() {
  const g = k => (globalThis.Netlify?.env?.get(k)) ?? process.env[k] ?? '';
  return { MASTER_EMAIL: g('MASTER_EMAIL'), MASTER_PASSWORD: g('MASTER_PASSWORD'), VAPID_PUBLIC: g('VAPID_PUBLIC'), VAPID_PRIVATE: g('VAPID_PRIVATE') };
}
export function pushFn() {
  const e = env();
  if (!e.VAPID_PUBLIC || !e.VAPID_PRIVATE) return null;
  webpush.setVapidDetails('mailto:' + (e.MASTER_EMAIL || 'soporte@plancoach.app'), e.VAPID_PUBLIC, e.VAPID_PRIVATE);
  return (endpoint, keys, payload) => webpush.sendNotification({ endpoint, keys }, payload, { TTL: 3600, urgency: 'high' });
}
