import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { test } from 'bun:test'

test('application pragma metadata uses a valid non-keyword alias', () => {
  const database = new Database(':memory:')
  database.exec(`CREATE TABLE applications (id TEXT NOT NULL, submitted_at INTEGER)`)

  const columns = database.prepare<{ name: string; not_null: number }, []>(
    `SELECT name, "notnull" AS not_null FROM pragma_table_info('applications')`,
  ).all()

  assert.equal(columns.find(column => column.name === 'id')?.not_null, 1)
  assert.equal(columns.find(column => column.name === 'submitted_at')?.not_null, 0)
  database.close()
})
