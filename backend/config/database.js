// config/database.js
const mysql = require('mysql2');

/**
 * Pool config for local dev and Vercel.
 * Hosted MySQL (Railway, PlanetScale, Aiven, RDS, etc.) usually needs DB_SSL=true or DATABASE_URL with TLS.
 */
function buildPoolConfig() {
    const dbUrl = process.env.DATABASE_URL?.trim();
    if (dbUrl) {
        return dbUrl;
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

const cfg = buildPoolConfig();
const pool = typeof cfg === 'string' ? mysql.createPool(cfg) : mysql.createPool(cfg);

module.exports = pool.promise();
