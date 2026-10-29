CREATE TABLE pros (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  debe_cambiar BOOLEAN NOT NULL DEFAULT FALSE,
  estado TEXT NOT NULL DEFAULT 'prueba',
  prueba_hasta TIMESTAMPTZ,
  activo_hasta DATE,
  nota TEXT NOT NULL DEFAULT '',
  origen TEXT NOT NULL DEFAULT 'registro',
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_ingreso TIMESTAMPTZ
);

CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,
  rol TEXT NOT NULL,
  pro_id INTEGER REFERENCES pros(id) ON DELETE CASCADE,
  vence TIMESTAMPTZ NOT NULL
);

CREATE TABLE datos (
  pro_id INTEGER PRIMARY KEY REFERENCES pros(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fotos (
  id TEXT PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES pros(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE links_alumno (
  token TEXT PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES pros(id) ON DELETE CASCADE,
  alumno_id TEXT NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pro_id, alumno_id)
);

CREATE TABLE suscripciones (
  endpoint TEXT PRIMARY KEY,
  pro_id INTEGER NOT NULL REFERENCES pros(id) ON DELETE CASCADE,
  alumno_id TEXT,
  claves JSONB NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE avisos_enviados (
  clave TEXT PRIMARY KEY,
  enviado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE INDEX idx_sesiones_vence ON sesiones (vence);
CREATE INDEX idx_susc_pro ON suscripciones (pro_id);
CREATE INDEX idx_fotos_pro ON fotos (pro_id);
