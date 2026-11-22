/**
 * T-197, tests only: a small database held in memory that answers the way the
 * Supabase client does for the calls the support code makes. It is not
 * exported from the package's index and is never part of an app.
 *
 * It knows: select (with `count` and `head`), insert, update, upsert and
 * delete; the filters eq, neq, in, is, gt and a simple `or`; order, limit,
 * single and maybeSingle; and an embedded row written the way PostgREST takes
 * it ("alias:table!column (…)"): when the column is on this row the other
 * table is looked up by its `id`; otherwise the other table's rows that point
 * here are returned (one row when the column is that table's key).
 *
 * `unique` lists, per table, the columns that must be unique together; a
 * second row is refused with the database's own code (23505).
 * `fail` makes every call on a table answer with an error, to test what the
 * code does when the database cannot answer.
 */
export type MemRow = Record<string, unknown>

export interface MemoryDbOptions {
  unique?: Record<string, string[][]>
  fail?: Set<string>
  /** Account emails by user id, for auth.admin.getUserById */
  users?: Record<string, string>
  /** Tables whose rows are keyed by a column other than `id` (a one-to-one row) */
  keys?: Record<string, string>
  /** T-199: database functions a test stands in for, by name (the answer is the function's own) */
  functions?: Record<string, (args: MemRow, tables: Record<string, MemRow[]>) => unknown>
}

type Filter = (row: MemRow) => boolean

let nextId = 1

export function memoryDb(tables: Record<string, MemRow[]>, options: MemoryDbOptions = {}) {
  const log: Array<{ table: string; op: string; payload?: unknown }> = []
  const rowsOf = (table: string): MemRow[] => (tables[table] ??= [])
  const keyOf = (table: string) => options.keys?.[table] ?? 'id'

  const embed = (table: string, row: MemRow, select: string): MemRow => {
    const out: MemRow = { ...row }
    const pattern = /(?:(\w+):)?(\w+)!(\w+)\s*\(/g
    for (const match of select.matchAll(pattern)) {
      const [, alias, other, column] = match
      const name = alias ?? other!
      if (column! in row) {
        out[name] = rowsOf(other!).find((r) => r[keyOf(other!)] === row[column!] || r.id === row[column!]) ?? null
      } else {
        const found = rowsOf(other!).filter((r) => r[column!] === row[keyOf(table)])
        out[name] = keyOf(other!) === column ? (found[0] ?? null) : found
      }
    }
    return out
  }

  const clashes = (table: string, row: MemRow, except?: MemRow): boolean =>
    (options.unique?.[table] ?? []).some((columns) => rowsOf(table).some((r) => r !== except && columns.every((c) => r[c] === row[c])))

  class Query {
    filters: Filter[] = []
    op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    payload: MemRow | MemRow[] | null = null
    selectText = '*'
    head = false
    wantCount = false
    limitTo: number | null = null
    orderBy: { column: string; ascending: boolean } | null = null
    one: 'single' | 'maybe' | null = null
    conflict: string | null = null

    constructor(readonly table: string) {}

    select(text = '*', opts: { count?: string; head?: boolean } = {}) {
      this.selectText = text
      if (this.op === 'select') {
        this.head = opts.head === true
        this.wantCount = Boolean(opts.count)
      }
      return this
    }
    insert(payload: MemRow | MemRow[]) {
      this.op = 'insert'
      this.payload = payload
      return this
    }
    update(payload: MemRow) {
      this.op = 'update'
      this.payload = payload
      return this
    }
    upsert(payload: MemRow, opts: { onConflict?: string } = {}) {
      this.op = 'upsert'
      this.payload = payload
      this.conflict = opts.onConflict ?? keyOf(this.table)
      return this
    }
    delete(opts: { count?: string } = {}) {
      this.op = 'delete'
      this.wantCount = Boolean(opts.count)
      return this
    }
    eq(column: string, value: unknown) {
      this.filters.push((r) => r[column] === value)
      return this
    }
    neq(column: string, value: unknown) {
      this.filters.push((r) => r[column] !== value)
      return this
    }
    in(column: string, values: unknown[]) {
      this.filters.push((r) => values.includes(r[column]))
      return this
    }
    is(column: string, value: unknown) {
      this.filters.push((r) => (r[column] ?? null) === value)
      return this
    }
    gt(column: string, value: string | number) {
      this.filters.push((r) => (r[column] as string | number) > value)
      return this
    }
    lt(column: string, value: string | number) {
      this.filters.push((r) => (r[column] as string | number) < value)
      return this
    }
    /** "id.eq.A,merged_into.eq.A" */
    or(text: string) {
      const parts = text.split(',').map((part) => part.split('.'))
      this.filters.push((r) => parts.some(([column, , value]) => String(r[column!] ?? '') === value))
      return this
    }
    order(column: string, opts: { ascending?: boolean } = {}) {
      this.orderBy = { column, ascending: opts.ascending !== false }
      return this
    }
    limit(n: number) {
      this.limitTo = n
      return this
    }
    single() {
      this.one = 'single'
      return this
    }
    maybeSingle() {
      this.one = 'maybe'
      return this
    }

    run(): { data: unknown; error: { code: string } | null; count?: number | null } {
      log.push({ table: this.table, op: this.op, payload: this.payload ?? undefined })
      if (options.fail?.has(this.table)) return { data: null, error: { code: 'XX000' }, count: null }
      const all = rowsOf(this.table)
      const matching = () => all.filter((r) => this.filters.every((f) => f(r)))
      let touched: MemRow[] = []

      if (this.op === 'insert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as MemRow]
        const made = list.map((row) => ({ ...(keyOf(this.table) === 'id' ? { id: `id-${nextId++}` } : {}), created_at: new Date(Date.UTC(2026, 10, 21, 0, 0, nextId)).toISOString(), ...row }))
        if (made.some((row) => clashes(this.table, row))) return { data: null, error: { code: '23505' } }
        all.push(...made)
        touched = made
      } else if (this.op === 'update') {
        touched = matching()
        for (const row of touched) Object.assign(row, this.payload)
      } else if (this.op === 'upsert') {
        const row = this.payload as MemRow
        const existing = all.find((r) => r[this.conflict!] === row[this.conflict!])
        if (existing) Object.assign(existing, row)
        else all.push({ ...row })
        touched = [existing ?? all[all.length - 1]!]
      } else if (this.op === 'delete') {
        touched = matching()
        for (const row of touched) all.splice(all.indexOf(row), 1)
      } else {
        touched = matching()
      }

      let out = touched.map((row) => embed(this.table, row, this.selectText))
      if (this.orderBy) {
        const { column, ascending } = this.orderBy
        out = [...out].sort((a, b) => (String(a[column] ?? '') < String(b[column] ?? '') ? -1 : String(a[column] ?? '') > String(b[column] ?? '') ? 1 : 0) * (ascending ? 1 : -1))
      }
      const count = out.length
      if (this.limitTo !== null) out = out.slice(0, this.limitTo)
      if (this.head) return { data: null, error: null, count }
      if (this.one) {
        if (out.length === 0 && this.one === 'single') return { data: null, error: { code: 'PGRST116' } }
        return { data: out[0] ?? null, error: null }
      }
      return { data: out, error: null, count: this.wantCount ? count : null }
    }

    then<T>(resolve: (value: { data: unknown; error: { code: string } | null; count?: number | null }) => T, reject?: (reason: unknown) => T): Promise<T> {
      try {
        return Promise.resolve(resolve(this.run()))
      } catch (error) {
        return reject ? Promise.resolve(reject(error)) : Promise.reject(error)
      }
    }
  }

  return {
    tables,
    log,
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: MemRow) => {
      log.push({ table: `rpc:${name}`, op: 'rpc', payload: args })
      const stand = options.functions?.[name]
      if (stand) return { data: stand(args, tables), error: null }
      if (name !== 'claim_ops_alert') return { data: null, error: { code: 'XX000' } }
      const kind = args.p_kind as string
      const existing = rowsOf('ops_alerts').find((r) => r.kind === kind)
      if (existing) Object.assign(existing, { last_sent_at: new Date().toISOString() })
      else rowsOf('ops_alerts').push({ kind, last_sent_at: new Date().toISOString(), held_back: 0 })
      return { data: [{ send: true, held_back: 0 }], error: null }
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: options.users?.[id] ? { email: options.users[id] } : null }, error: null }),
      },
    },
  }
}

export type MemoryDb = ReturnType<typeof memoryDb>
