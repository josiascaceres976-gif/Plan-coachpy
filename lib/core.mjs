// Lógica del servidor de Plan Coach: cuentas, prueba, panel Master, datos, fotos, alumnos y avisos.
import crypto from 'node:crypto';

export const TZ = 'America/Asuncion';
export const DIAS_PRUEBA = 15;
const DIA_MS = 864e5;
const SESION_DIAS = 30;
const MAX_DATOS = 3 * 1024 * 1024;
const MAX_FOTO = 1024 * 1024;

/* ---------- utilidades ---------- */
export function hashClave(p) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(p), salt, 32);
  return 's1$' + salt.toString('hex') + '$' + h.toString('hex');
}
export function verificarClave(p, guardado) {
  const [v, s, h] = String(guardado || '').split('$');
  if (v !== 's1' || !s || !h) return false;
  const calc = crypto.scryptSync(String(p), Buffer.from(s, 'hex'), 32);
  const esp = Buffer.from(h, 'hex');
  return esp.length === calc.length && crypto.timingSafeEqual(esp, calc);
}
export const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
export const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
export function codigoTemporal() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[crypto.randomInt(A.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
function igualSeguro(a, b) {
  const x = Buffer.from(sha(a)), y = Buffer.from(sha(b));
  return crypto.timingSafeEqual(x, y);
}
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const limpiarEmail = e => String(e || '').trim().toLowerCase();

/* fecha y hora local de Paraguay */
export function local(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(now).map(x => [x.type, x.value]));
  const fecha = `${p.year}-${p.month}-${p.day}`;
  const hh = p.hour === '24' ? '00' : p.hour;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { fecha, min: Number(hh) * 60 + Number(p.minute), dow, hora: `${hh}:${p.minute}` };
}
export function sumarDias(f, n) {
  const [y, m, d] = f.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const aMin = h => { const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/* ---------- respuestas ---------- */
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
const error = (msg, status = 400, extra = {}) => json({ error: msg, ...extra }, status);
function cookie(nombre, valor, maxAge) {
  return `${nombre}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function leerCookie(req, nombre) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(/;\s*/).find(x => x.startsWith(nombre + '='));
  return m ? decodeURIComponent(m.slice(nombre.length + 1)) : null;
}
async function cuerpo(req) {
  try { return await req.json(); } catch { return {}; }
}

/* ---------- acceso según estado ---------- */
export function acceso(pro, now = new Date()) {
  if (!pro) return { ok: false, motivo: 'no-existe' };
  if (pro.estado === 'bloqueado') return { ok: false, motivo: 'bloqueado', mensaje: 'Tu cuenta está bloqueada.' };
  if (pro.estado === 'prueba') {
    const fin = pro.prueba_hasta ? new Date(pro.prueba_hasta) : null;
    if (!fin || now > fin) return { ok: false, motivo: 'prueba-vencida', mensaje: 'Terminó tu prueba gratis de 15 días.' };
    return { ok: true, dias: Math.max(0, Math.ceil((fin - now) / DIA_MS)) };
  }
  if (pro.estado === 'activo') {
    if (pro.activo_hasta) {
      const hasta = typeof pro.activo_hasta === 'string' ? pro.activo_hasta.slice(0, 10) : new Date(pro.activo_hasta).toISOString().slice(0, 10);
      if (local(now).fecha > hasta) return { ok: false, motivo: 'vencido', mensaje: 'Venció tu suscripción.' };
      return { ok: true, hasta };
    }
    return { ok: true };
  }
  return { ok: false, motivo: 'bloqueado', mensaje: 'Tu cuenta no está activa.' };
}
function proPublico(pro, now) {
  const a = acceso(pro, now);
  return {
    id: pro.id, nombre: pro.nombre, email: pro.email, telefono: pro.telefono, estado: pro.estado,
    debeCambiar: pro.debe_cambiar, diasPrueba: pro.estado === 'prueba' ? (a.dias ?? 0) : null,
    activoHasta: a.hasta || null
  };
}

/* ---------- sesiones ---------- */
async function crearSesion(q, rol, proId) {
  const t = nuevoToken();
  await q('INSERT INTO sesiones (token_hash, rol, pro_id, vence) VALUES ($1,$2,$3, NOW() + make_interval(days => $4))', [sha(t), rol, proId, SESION_DIAS]);
  return t;
}
async function sesion(q, req, rol) {
  const t = leerCookie(req, rol === 'master' ? 'pcm' : 'pc');
  if (!t) return null;
  const r = await q('SELECT * FROM sesiones WHERE token_hash=$1 AND rol=$2 AND vence > NOW()', [sha(t), rol]);
  return r[0] || null;
}
async function soporte(q) {
  const r = await q("SELECT clave, valor FROM ajustes WHERE clave IN ('soporte_whatsapp','soporte_nombre')", []);
  const o = Object.fromEntries(r.map(x => [x.clave, x.valor]));
  return { whatsapp: o.soporte_whatsapp || '', nombre: o.soporte_nombre || 'Plan Coach' };
}

/* ---------- router ---------- */
export async function api(req, deps) {
  const { q, env, now = new Date(), push } = deps;
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const m = req.method;
  const seg = ruta.split('/').filter(Boolean);

  try {
    /* ===== cuenta del profesional ===== */
    if (ruta === '/registro' && m === 'POST') {
      const b = await cuerpo(req);
      const email = limpiarEmail(b.email), nombre = String(b.nombre || '').trim().slice(0, 80), clave = String(b.clave || '');
      if (!nombre) return error('Escribí tu nombre.');
      if (!emailOk(email)) return error('Ese correo no parece válido.');
      if (clave.length < 6) return error('La contraseña tiene que tener al menos 6 caracteres.');
      const existe = await q('SELECT id FROM pros WHERE email=$1', [email]);
      if (existe.length) return error('Ese correo ya tiene una cuenta. Ingresá con tu contraseña.', 409);
      const r = await q(`INSERT INTO pros (email, nombre, telefono, pass_hash, estado, prueba_hasta, origen, ultimo_ingreso)
        VALUES ($1,$2,$3,$4,'prueba', $5, 'registro', NOW()) RETURNING *`,
        [email, nombre, String(b.telefono || '').trim().slice(0, 30), hashClave(clave), new Date(now.getTime() + DIAS_PRUEBA * DIA_MS)]);
      await q('INSERT INTO datos (pro_id) VALUES ($1)', [r[0].id]);
      const t = await crearSesion(q, 'pro', r[0].id);
      return json({ ok: true, pro: proPublico(r[0], now) }, 201, { 'set-cookie': cookie('pc', t, SESION_DIAS * 86400) });
    }

    if (ruta === '/login' && m === 'POST') {
      const b = await cuerpo(req);
      const email = limpiarEmail(b.email);
      const r = await q('SELECT * FROM pros WHERE email=$1', [email]);
      const pro = r[0];
      const clave = String(b.clave || '');
      let ok = !!pro && verificarClave(clave, pro.pass_hash);
      // los códigos temporales se aceptan aunque los escriban en minúscula o con espacios
      if (!ok && pro?.debe_cambiar) ok = verificarClave(clave.trim().toUpperCase(), pro.pass_hash);
      if (!ok) return error('Correo o contraseña incorrectos.', 401);
      const a = acceso(pro, now);
      if (!a.ok) return error(a.mensaje, 403, { motivo: a.motivo, soporte: await soporte(q) });
      await q('UPDATE pros SET ultimo_ingreso=NOW() WHERE id=$1', [pro.id]);
      const t = await crearSesion(q, 'pro', pro.id);
      return json({ ok: true, pro: proPublico(pro, now) }, 200, { 'set-cookie': cookie('pc', t, SESION_DIAS * 86400) });
    }

    if (ruta === '/salir' && m === 'POST') {
      const t = leerCookie(req, 'pc');
      if (t) await q('DELETE FROM sesiones WHERE token_hash=$1', [sha(t)]);
      return json({ ok: true }, 200, { 'set-cookie': cookie('pc', '', 0) });
    }

    if (ruta === '/soporte' && m === 'GET') return json(await soporte(q));

    if (ruta === '/push/clave' && m === 'GET') return json({ clave: env.VAPID_PUBLIC || '' });

    /* ===== portal del alumno (con su link) ===== */
    if (seg[0] === 'a' && seg[1]) {
      const l = await q('SELECT l.*, p.nombre AS pro_nombre, p.telefono AS pro_tel, p.estado, p.prueba_hasta, p.activo_hasta FROM links_alumno l JOIN pros p ON p.id=l.pro_id WHERE l.token=$1', [seg[1]]);
      const link = l[0];
      if (!link) return error('Este link ya no es válido. Pedile uno nuevo a tu entrenador.', 404);
      if (!acceso({ estado: link.estado, prueba_hasta: link.prueba_hasta, activo_hasta: link.activo_hasta }, now).ok) return error('Tu entrenador no tiene la cuenta activa en este momento.', 403);
      if (seg.length === 2 && m === 'GET') {
        const d = await q('SELECT data FROM datos WHERE pro_id=$1', [link.pro_id]);
        const vista = vistaAlumno(d[0]?.data || {}, link.alumno_id, now);
        if (!vista) return error('No encontramos tu ficha. Consultá a tu entrenador.', 404);
        return json({ ...vista, entrenador: { nombre: link.pro_nombre, telefono: link.pro_tel } });
      }
      if (seg[2] === 'push' && m === 'POST') {
        const b = await cuerpo(req);
        if (!b.sub?.endpoint || !b.sub?.keys) return error('Suscripción inválida.');
        await q(`INSERT INTO suscripciones (endpoint, pro_id, alumno_id, claves) VALUES ($1,$2,$3,$4)
          ON CONFLICT (endpoint) DO UPDATE SET pro_id=EXCLUDED.pro_id, alumno_id=EXCLUDED.alumno_id, claves=EXCLUDED.claves`,
          [b.sub.endpoint, link.pro_id, link.alumno_id, b.sub.keys]);
        return json({ ok: true });
      }
      return error('No encontrado', 404);
    }

    /* ===== panel Master ===== */
    if (seg[0] === 'master') {
      if (ruta === '/master/login' && m === 'POST') {
        const b = await cuerpo(req);
        if (!env.MASTER_EMAIL || !env.MASTER_PASSWORD) return error('El panel Master no está configurado.', 503);
        if (!igualSeguro(limpiarEmail(b.email), limpiarEmail(env.MASTER_EMAIL)) || !igualSeguro(String(b.clave || ''), env.MASTER_PASSWORD)) {
          return error('Correo o contraseña incorrectos.', 401);
        }
        const t = await crearSesion(q, 'master', null);
        return json({ ok: true }, 200, { 'set-cookie': cookie('pcm', t, 7 * 86400) });
      }
      const s = await sesion(q, req, 'master');
      if (!s) return error('Ingresá al panel.', 401);
      if (ruta === '/master/salir' && m === 'POST') {
        await q('DELETE FROM sesiones WHERE token_hash=$1', [sha(leerCookie(req, 'pcm'))]);
        return json({ ok: true }, 200, { 'set-cookie': cookie('pcm', '', 0) });
      }
      if (ruta === '/master/pros' && m === 'GET') {
        const r = await q(`SELECT p.*, COALESCE((SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(d.data->'alumnos','{}'::jsonb))),0)::int AS alumnos,
          (SELECT COUNT(*) FROM suscripciones s WHERE s.pro_id=p.id AND s.alumno_id IS NULL)::int AS dispositivos
          FROM pros p LEFT JOIN datos d ON d.pro_id=p.id ORDER BY p.creado DESC`, []);
        return json({
          pros: r.map(p => ({
            ...proPublico(p, now), creado: p.creado, ultimoIngreso: p.ultimo_ingreso, nota: p.nota, origen: p.origen,
            alumnos: p.alumnos, dispositivos: p.dispositivos, acceso: acceso(p, now).ok, pruebaHasta: p.prueba_hasta
          })),
          ajustes: await soporte(q)
        });
      }
      if (ruta === '/master/pros' && m === 'POST') {
        const b = await cuerpo(req);
        const email = limpiarEmail(b.email), nombre = String(b.nombre || '').trim().slice(0, 80);
        if (!nombre) return error('Falta el nombre.');
        if (!emailOk(email)) return error('Ese correo no parece válido.');
        if ((await q('SELECT 1 FROM pros WHERE email=$1', [email])).length) return error('Ya existe un profesional con ese correo.', 409);
        const cod = codigoTemporal();
        const enPrueba = b.estado === 'prueba';
        const r = await q(`INSERT INTO pros (email, nombre, telefono, pass_hash, debe_cambiar, estado, prueba_hasta, activo_hasta, origen)
          VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,'master') RETURNING *`,
          [email, nombre, String(b.telefono || '').trim().slice(0, 30), hashClave(cod), enPrueba ? 'prueba' : 'activo',
            enPrueba ? new Date(now.getTime() + DIAS_PRUEBA * DIA_MS) : null, !enPrueba && b.hasta ? b.hasta : null]);
        await q('INSERT INTO datos (pro_id) VALUES ($1)', [r[0].id]);
        return json({ ok: true, pro: proPublico(r[0], now), codigo: cod }, 201);
      }
      if (seg[1] === 'pros' && seg[2] && m === 'POST') {
        const id = Number(seg[2]);
        const b = await cuerpo(req);
        const r = await q('SELECT * FROM pros WHERE id=$1', [id]);
        if (!r[0]) return error('No existe ese profesional.', 404);
        let codigo = null;
        if (b.accion === 'activar') {
          await q("UPDATE pros SET estado='activo', activo_hasta=$2 WHERE id=$1", [id, b.hasta || null]);
        } else if (b.accion === 'bloquear') {
          await q("UPDATE pros SET estado='bloqueado' WHERE id=$1", [id]);
          await q("DELETE FROM sesiones WHERE pro_id=$1", [id]);
        } else if (b.accion === 'extender') {
          const dias = Math.min(90, Math.max(1, Number(b.dias) || 15));
          const base = r[0].prueba_hasta && new Date(r[0].prueba_hasta) > now ? new Date(r[0].prueba_hasta) : now;
          await q("UPDATE pros SET estado='prueba', prueba_hasta=$2 WHERE id=$1", [id, new Date(base.getTime() + dias * DIA_MS)]);
        } else if (b.accion === 'reset') {
          codigo = codigoTemporal();
          await q('UPDATE pros SET pass_hash=$2, debe_cambiar=TRUE WHERE id=$1', [id, hashClave(codigo)]);
          await q("DELETE FROM sesiones WHERE pro_id=$1", [id]);
        } else if (b.accion === 'editar') {
          const email = b.email != null ? limpiarEmail(b.email) : r[0].email;
          if (!emailOk(email)) return error('Ese correo no parece válido.');
          if (email !== r[0].email && (await q('SELECT 1 FROM pros WHERE email=$1', [email])).length) return error('Ya existe un profesional con ese correo.', 409);
          await q('UPDATE pros SET nombre=$2, telefono=$3, email=$4, nota=$5 WHERE id=$1',
            [id, String(b.nombre ?? r[0].nombre).trim().slice(0, 80) || r[0].nombre, String(b.telefono ?? r[0].telefono).trim().slice(0, 30), email, String(b.nota ?? r[0].nota).slice(0, 500)]);
        } else return error('Acción desconocida.');
        const n = await q('SELECT * FROM pros WHERE id=$1', [id]);
        return json({ ok: true, pro: proPublico(n[0], now), codigo });
      }
      if (ruta === '/master/ajustes' && m === 'POST') {
        const b = await cuerpo(req);
        for (const k of ['soporte_whatsapp', 'soporte_nombre']) {
          if (b[k] != null) await q('INSERT INTO ajustes (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor', [k, String(b[k]).trim().slice(0, 80)]);
        }
        return json({ ok: true, ajustes: await soporte(q) });
      }
      return error('No encontrado', 404);
    }

    /* ===== a partir de acá, profesional con sesión ===== */
    const s = await sesion(q, req, 'pro');
    if (!s) return error('Tu sesión terminó. Ingresá de nuevo.', 401);
    const pr = await q('SELECT * FROM pros WHERE id=$1', [s.pro_id]);
    const pro = pr[0];
    const a = acceso(pro, now);
    if (!a.ok) return error(a.mensaje, 403, { motivo: a.motivo, soporte: await soporte(q) });

    if (ruta === '/yo' && m === 'GET') return json({ pro: proPublico(pro, now), soporte: await soporte(q) });

    if (ruta === '/clave' && m === 'POST') {
      const b = await cuerpo(req);
      const nueva = String(b.nueva || '');
      if (nueva.length < 6) return error('La contraseña nueva tiene que tener al menos 6 caracteres.');
      if (!pro.debe_cambiar && !verificarClave(String(b.actual || ''), pro.pass_hash)) return error('La contraseña actual no es correcta.', 401);
      await q('UPDATE pros SET pass_hash=$2, debe_cambiar=FALSE WHERE id=$1', [pro.id, hashClave(nueva)]);
      await q('DELETE FROM sesiones WHERE pro_id=$1 AND token_hash<>$2', [pro.id, s.token_hash]);
      return json({ ok: true });
    }

    if (ruta === '/datos' && m === 'GET') {
      const d = await q('SELECT data, version FROM datos WHERE pro_id=$1', [pro.id]);
      return json(d[0] || { data: {}, version: 0 });
    }
    if (ruta === '/datos' && m === 'PUT') {
      const txt = await req.text();
      if (txt.length > MAX_DATOS) return error('Tus datos superan el tamaño permitido.', 413);
      let b; try { b = JSON.parse(txt); } catch { return error('Datos inválidos.'); }
      if (!b || typeof b.data !== 'object') return error('Datos inválidos.');
      const r = await q(`INSERT INTO datos (pro_id, data, version, actualizado) VALUES ($1,$2,1,NOW())
        ON CONFLICT (pro_id) DO UPDATE SET data=EXCLUDED.data, version=datos.version+1, actualizado=NOW()
        WHERE datos.version=$3 RETURNING version`, [pro.id, b.data, Number(b.version) || 0]);
      if (!r.length) {
        const d = await q('SELECT data, version FROM datos WHERE pro_id=$1', [pro.id]);
        return json({ error: 'Hubo cambios desde otro dispositivo.', ...d[0] }, 409);
      }
      return json({ ok: true, version: r[0].version });
    }

    if (ruta === '/fotos' && m === 'POST') {
      const tipo = (req.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp)$/.test(tipo)) return error('Solo se aceptan fotos JPG, PNG o WEBP.');
      const buf = Buffer.from(await req.arrayBuffer());
      if (!buf.length || buf.length > MAX_FOTO) return error('La foto es muy pesada.', 413);
      const id = 'f' + crypto.randomBytes(12).toString('hex');
      await q('INSERT INTO fotos (id, pro_id, tipo, bytes) VALUES ($1,$2,$3,$4)', [id, pro.id, tipo, buf]);
      return json({ id }, 201);
    }
    if (seg[0] === 'fotos' && seg[1]) {
      if (m === 'GET') {
        const r = await q('SELECT tipo, bytes FROM fotos WHERE id=$1 AND pro_id=$2', [seg[1], pro.id]);
        if (!r[0]) return new Response('No encontrada', { status: 404 });
        return new Response(r[0].bytes, { headers: { 'content-type': r[0].tipo, 'cache-control': 'private, max-age=31536000, immutable' } });
      }
      if (m === 'DELETE') {
        await q('DELETE FROM fotos WHERE id=$1 AND pro_id=$2', [seg[1], pro.id]);
        return json({ ok: true });
      }
    }

    if (ruta === '/link-alumno' && m === 'POST') {
      const b = await cuerpo(req);
      const aid = String(b.alumnoId || '');
      if (!aid) return error('Falta el alumno.');
      const ex = await q('SELECT token FROM links_alumno WHERE pro_id=$1 AND alumno_id=$2', [pro.id, aid]);
      if (ex[0] && !b.nuevo) return json({ token: ex[0].token });
      const t = crypto.randomBytes(9).toString('base64url');
      await q(`INSERT INTO links_alumno (token, pro_id, alumno_id) VALUES ($1,$2,$3)
        ON CONFLICT (pro_id, alumno_id) DO UPDATE SET token=EXCLUDED.token, creado=NOW()`, [t, pro.id, aid]);
      if (b.nuevo) await q('DELETE FROM suscripciones WHERE pro_id=$1 AND alumno_id=$2', [pro.id, aid]);
      return json({ token: t });
    }

    if (ruta === '/push/suscribir' && m === 'POST') {
      const b = await cuerpo(req);
      if (!b.sub?.endpoint || !b.sub?.keys) return error('Suscripción inválida.');
      await q(`INSERT INTO suscripciones (endpoint, pro_id, alumno_id, claves) VALUES ($1,$2,NULL,$3)
        ON CONFLICT (endpoint) DO UPDATE SET pro_id=EXCLUDED.pro_id, alumno_id=NULL, claves=EXCLUDED.claves`, [b.sub.endpoint, pro.id, b.sub.keys]);
      return json({ ok: true });
    }
    if (ruta === '/push/probar' && m === 'POST') {
      const subs = await q('SELECT * FROM suscripciones WHERE pro_id=$1 AND alumno_id IS NULL', [pro.id]);
      if (!subs.length) return error('Primero activá los avisos en este celular.');
      let ok = 0;
      for (const sub of subs) ok += (await enviarPush(q, push, sub, { titulo: '✅ Avisos activados', cuerpo: 'Así te van a llegar los avisos de Plan Coach.', url: '/' })) ? 1 : 0;
      return json({ ok: true, enviados: ok });
    }

    return error('No encontrado', 404);
  } catch (e) {
    console.error(e);
    return error('Ocurrió un error en el servidor. Probá de nuevo en un momento.', 500);
  }
}

/* ---------- vista para el alumno ---------- */
const COMIDAS = [['desayuno', 'Desayuno', '07:00'], ['almuerzo', 'Almuerzo', '12:00'], ['merienda', 'Merienda', '16:00'], ['cena', 'Cena', '20:00']];
function arr(o, k) { return Array.isArray(o?.[k]) ? o[k] : []; }
function estadoCuota(a, mes, hoy) {
  const pago = arr(a, 'pagos').find(p => p.mes === mes);
  if (pago) return { estado: 'pagado' };
  const c = a.cuota || {};
  if (!Number(c.monto)) return { estado: 'sin' };
  const dia = String(Math.min(28, Math.max(1, Number(c.dia) || 10))).padStart(2, '0');
  const venc = `${mes}-${dia}`;
  return { estado: hoy > venc ? 'vencida' : 'pendiente', vence: venc, monto: Number(c.monto) };
}
export function vistaAlumno(data, aid, now = new Date()) {
  const a = data?.alumnos?.[aid];
  if (!a) return null;
  const L = local(now);
  const recetas = data.recetas || {}, rutinas = data.rutinas || {};
  const horarios = Object.fromEntries(COMIDAS.map(([k, , h]) => [k, a.horarios?.[k] || h]));
  const plan = {};
  for (let d = 0; d < 7; d++) {
    const p = a.plan?.[d] || {};
    plan[d] = COMIDAS.filter(([k]) => recetas[p[k]]).map(([k, l]) => {
      const r = recetas[p[k]];
      return { comida: k, nombre: l, hora: horarios[k], titulo: r.titulo, kcal: r.kcal, prot: r.prot, carb: r.carb, grasa: r.grasa, ingredientes: r.ingredientes, pasos: r.pasos };
    });
  }
  let rutina = a.rutina && rutinas[a.rutina] ? rutinas[a.rutina] : null;
  if (!rutina) {
    const ult = arr(a, 'historial').filter(e => e.tipo === 'Rutina').sort((x, y) => (y.fecha + (y.ts || '')).localeCompare(x.fecha + (x.ts || '')))[0];
    if (ult) rutina = Object.values(rutinas).find(r => r.titulo === ult.titulo) || null;
  }
  const ejercicios = data.ejercicios || {};
  const slug = n => String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const med = arr(a, 'mediciones').slice().sort((x, y) => x.fecha.localeCompare(y.fecha));
  return {
    nombre: a.nombre, objetivo: a.objetivo || '', hoy: L.fecha, dow: L.dow,
    turnos: arr(a, 'turnos'), horarios, plan, macros: a.macros || null,
    rutina: rutina ? {
      titulo: rutina.titulo, nivel: rutina.nivel, dias: rutina.dias, notas: rutina.notas,
      ejercicios: String(rutina.ejercicios || '').split('\n').map(x => x.trim()).filter(Boolean).map(l => {
        const n = l.split(/\s+[—–-]\s+/)[0].trim(); const inf = ejercicios[slug(n)] || {};
        return { linea: l, nombre: n, tips: inf.tips || '', video: inf.video || '' };
      })
    } : null,
    recordatorios: arr(a, 'recordatorios').filter(r => !r.enviado && r.fecha >= L.fecha).sort((x, y) => (x.fecha + (x.hora || '')).localeCompare(y.fecha + (y.hora || ''))).slice(0, 10)
      .map(r => ({ texto: r.texto, fecha: r.fecha, hora: r.hora })),
    cuota: estadoCuota(a, L.fecha.slice(0, 7), L.fecha),
    mediciones: med.slice(-6).map(x => ({ fecha: x.fecha, peso: x.peso, grasa: x.grasa, cintura: x.cintura })),
    asistenciasMes: arr(a, 'asistencias').filter(f => f.slice(0, 7) === L.fecha.slice(0, 7)).length
  };
}

/* ---------- avisos ---------- */
async function enviarPush(q, push, sub, msg) {
  if (!push) return false;
  try {
    await push(sub.endpoint, sub.claves, JSON.stringify({ title: msg.titulo, body: msg.cuerpo, url: msg.url || '/' }));
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) await q('DELETE FROM suscripciones WHERE endpoint=$1', [sub.endpoint]);
    return false;
  }
}
const gs = n => 'Gs. ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtF = f => { const [, mm, d] = f.split('-'); return `${Number(d)}/${Number(mm)}`; };

/* Calcula qué avisos tocan en la ventana (desde, hasta] minutos locales del día. Pura: fácil de probar. */
export function avisosDelMomento(pro, data, L, ventana = 15, diasPrueba = null) {
  const out = [];
  const dentro = t => t != null && t > L.min - ventana && t <= L.min;
  const al = data?.alumnos || {};
  const recetas = data?.recetas || {};
  const mes = L.fecha.slice(0, 7);
  let turnosHoy = 0, recHoy = 0, cuotasHoy = 0;
  for (const [aid, a] of Object.entries(al)) {
    const nom = String(a.nombre || '').split(' ')[0];
    // comidas
    const p = a.plan?.[L.dow] || {};
    for (const [k, lbl, def] of COMIDAS) {
      const r = recetas[p[k]]; if (!r) continue;
      const t = aMin(a.horarios?.[k] || def);
      if (dentro(t)) out.push({ para: 'alumno', aid, clave: `c:${aid}:${L.fecha}:${k}`, titulo: `🍽️ Hora del ${lbl.toLowerCase()}`, cuerpo: `${r.titulo}${r.kcal ? ` · ${r.kcal} kcal` : ''}`, url: '/alumno.html#comidas' });
    }
    // entrenamiento
    for (const tr of arr(a, 'turnos')) {
      if (Number(tr.dia) !== L.dow) continue;
      turnosHoy++;
      const t = aMin(tr.hora);
      if (dentro(t - 60)) out.push({ para: 'alumno', aid, clave: `e:${aid}:${L.fecha}:${tr.hora}`, titulo: '🏋️ Hoy entrenás', cuerpo: `Te espero a las ${tr.hora}. ¡No faltes!`, url: '/alumno.html#rutina' });
      if (dentro(t - 30)) out.push({ para: 'pro', clave: `pe:${aid}:${L.fecha}:${tr.hora}`, titulo: `⏰ En 30 min entrena ${nom}`, cuerpo: `${a.nombre} · ${tr.hora}`, url: '/#agenda' });
    }
    // cuota
    const c = a.cuota || {};
    if (Number(c.monto) && !arr(a, 'pagos').some(x => x.mes === mes)) {
      const venc = `${mes}-${String(Math.min(28, Math.max(1, Number(c.dia) || 10))).padStart(2, '0')}`;
      if (L.fecha === venc) cuotasHoy++;
      if ((L.fecha === sumarDias(venc, -2) || L.fecha === venc) && dentro(aMin('09:00'))) {
        out.push({ para: 'alumno', aid, clave: `q:${aid}:${L.fecha}`, titulo: L.fecha === venc ? '💳 Hoy vence tu cuota' : '💳 Tu cuota vence pronto', cuerpo: `${gs(c.monto)} · vence el ${fmtF(venc)}`, url: '/alumno.html#cuota' });
      }
      if (L.fecha === venc && dentro(aMin('08:00'))) out.push({ para: 'pro', clave: `pq:${aid}:${L.fecha}`, titulo: `💳 Hoy vence la cuota de ${nom}`, cuerpo: `${a.nombre} · ${gs(c.monto)}`, url: '/#cobros' });
      if (L.fecha === sumarDias(venc, 1) && dentro(aMin('08:00'))) out.push({ para: 'pro', clave: `pv:${aid}:${L.fecha}`, titulo: `⚠️ Cuota vencida: ${nom}`, cuerpo: `${a.nombre} no pagó ${gs(c.monto)}`, url: '/#cobros' });
    }
    // recordatorios programados por el entrenador
    for (const r of arr(a, 'recordatorios')) {
      if (r.enviado || r.fecha !== L.fecha) continue;
      recHoy++;
      if (dentro(aMin(r.hora || '07:00'))) out.push({ para: 'alumno', aid, clave: `r:${aid}:${r.id}:${L.fecha}`, titulo: '⏰ Recordatorio', cuerpo: r.texto, url: '/alumno.html' });
    }
  }
  if (dentro(aMin('07:00')) && (turnosHoy || recHoy || cuotasHoy)) {
    const partes = [];
    if (turnosHoy) partes.push(`${turnosHoy} turno${turnosHoy > 1 ? 's' : ''}`);
    if (recHoy) partes.push(`${recHoy} recordatorio${recHoy > 1 ? 's' : ''}`);
    if (cuotasHoy) partes.push(`${cuotasHoy} cuota${cuotasHoy > 1 ? 's' : ''} por cobrar`);
    out.push({ para: 'pro', clave: `pd:${pro.id}:${L.fecha}`, titulo: '☀️ Tu día en Plan Coach', cuerpo: 'Hoy: ' + partes.join(' · '), url: '/' });
  }
  if (diasPrueba != null && [3, 1].includes(diasPrueba) && dentro(aMin('10:00'))) {
    out.push({ para: 'pro', clave: `pp:${pro.id}:${L.fecha}`, titulo: diasPrueba === 1 ? '⏳ Mañana termina tu prueba' : '⏳ Te quedan 3 días de prueba', cuerpo: 'Escribinos para seguir usando Plan Coach sin perder tus datos.', url: '/' });
  }
  return out;
}

export async function correrAvisos(deps) {
  const { q, push, now = new Date() } = deps;
  const L = local(now);
  const pros = await q(`SELECT p.*, d.data FROM pros p JOIN datos d ON d.pro_id=p.id
    WHERE EXISTS (SELECT 1 FROM suscripciones s WHERE s.pro_id=p.id)`, []);
  let enviados = 0;
  for (const pro of pros) {
    const a = acceso(pro, now);
    if (!a.ok) continue;
    const subs = await q('SELECT * FROM suscripciones WHERE pro_id=$1', [pro.id]);
    const lista = avisosDelMomento(pro, pro.data || {}, L, 15, pro.estado === 'prueba' ? a.dias : null);
    for (const av of lista) {
      const destinos = subs.filter(s => av.para === 'pro' ? s.alumno_id == null : s.alumno_id === av.aid);
      if (!destinos.length) continue;
      const ins = await q('INSERT INTO avisos_enviados (clave) VALUES ($1) ON CONFLICT DO NOTHING RETURNING clave', [av.clave]);
      if (!ins.length) continue;
      for (const sub of destinos) if (await enviarPush(q, push, sub, av)) enviados++;
    }
  }
  await q("DELETE FROM avisos_enviados WHERE enviado < NOW() - INTERVAL '3 days'", []);
  await q('DELETE FROM sesiones WHERE vence < NOW()', []);
  return { enviados, profesionales: pros.length, hora: L.hora };
}
