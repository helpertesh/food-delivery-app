// config/database.js — MySQL (mysql2) or PostgreSQL (pg), e.g. Supabase on Vercel.
const mysql = require('mysql2');
const { Pool: PgPool } = require('pg');

/**
 * Postgres if any of these is a postgres:// or postgresql:// URL (first match wins).
 * Vercel + Supabase often sets POSTGRES_URL / POSTGRES_URL_NON_POOLING.
 */
function getPostgresConnectionString() {
    const keys = [
        'POSTGRES_URL',
        'POSTGRES_PRISMA_URL',
        'POSTGRES_URL_NON_POOLING',
        'SUPABASE_DB_URL',
        'DATABASE_URL',
    ];
    for (const k of keys) {
        const v = process.env[k]?.trim();
        if (v && /^postgres(ql)?:\/\//i.test(v)) return v;
    }
    return null;
}

/**
 * Vercel/Supabase URLs often include sslmode=require or verify-full. node-pg can still
 * verify the chain and throw "self-signed certificate in certificate chain".
 * Strip ssl-related query params so Pool `ssl` options below always apply.
 */
function normalizePostgresConnectionString(url) {
    try {
        const u = new URL(url);
        const strip = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey'];
        for (const p of strip) {
            u.searchParams.delete(p);
        }
        let out = u.toString();
        if (out.endsWith('?')) {
            out = out.slice(0, -1);
        }
        return out;
    } catch {
        return url;
    }
}

function pgSslOption() {
    const disableSsl = process.env.DB_SSL === 'false' || process.env.DB_SSL === '0';
    if (disableSsl) {
        return false;
    }
    const mode = (process.env.PGSSLMODE || '').toLowerCase();
    if (mode === 'disable' || mode === 'false') {
        return false;
    }
    // verify-full / require-full: strict (may fail behind some proxies; set PGSSLMODE=no-verify if needed)
    if (mode === 'verify-full' || mode === 'require-full') {
        return { rejectUnauthorized: true };
    }
    // Default for Supabase/Vercel: TLS on, do not fail on intermediate/CA quirks
    return { rejectUnauthorized: false };
}

function buildMysqlPoolConfig() {
    const dbUrl = process.env.DATABASE_URL?.trim();
    if (dbUrl && /^mysql/i.test(dbUrl)) {
        return dbUrl;
    }
    if (dbUrl && /^postgres/i.test(dbUrl)) {
        throw new Error('DATABASE_URL is PostgreSQL; use POSTGRES_* or unset MySQL DATABASE_URL.');
    }

    const useSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';

    const ssl = useSsl
        ? {
              rejectUnauthorized:
                  process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' &&
                  process.env.DB_SSL_REJECT_UNAUTHORIZED !== '0',
          }
        : undefined;

    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME || 'food_delivery_db',
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 20000,
        enableKeepAlive: true,
        charset: 'utf8mb4',
    };

    if (ssl) {
        config.ssl = ssl;
    }

    return config;
}

const postgresUrlRaw = getPostgresConnectionString();
const postgresUrl = postgresUrlRaw ? normalizePostgresConnectionString(postgresUrlRaw) : null;
const dialect = postgresUrl ? 'postgres' : 'mysql';

let mysqlPool = null;
let pgPool = null;

if (dialect === 'postgres') {
    pgPool = new PgPool({
        connectionString: postgresUrl,
        ssl: pgSslOption(),
        max: process.env.VERCEL ? 2 : 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 20000,
    });
} else {
    const cfg = buildMysqlPoolConfig();
    mysqlPool = typeof cfg === 'string' ? mysql.createPool(cfg) : mysql.createPool(cfg);
}

function convertPlaceholdersToPg(sql) {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
}

function returningColumnForInsert(sql) {
    const m = sql.match(/\bINSERT\s+INTO\s+["`]?(\w+)["`]?\s/i);
    if (!m) return null;
    const table = m[1].toLowerCase();
    const map = {
        users: 'id',
        orders: 'order_id',
        order_items: 'id',
        food_item: 'food_id',
        category: 'category_id',
    };
    return map[table] || null;
}

async function queryPostgres(sql, params = []) {
    const p = params || [];

    if (/SHOW\s+TABLES\s+LIKE\s+'users'/i.test(sql)) {
        const r = await pgPool.query(
            `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'users'`
        );
        return [r.rows, undefined];
    }

    if (/^\s*SHOW\s+TABLES\s*$/i.test(sql.trim())) {
        const r = await pgPool.query(
            `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
        );
        return [r.rows, undefined];
    }

    if (/ALTER\s+TABLE\s+users\s+ADD\s+COLUMN\s+is_admin\s+TINYINT/i.test(sql)) {
        await pgPool.query(
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin SMALLINT DEFAULT 0'
        );
        return [[], undefined];
    }

    if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+users/i.test(sql) && /ENGINE\s*=\s*InnoDB/i.test(sql)) {
        await pgPool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                address TEXT NOT NULL,
                is_admin SMALLINT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        return [[], undefined];
    }

    let text = convertPlaceholdersToPg(sql);
    if (/^\s*INSERT\s+/i.test(text) && !/\bRETURNING\b/i.test(text)) {
        const col = returningColumnForInsert(sql);
        if (col) {
            text = `${text.trim()} RETURNING ${col}`;
        }
    }

    const r = await pgPool.query(text, p);

    if (r.command === 'INSERT' && r.rows && r.rows.length > 0) {
        const row = r.rows[0];
        const insertId = row.id ?? row.order_id ?? row.food_id ?? row.category_id;
        return [{ insertId: Number(insertId) }, undefined];
    }

    return [r.rows, undefined];
}

async function queryMysql(sql, params) {
    return mysqlPool.promise().query(sql, params);
}

async function query(sql, params) {
    if (dialect === 'postgres') {
        return queryPostgres(sql, params);
    }
    return queryMysql(sql, params ?? []);
}

module.exports = { query, dialect };
