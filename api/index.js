/**
 * Vercel invokes this function for /api and /api/* (see vercel.json rewrites).
 * This keeps backend/server.js as the single Express app entrypoint.
 */
module.exports = require('../backend/server.js');
