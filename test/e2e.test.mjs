import { NetlifyDB } from '@netlify/database-dev';
import pg from 'pg';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { api } from '../lib/core.mjs';

const db = new NetlifyDB(); const cs = await db.start();
await db.applyMigrations('./netlify/database/migrations');
const pool = new pg.Pool({ connectionString: cs });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
const env = { MASTER_EMAIL: 'jefe@ejemplo.com', MASTER_PASSWORD: 'Secreta123', VAPID_PUBLIC: '' };
const ORIGIN = 'https://plan-coach-py.netlify.app';
const errores = [];

function abrir(pagina, ruta = '/') {
  const html = fs.readFileSync('public/' + pagina, 'utf8').replace(/<link[^>]*(fonts|manifest|icon)[^>]*>/g, '');
  const jar = {};
  const dom = new JSDOM(html, { url: ORIGIN + ruta, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.fetch = async (u, o = {}) => {
    const url = new URL(u, ORIGIN);
    if (!url.pathname.startsWith('/api')) return new Response('', { status: 404 });
    const headers = { ...(o.headers || {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    const res = await api(new Request(url, { method: o.method || 'GET', headers, body: o.body }), { q, env });
    const sc = res.headers.get('set-cookie'); if (sc) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return res;
  };
  w.addEventListener('error', e => errores.push(pagina + ': ' + e.message));
  w.addEventListener('unhandledrejection', e => errores.push(pagina + ' promesa: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  for (const s of [...w.document.querySelectorAll('script')]) { try { w.eval(s.textContent); } catch (e) { errores.push(pagina + ' script: ' + e.message); } }
  return w;
}
const espera = (ms = 120) => new Promise(r => setTimeout(r, ms));
async function hasta(fn, msg, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return; } catch (e) {} await espera(40); } throw new Error('No pasó: ' + msg + ' | errores: ' + errores.join(' / ')); }
const click = (w, sel) => { const el = typeof sel === 'string' ? w.document.querySelector(sel) : sel; assert.ok(el, 'no existe ' + sel); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const set = (w, id, v) => { w.document.getElementById(id).value = v; };
const txt = w => { const c = w.document.body.cloneNode(true); c.querySelectorAll('script,style').forEach(x => x.remove()); return c.textContent.replace(/\s+/g, ' '); };

/* 1. llega desde TikTok y se registra */
let w = abrir('index.html', '/#probar');
await hasta(() => w.document.getElementById('fReg'), 'formulario de registro');
set(w, 'rNom', 'Carla Fit'); set(w, 'rEmail', 'carla@mail.com'); set(w, 'rTel', '0981 222 333'); set(w, 'rClave', 'carla123');
w.document.getElementById('fReg').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
await hasta(() => w.document.getElementById('auth').hidden && txt(w).includes('Tu cuenta'), 'entrar a la app');
assert.ok(txt(w).includes('Prueba gratis: te quedan 15 días'), 'franja de prueba');
await hasta(async () => true);
await espera(900); // guardado automático de la biblioteca inicial
let d = (await q("SELECT d.data, d.version FROM datos d JOIN pros p ON p.id=d.pro_id WHERE p.email='carla@mail.com'"))[0];
assert.ok(Object.keys(d.data.recetas).length >= 6, 'biblioteca guardada en la nube');

/* 2. carga un alumno con turno y le arma su app */
click(w, '[data-act="tab"][data-k="alumnos"]'); click(w, '#fab');
set(w, 'fNom', 'Diego Ortiz'); set(w, 'fTel', '0972 000 222'); set(w, 'fMonto', '250.000');
w.document.getElementById('td4').checked = true; set(w, 'th4', '18:00');
click(w, '[data-act="saveAlumno"]');
await hasta(() => w.document.querySelector('#hdr').textContent.includes('Diego Ortiz'), 'ficha del alumno');
click(w, '[data-act="enviar"][data-t="rutinas"]'); click(w, '.sheet [data-act="prevLib"]'); click(w, '[data-act="logOnly"]');
click(w, '[data-act="sub"][data-k="plan"]'); set(w, 'hz_almuerzo', '12:30'); click(w, '[data-act="saveHorarios"]');
click(w, '[data-act="appAlumno"]');
await hasta(() => w.document.getElementById('pMsg') && w.document.getElementById('pMsg').value.includes('/alumno?t='), 'link de la app del alumno');
const link = w.document.getElementById('pMsg').value.match(/\/alumno\?t=([\w-]+)/)[1];
click(w, '[data-act="logOnly"]');
await espera(1200);
d = (await q("SELECT d.data FROM datos d JOIN pros p ON p.id=d.pro_id WHERE p.email='carla@mail.com'"))[0];
const al = Object.values(d.data.alumnos)[0];
assert.equal(al.horarios.almuerzo, '12:30'); assert.ok(al.rutina, 'rutina asignada'); assert.equal(al.turnos[0].hora, '18:00');

/* 3. el alumno abre su app */
const wa = abrir('alumno.html', '/alumno?t=' + link);
await hasta(() => txt(wa).includes('Hola Diego'), 'app del alumno');
assert.ok(txt(wa).includes('Entrenás con Carla Fit'));
assert.ok(wa.document.querySelectorAll('.ej').length >= 4, 'ejercicios de la rutina');
assert.ok(wa.document.querySelector('.ej svg[data-ej]'), 'ilustración animada');
assert.ok(txt(wa).includes('Activar avisos'));

/* 4. panel Master */
const wm = abrir('master.html', '/master');
await hasta(() => !wm.document.getElementById('loginView').hidden, 'login master');
set(wm, 'lEmail', 'jefe@ejemplo.com'); set(wm, 'lClave', 'Secreta123');
wm.document.getElementById('loginForm').dispatchEvent(new wm.Event('submit', { bubbles: true, cancelable: true }));
await hasta(() => txt(wm).includes('Carla Fit'), 'lista de profesionales');
assert.ok(txt(wm).includes('15 días de prueba'));
click(wm, '[data-act="nuevo"]'); set(wm, 'nNom', 'Beto Gym'); set(wm, 'nEmail', 'beto@mail.com'); set(wm, 'nTel', '0981 999 000');
click(wm, '[data-act="crear"]');
await hasta(() => wm.document.querySelector('.codigo'), 'código generado');
const codigo = wm.document.querySelector('.codigo').textContent.trim();
assert.ok(wm.document.getElementById('msgTxt').value.includes(codigo));
// bloquear a Carla
const carlaId = (await q("SELECT id FROM pros WHERE email='carla@mail.com'"))[0].id;
click(wm, '[data-act="close"]'); click(wm, `[data-act="ver"][data-id="${carlaId}"]`);
const bq = wm.document.querySelector('[data-act="bloquear"]'); click(wm, bq); click(wm, bq);
await hasta(() => txt(wm).includes('Bloqueado'), 'Carla bloqueada');
// ajustes de soporte
click(wm, '[data-act="ajustes"]'); set(wm, 'sWa', '0981 555 000'); click(wm, '[data-act="guardarAj"]'); await espera(200);

/* 5. Beto entra con el código y crea su contraseña; Carla ve la pantalla de bloqueo */
const wb = abrir('index.html', '/');
await hasta(() => txt(wb).includes('Ya tengo cuenta'), 'pantalla de inicio');
click(wb, '[data-auth="login"]'); set(wb, 'iEmail', 'beto@mail.com'); set(wb, 'iClave', codigo.toLowerCase());
wb.document.getElementById('fLog').dispatchEvent(new wb.Event('submit', { bubbles: true, cancelable: true }));
await hasta(() => wb.document.getElementById('cNue'), 'pedir contraseña nueva');
set(wb, 'cNue', 'beto1234'); set(wb, 'cRep', 'beto1234'); click(wb, '[data-act="guardarClave"]');
await hasta(() => txt(wb).includes('Contraseña guardada'), 'contraseña cambiada');
assert.equal((await q("SELECT debe_cambiar FROM pros WHERE email='beto@mail.com'"))[0].debe_cambiar, false);
const wc = abrir('index.html', '/');
await hasta(() => txt(wc).includes('Ya tengo cuenta'), 'inicio Carla');
click(wc, '[data-auth="login"]'); set(wc, 'iEmail', 'carla@mail.com'); set(wc, 'iClave', 'carla123');
wc.document.getElementById('fLog').dispatchEvent(new wc.Event('submit', { bubbles: true, cancelable: true }));
await hasta(() => txt(wc).includes('Cuenta sin acceso') && txt(wc).includes('0981 555 000'), 'bloqueo con WhatsApp de soporte');
const wa2 = abrir('alumno.html', '/alumno?t=' + link);
await hasta(() => txt(wa2).includes('no tiene la cuenta activa'), 'alumno ve aviso de cuenta inactiva');

/* 6. demo y guía cargan sin errores */
const wd = abrir('demo.html', '/demo'); await hasta(() => txt(wd).includes('Laura Benítez'), 'demo');
const wg = abrir('guia.html', '/guia#plancha'); await hasta(() => txt(wg).includes('Abdomen y zona media'), 'guía');

assert.deepEqual(errores, []);
console.log('RECORRIDO COMPLETO OK');
await pool.end(); await db.stop(); process.exit(0);
