// config/database.js
const mysql = require('mysql2');

// Use DB_* env vars on Vercel / production; local .env optional (see .env.example).
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'food_delivery_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

// Convert pool to use promises
const promisePool = pool.promise();

module.exports = promisePool;