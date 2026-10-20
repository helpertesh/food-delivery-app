// config/database.js — MySQL (mysql2) or PostgreSQL (pg), e.g. Supabase on Vercel.
const mysql = require('mysql2');
const { Pool: PgPool } = require('pg');
const { parse: parsePgConn } = require('pg-connection-string');

/** Set DATABASE_DIALECT=mysql in backend/.env to always use MySQL (ignore Postgres URLs in the environment). */
const forceMysqlDialect = (process.env.DATABASE_DIALECT || '').toLowerCase() === 'mysql';

/** Prefer pooler / Prisma URL first everywhere (local + Vercel + Supabase integration). */
const POSTGRES_URL_ENV_KEYS = [
    'POSTGRES_PRISMA_URL',
    'POSTGRES_URL_NON_POOLING',
    'POSTGRES_URL',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
];

function getPostgresConnectionEnvKey() {
    for (const k of POSTGRES_URL_ENV_KEYS) {
        const v = process.env[k]?.trim();
        if (v && /^postgres(ql)?:\/\//i.test(v)) return k;
    }
    return null;
}

function getPostgresConnectionString() {
    const k = getPostgresConnectionEnvKey();
    return k ? process.env[k].trim() : null;
}

function getPostgresEnvFlags() {
    const out = {};
    for (const k of POSTGRES_URL_ENV_KEYS) {
        const v = process.env[k]?.trim();
        out[k] = Boolean(v && /^postgres(ql)?:\/\//i.test(v));
    }
    return out;
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
    if (mode === 'verify-full' || mode === 'require-full') {
        return { rejectUnauthorized: true };
    }
    // Supabase / pooler: TLS without strict CA chain (fixes "self-signed certificate in certificate chain")
    return { rejectUnauthorized: false };
}

/**
 * Build Pool config from URL: only pass explicit fields + ssl (avoid stray query params confusing pg).
 */
function buildPgPoolConfig(connectionUrl) {
    const normalized = normalizePostgresConnectionString(connectionUrl);
    const parsed = parsePgConn(normalized);
    const config = {
        user: parsed.user,
        password: parsed.password,
        host: parsed.host,
        database: parsed.database || undefined,
        ssl: pgSslOption(),
        max: process.env.VERCEL ? 2 : 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 20000,
    };
    if (parsed.options) {
        config.options = parsed.options;
    }
    if (parsed.port != null && parsed.port !== '') {
        const p = Number(parsed.port);
        if (!Number.isNaN(p) && p > 0) {
            config.port = p;
        }
    }
    if (!config.host || !config.user) {
        throw new Error('Invalid Postgres connection string: missing host or user');
    }
    return config;
}

function buildMysqlPoolConfig() {
    const dbUrl = process.env.DATABASE_URL?.trim() || '';
    if (dbUrl && /^postgres/i.test(dbUrl) && !forceMysqlDialect) {
        throw new Error('DATABASE_URL is PostgreSQL; use POSTGRES_* or set DATABASE_DIALECT=mysql and clear DATABASE_URL.');
    }
    if (dbUrl && /^mysql/i.test(dbUrl)) {
        return dbUrl;
    }

    const useSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';

    let ssl;
    if (useSsl) {
        const explicitRelax =
            process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false' ||
            process.env.DB_SSL_REJECT_UNAUTHORIZED === '0';
        const explicitStrict =
            process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' ||
            process.env.DB_SSL_REJECT_UNAUTHORIZED === '1';
        if (explicitRelax) {
            ssl = { rejectUnauthorized: false };
        } else if (explicitStrict) {
            ssl = { rejectUnauthorized: true };
        } else if (process.env.VERCEL) {
            ssl = { rejectUnauthorized: false };
        } else {
            ssl = { rejectUnauthorized: true };
        }
    }

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

const postgresUrlRaw = forceMysqlDialect ? null : getPostgresConnectionString();
const dialect = postgresUrlRaw ? 'postgres' : 'mysql';

let mysqlPool = null;
let pgPool = null;
let mysqlPoolConfig = null;
let mysqlBlankPasswordFallbackTried = false;
let mysqlCreateDatabaseTried = false;

if (dialect === 'postgres') {
    pgPool = new PgPool(buildPgPoolConfig(postgresUrlRaw));
} else {
    const cfg = buildMysqlPoolConfig();
    mysqlPoolConfig = cfg;
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

function canTryMysqlBlankPasswordFallback(error) {
    if (dialect !== 'mysql') return false;
    if (mysqlBlankPasswordFallbackTried) return false;
    if (!error || String(error.code) !== 'ER_ACCESS_DENIED_ERROR') return false;
    if (!mysqlPoolConfig || typeof mysqlPoolConfig === 'string') return false;
    const user = String(mysqlPoolConfig.user || '').toLowerCase();
    if (user !== 'root') return false;
    const hasPassword = String(mysqlPoolConfig.password ?? '').length > 0;
    return hasPassword;
}

function switchMysqlPoolToBlankPassword() {
    if (!mysqlPoolConfig || typeof mysqlPoolConfig === 'string') return false;
    const nextCfg = { ...mysqlPoolConfig, password: '' };
    try {
        if (mysqlPool && typeof mysqlPool.end === 'function') {
            mysqlPool.end(() => {});
        }
    } catch (_) {}
    mysqlPoolConfig = nextCfg;
    mysqlPool = mysql.createPool(nextCfg);
    mysqlBlankPasswordFallbackTried = true;
    console.warn(
        'MySQL auth failed for root with configured password; retried with blank password fallback.'
    );
    return true;
}

function canTryMysqlCreateDatabase(error) {
    if (dialect !== 'mysql') return false;
    if (mysqlCreateDatabaseTried) return false;
    if (!error || String(error.code) !== 'ER_BAD_DB_ERROR') return false;
    if (!mysqlPoolConfig || typeof mysqlPoolConfig === 'string') return false;
    return String(mysqlPoolConfig.database || '').trim().length > 0;
}

async function createMissingMysqlDatabaseAndReconnect() {
    if (!mysqlPoolConfig || typeof mysqlPoolConfig === 'string') return false;
    const dbName = String(mysqlPoolConfig.database || '').trim();
    if (!dbName) return false;

    const adminCfg = { ...mysqlPoolConfig };
    delete adminCfg.database;

    const adminPool = mysql.createPool(adminCfg);
    try {
        await adminPool
            .promise()
            .query(`CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '``')}\``);
    } finally {
        try {
            await adminPool.end();
        } catch (_) {}
    }

    try {
        if (mysqlPool && typeof mysqlPool.end === 'function') {
            mysqlPool.end(() => {});
        }
    } catch (_) {}
    mysqlPool = mysql.createPool(mysqlPoolConfig);
    mysqlCreateDatabaseTried = true;
    console.warn(`MySQL database "${dbName}" was missing; created automatically.`);
    return true;
}

async function queryMysql(sql, params) {
    try {
        return await mysqlPool.promise().query(sql, params);
    } catch (error) {
        if (canTryMysqlCreateDatabase(error) && (await createMissingMysqlDatabaseAndReconnect())) {
            return mysqlPool.promise().query(sql, params);
        }
        if (canTryMysqlBlankPasswordFallback(error) && switchMysqlPoolToBlankPassword()) {
            return mysqlPool.promise().query(sql, params);
        }
        throw error;
    }
}

async function query(sql, params) {
    if (dialect === 'postgres') {
        return queryPostgres(sql, params);
    }
    return queryMysql(sql, params ?? []);
}

module.exports = {
    query,
    dialect,
    forceMysqlDialect,
    getPostgresConnectionEnvKey,
    getPostgresEnvFlags,
};
