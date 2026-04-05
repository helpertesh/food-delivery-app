/**
 * Vercel build step: static HTML must live in public/ (Express static is not used on Vercel).
 * See https://vercel.com/guides/using-express-with-vercel#serving-static-assets
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'frontend');
const dest = path.join(root, 'public');

if (!fs.existsSync(src)) {
    console.error('Missing frontend/ directory.');
    process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true, force: true });
console.log('Copied frontend/ -> public/ for Vercel.');
