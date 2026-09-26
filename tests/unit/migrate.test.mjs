// Runner de migraciones (scripts/migrate.mjs) y lint de migraciones (scripts/lint-migrations.mjs):
// solo helpers puros. Nunca se conecta a una base de datos.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BASELINE_FILES,
  MIGRATION_FILE_RE,
  assertSessionPoolerUrl,
  checksumOf,
  clientConfigFromUrl,
  isNoTransaction,
  listMigrationFiles,
  positionToLineCol,
  redactUrl,
  toSessionPoolerUrl,
} from '../../scripts/migrate.mjs'
import { isAllowedTable, lintMigration, lintMigrationsDir } from '../../scripts/lint-migrations.mjs'

describe('listMigrationFiles', () => {
  let dir
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'aitickets-migrations-'))
    for (const name of [
      '202609270200_sites.sql',
      '20260926_B_orders.sql',
      '202609270100_payments_provider.sql',
      '20260926_A0_urgent_policies.sql',
      'schema.sql',
      'policies.sql',
      'README.md',
      '2026_bad.sql',
      '202609270300_outreach.sql.bak',
    ]) {
      writeFileSync(join(dir, name), '-- test\n')
    }
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('ignora schema.sql, README y nombres fuera de la convención', () => {
    const files = listMigrationFiles(dir)
    expect(files).not.toContain('schema.sql')
    expect(files).not.toContain('policies.sql')
    expect(files).not.toContain('README.md')
    expect(files).not.toContain('2026_bad.sql')
    expect(files).not.toContain('202609270300_outreach.sql.bak')
  })

  it('ordena lexicográficamente: la línea base 20260926_* va antes que 2026092701xx', () => {
    expect(listMigrationFiles(dir)).toEqual([
      '20260926_A0_urgent_policies.sql',
      '20260926_B_orders.sql',
      '202609270100_payments_provider.sql',
      '202609270200_sites.sql',
    ])
  })

  it('en db/migrations real: la línea base va primero y todo cumple la convención', () => {
    const files = listMigrationFiles('db/migrations')
    expect(files.slice(0, BASELINE_FILES.length)).toEqual(BASELINE_FILES)
    expect(files.every((f) => MIGRATION_FILE_RE.test(f))).toBe(true)
    expect([...files].sort()).toEqual(files)
  })
})

describe('checksumOf', () => {
  it('es sha256 hex y estable', () => {
    const a = checksumOf('select 1;\n')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(checksumOf('select 1;\n')).toBe(a)
  })

  it('normaliza CRLF a LF (un checkout en Windows no cambia el checksum)', () => {
    expect(checksumOf('create table x();\r\nselect 1;\r\n')).toBe(checksumOf('create table x();\nselect 1;\n'))
  })

  it('cambia si cambia el contenido', () => {
    expect(checksumOf('select 1;')).not.toBe(checksumOf('select 2;'))
  })
})

describe('assertSessionPoolerUrl', () => {
  it('rechaza el transaction pooler (puerto 6543)', () => {
    expect(() =>
      assertSessionPoolerUrl('postgresql://postgres.abc:secret@aws-0-sa-east-1.pooler.supabase.com:6543/postgres')
    ).toThrow(/6543/)
  })

  it('rechaza URL vacía, inválida o que no es postgres', () => {
    expect(() => assertSessionPoolerUrl('')).toThrow(/SUPABASE_DB_URL/)
    expect(() => assertSessionPoolerUrl(undefined)).toThrow()
    expect(() => assertSessionPoolerUrl('no es una url')).toThrow(/válida/)
    expect(() => assertSessionPoolerUrl('mysql://u:p@host:3306/db')).toThrow(/postgresql/)
  })

  it('acepta el session pooler (5432) y postgres:// local', () => {
    const url = 'postgresql://postgres.abc:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
    expect(assertSessionPoolerUrl(url)).toBe(url)
    expect(assertSessionPoolerUrl('postgres://postgres@localhost:5432/postgres')).toBeTruthy()
  })
})

describe('toSessionPoolerUrl', () => {
  it('reescribe el host directo db.<ref>.supabase.co al session pooler con usuario postgres.<ref>', () => {
    const out = new URL(toSessionPoolerUrl('postgresql://postgres:s3cr%40t@db.abcdefghij.supabase.co:5432/postgres'))
    expect(out.hostname).toBe('aws-0-sa-east-1.pooler.supabase.com')
    expect(out.port).toBe('5432')
    expect(out.username).toBe('postgres.abcdefghij')
    expect(decodeURIComponent(out.password)).toBe('s3cr@t')
    expect(out.pathname).toBe('/postgres')
  })

  it('acepta un host de pooler alternativo', () => {
    const out = new URL(toSessionPoolerUrl('postgresql://postgres:x@db.ref123.supabase.co:5432/postgres', 'pooler.example.test'))
    expect(out.hostname).toBe('pooler.example.test')
  })

  it('no toca URLs que no son el host directo', () => {
    const pooler = 'postgresql://postgres.abc:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
    expect(toSessionPoolerUrl(pooler)).toBe(pooler)
    const local = 'postgres://postgres@localhost:5432/postgres'
    expect(toSessionPoolerUrl(local)).toBe(local)
  })

  it('el resultado de un host directo pasa assertSessionPoolerUrl', () => {
    expect(() => assertSessionPoolerUrl(toSessionPoolerUrl('postgresql://postgres:x@db.ref.supabase.co:5432/postgres'))).not.toThrow()
  })
})

describe('helpers del runner', () => {
  it('redactUrl oculta la contraseña', () => {
    const out = redactUrl('postgresql://postgres.abc:supersecret@host:5432/postgres')
    expect(out).not.toContain('supersecret')
    expect(out).toContain('***')
    expect(redactUrl('%%%')).toBe('(url inválida)')
  })

  it('isNoTransaction solo mira la primera línea', () => {
    expect(isNoTransaction('-- migrate:no-transaction\ncreate index concurrently ...')).toBe(true)
    expect(isNoTransaction('﻿-- migrate:no-transaction\r\nselect 1')).toBe(true)
    expect(isNoTransaction('select 1;\n-- migrate:no-transaction')).toBe(false)
  })

  it('positionToLineCol convierte la posición de Postgres en línea/columna', () => {
    const sql = 'select 1;\nselect oops;\n'
    expect(positionToLineCol(sql, 1)).toEqual({ line: 1, column: 1 })
    expect(positionToLineCol(sql, 18)).toEqual({ line: 2, column: 8 })
    expect(positionToLineCol(sql, 0)).toBeNull()
    expect(positionToLineCol(sql, 'x')).toBeNull()
  })

  it('clientConfigFromUrl: SSL apagado en localhost y sin verificar en el pooler', () => {
    expect(clientConfigFromUrl('postgres://postgres:pw@localhost:5432/postgres', {}).ssl).toBe(false)
    const remote = clientConfigFromUrl('postgresql://postgres.ref:p%40ss@aws-0-sa-east-1.pooler.supabase.com:5432/postgres', {})
    expect(remote.ssl).toEqual({ rejectUnauthorized: false })
    expect(remote.password).toBe('p@ss')
    expect(remote.user).toBe('postgres.ref')
    expect(remote.application_name).toBe('aitickets-migrator')
  })
})

describe('lint de migraciones', () => {
  it('permite tablas propias y aitickets_*', () => {
    expect(isAllowedTable('event_orders')).toBe(true)
    expect(isAllowedTable('public.aitickets_sites')).toBe(true)
    expect(isAllowedTable('"public"."organization_payout_accounts"')).toBe(true)
    expect(isAllowedTable('profiles')).toBe(false)
    expect(isAllowedTable('auth.users')).toBe(false)
  })

  it('marca DROP/ALTER sobre tablas de otras apps y objetos globales', () => {
    const problems = lintMigration(
      '202609270900_bad.sql',
      [
        'alter table public.profiles add column x int;',
        'drop table public.customers;',
        'truncate public.event_orders;',
        'drop schema foo cascade;',
        'alter default privileges in schema public grant all on tables to anon;',
      ].join('\n')
    )
    const lines = problems.map((p) => p.line)
    expect(lines).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]))
  })

  it('exige prefijo aitickets_ en tablas y funciones nuevas', () => {
    const problems = lintMigration('202609270900_bad.sql', 'create table public.leads (id int);\ncreate or replace function public.do_it() returns void as $$ $$ language sql;')
    expect(problems).toHaveLength(2)
    expect(lintMigration('202609270900_ok.sql', 'create table if not exists public.aitickets_leads (id int);')).toEqual([])
  })

  it('permite FKs a auth.users pero no otras referencias a auth.*', () => {
    expect(lintMigration('202609270900_ok.sql', 'create table public.aitickets_x (uid uuid references auth.users(id));')).toEqual([])
    expect(lintMigration('202609270900_bad.sql', 'select * from auth.users;')).toHaveLength(1)
  })

  it('rechaza nombres de archivo fuera de la convención', () => {
    expect(lintMigration('nueva.sql', 'select 1;')[0].message).toMatch(/nombre inválido/)
  })

  it('db/migrations actual pasa el lint', () => {
    expect(lintMigrationsDir('db/migrations')).toEqual({})
  })
})
