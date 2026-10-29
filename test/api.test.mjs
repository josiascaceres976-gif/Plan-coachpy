import { NetlifyDB } from '@netlify/database-dev';
import pg from 'pg';
import assert from 'node:assert/strict';
import { api, correrAvisos, avisosDelMomento, local } from '../lib/core.mjs';

const db = new NetlifyDB();
const cs = await db.start();
await db.applyMigrations('./netlify/database/migrations');
const pool = new pg.Pool({ connectionString: cs });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
const env = { MASTER_EMAIL: 'jefe@ejemplo.com', MASTER_PASSWORD: 'Secreta123', VAPID_PUBLIC: 'PUB' };
const enviados = [];
const push = async (endpoint, keys, payload) => { enviados.push({ endpoint, payload: JSON.parse(payload) }); };
let now = new Date('2026-10-29T13:00:00Z'); // 10:00 en Paraguay
const jar = {};
async function call(m, path, body, who = 'pro', raw) {
  const headers = { cookie: Object.entries(jar[who] || {}).map(([k, v]) => `${k}=${v}`).join('; ') };
  let b;
  if (raw) { b = raw.body; headers['content-type'] = raw.type; } else if (body !== undefined) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await api(new Request('https://x.netlify.app/api' + path, { method: m, headers, body: b }), { q, env, now, push });
  const sc = res.headers.get('set-cookie');
  if (sc) { const [kv] = sc.split(';'); const [k, v] = kv.split('='); jar[who] = { ...(jar[who] || {}), [k]: v }; }
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.arrayBuffer() };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.body)); return r.body; };

// registro con prueba de 15 días
let r = ok(await call('POST', '/registro', { nombre: 'Ana Coach', email: 'Ana@Mail.com ', clave: 'abc123', telefono: '0981' }), 201);
assert.equal(r.pro.estado, 'prueba'); assert.equal(r.pro.diasPrueba, 15);
ok(await call('POST', '/registro', { nombre: 'X', email: 'ana@mail.com', clave: 'abc123' }), 409);
ok(await call('POST', '/registro', { nombre: 'X', email: 'mal', clave: 'abc123' }), 400);
r = ok(await call('GET', '/yo')); assert.equal(r.pro.email, 'ana@mail.com');

// datos con control de versión
let d = ok(await call('GET', '/datos')); assert.equal(d.version, 1);
const data = { alumnos: { a1: { nombre: 'Laura Benítez', turnos: [{ dia: 4, hora: '11:00' }], cuota: { monto: 250000, dia: 29 }, pagos: [],
  plan: { 4: { almuerzo: 'r1' } }, horarios: { almuerzo: '10:00' }, recordatorios: [{ id: 'q1', texto: 'Tomar agua', fecha: '2026-10-29', hora: '09:55', enviado: false }], historial: [{ tipo: 'Rutina', titulo: 'Tren A', fecha: '2026-10-20' }] } },
  recetas: { r1: { titulo: 'Pollo al limón', kcal: '540' } }, rutinas: { t1: { titulo: 'Tren A', ejercicios: 'Sentadilla con barra — 4x8' } }, ejercicios: {} };
r = ok(await call('PUT', '/datos', { data, version: 1 })); assert.equal(r.version, 2);
r = await call('PUT', '/datos', { data, version: 1 }); assert.equal(r.status, 409); assert.equal(r.body.version, 2);

// fotos
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
r = ok(await call('POST', '/fotos', undefined, 'pro', { body: png, type: 'image/png' }), 201);
const fid = r.id;
r = await call('GET', '/fotos/' + fid); assert.equal(r.status, 200); assert.equal(new Uint8Array(r.body).length, 7);
ok(await call('POST', '/fotos', undefined, 'pro', { body: 'x', type: 'text/plain' }), 400);

// link del alumno y su vista
r = ok(await call('POST', '/link-alumno', { alumnoId: 'a1' }));
const tok = r.token;
assert.equal(ok(await call('POST', '/link-alumno', { alumnoId: 'a1' })).token, tok);
r = ok(await call('GET', '/a/' + tok, undefined, 'nadie'));
assert.equal(r.nombre, 'Laura Benítez'); assert.equal(r.rutina.titulo, 'Tren A'); assert.equal(r.plan[4][0].titulo, 'Pollo al limón'); assert.equal(r.entrenador.nombre, 'Ana Coach');
ok(await call('POST', `/a/${tok}/push`, { sub: { endpoint: 'https://push/alumno', keys: { p256dh: 'a', auth: 'b' } } }, 'nadie'));
ok(await call('POST', '/push/suscribir', { sub: { endpoint: 'https://push/pro', keys: { p256dh: 'a', auth: 'b' } } }));
ok(await call('POST', '/push/probar')); assert.equal(enviados.length, 1);

// avisos a las 10:00 Paraguay (jueves): comida 10:00, rec 09:55, aviso de entrenamiento 1h antes (11:00 → 10:00)
enviados.length = 0;
r = await correrAvisos({ q, push, now });
const titulos = enviados.map(e => e.endpoint + ' ' + e.payload.title);
console.log(titulos);
assert.ok(titulos.some(t => t.includes('alumno') && t.includes('almuerzo')));
assert.ok(titulos.some(t => t.includes('alumno') && t.includes('Recordatorio')));
assert.ok(titulos.some(t => t.includes('alumno') && t.includes('Hoy entrenás')));
// no repite
enviados.length = 0; await correrAvisos({ q, push, now }); assert.equal(enviados.length, 0);
// a las 10:30: aviso al profe 30 min antes
enviados.length = 0; await correrAvisos({ q, push, now: new Date('2026-10-29T13:30:00Z') });
assert.ok(enviados.some(e => e.endpoint.includes('pro') && e.payload.title.includes('30 min')));

// cambio de contraseña
ok(await call('POST', '/clave', { actual: 'mala', nueva: 'nueva123' }), 401);
ok(await call('POST', '/clave', { actual: 'abc123', nueva: 'nueva123' }));
ok(await call('POST', '/salir'));
ok(await call('GET', '/yo'), 401);
ok(await call('POST', '/login', { email: 'ana@mail.com', clave: 'abc123' }), 401);
ok(await call('POST', '/login', { email: 'ANA@mail.com', clave: 'nueva123' }));

// panel Master
ok(await call('GET', '/master/pros', undefined, 'm'), 401);
ok(await call('POST', '/master/login', { email: 'jefe@ejemplo.com', clave: 'mala' }, 'm'), 401);
ok(await call('POST', '/master/login', { email: 'JEFE@ejemplo.com', clave: 'Secreta123' }, 'm'));
r = ok(await call('GET', '/master/pros', undefined, 'm')); assert.equal(r.pros.length, 1); assert.equal(r.pros[0].alumnos, 1); assert.equal(r.pros[0].dispositivos, 1);
r = ok(await call('POST', '/master/pros', { nombre: 'Beto Fit', email: 'beto@mail.com', estado: 'activo' }, 'm'), 201);
const cod = r.codigo, betoId = r.pro.id; assert.match(cod, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
r = ok(await call('POST', '/login', { email: 'beto@mail.com', clave: cod.toLowerCase() }, 'beto')); assert.equal(r.pro.debeCambiar, true);
ok(await call('POST', '/clave', { nueva: 'beto1234' }, 'beto'));
r = ok(await call('GET', '/yo', undefined, 'beto')); assert.equal(r.pro.debeCambiar, false);
// reset
r = ok(await call('POST', `/master/pros/${betoId}`, { accion: 'reset' }, 'm')); const cod2 = r.codigo;
ok(await call('GET', '/yo', undefined, 'beto'), 401); // sesiones cerradas
ok(await call('POST', '/login', { email: 'beto@mail.com', clave: cod2 }, 'beto'));
// bloquear
ok(await call('POST', `/master/pros/${betoId}`, { accion: 'bloquear' }, 'm'));
r = await call('POST', '/login', { email: 'beto@mail.com', clave: cod2 }, 'beto'); assert.equal(r.status, 403); assert.equal(r.body.motivo, 'bloqueado');
ok(await call('POST', `/master/pros/${betoId}`, { accion: 'activar', hasta: '2026-11-30' }, 'm'));
ok(await call('POST', '/login', { email: 'beto@mail.com', clave: cod2 }, 'beto'));
// ajustes de soporte
ok(await call('POST', '/master/ajustes', { soporte_whatsapp: '0981 555 000' }, 'm'));
// vencimiento de la prueba: 16 días después
now = new Date('2026-11-14T13:00:00Z');
r = await call('GET', '/yo'); assert.equal(r.status, 403); assert.equal(r.body.motivo, 'prueba-vencida'); assert.equal(r.body.soporte.whatsapp, '0981 555 000');
r = await call('GET', '/a/' + tok, undefined, 'nadie'); assert.equal(r.status, 403);
// extender prueba desde el Master
const anaId = (await q("SELECT id FROM pros WHERE email='ana@mail.com'"))[0].id;
ok(await call('POST', `/master/pros/${anaId}`, { accion: 'extender', dias: 15 }, 'm'));
r = ok(await call('GET', '/yo')); assert.equal(r.pro.diasPrueba, 15);
// suscripción activa vencida
now = new Date('2026-12-02T13:00:00Z');
r = await call('POST', '/login', { email: 'beto@mail.com', clave: cod2 }, 'beto'); assert.equal(r.body.motivo, 'vencido');

// avisos de cuota y resumen diario (función pura)
const L = { fecha: '2026-11-10', min: 8 * 60, dow: 2 };
const av = avisosDelMomento({ id: 9 }, { alumnos: { b: { nombre: 'Pepe', cuota: { monto: 100000, dia: 10 }, pagos: [], turnos: [{ dia: 2, hora: '18:00' }] } } }, { ...L, min: 7 * 60 });
assert.ok(av.some(a => a.titulo.includes('Tu día')));
assert.ok(avisosDelMomento({ id: 9 }, { alumnos: { b: { nombre: 'Pepe', cuota: { monto: 100000, dia: 10 }, pagos: [] } } }, L).some(a => a.titulo.includes('Hoy vence la cuota')));
assert.ok(avisosDelMomento({ id: 9 }, { alumnos: { b: { nombre: 'Pepe', cuota: { monto: 100000, dia: 10 }, pagos: [] } } }, { ...L, fecha: '2026-11-08', min: 9 * 60 }).some(a => a.titulo.includes('vence pronto')));
assert.equal(local(new Date('2026-10-29T13:00:00Z')).hora, '10:00');
console.log('TODAS LAS PRUEBAS PASARON');
await pool.end(); await db.stop();
