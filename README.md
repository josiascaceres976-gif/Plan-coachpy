# Plan Coach

App para entrenadores y nutricionistas: alumnos, rutinas ilustradas, planes de comida, avisos y cobros.

## Partes
- `public/index.html` — app del profesional (registro con 15 días de prueba, ingreso, datos en la nube).
- `public/master.html` — panel Master (alta de profesionales con código, activar, bloquear, extender prueba, resetear contraseña).
- `public/alumno.html` — app del alumno (rutina, comidas, cuota, avisos). Se abre con el link que manda el profesional.
- `public/demo.html` — demo sin cuenta. `public/guia.html` — guía de ejercicios ilustrada.
- `netlify/functions/api.mjs` — servidor (`/api/*`). `netlify/functions/avisos.mjs` — avisos cada 15 minutos.
- `netlify/database/migrations/` — tablas de la base de datos de Netlify.

## Variables de entorno (Netlify)
`MASTER_EMAIL`, `MASTER_PASSWORD`, `VAPID_PUBLIC`, `VAPID_PRIVATE`.

## Pruebas
`node test/api.test.mjs` y `node test/e2e.test.mjs` (usan una base de datos local de prueba).

## Publicación
Cada cambio que se sube a la rama `main` se publica solo en https://plan-coach-py.netlify.app
