const path = require('path');
// override: true — if Windows/shell already defines empty DB_* vars, .env must still win.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const mpesaDaraja = require('./services/mpesaDaraja');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./config/database');
const { ensureFeatureTables } = require('./services/featureTables');
const aiAssist = require('./services/aiAssist');

const app = express();
const PORT = process.env.PORT || 3000;

/** Stock kitchen prep loop for “live” view while status is preparing (override with PREP_LIVE_VIDEO_URL). */
const DEFAULT_PREP_LIVE_VIDEO_URL =
    'https://assets.mixkit.co/videos/preview/mixkit-person-preparing-a-salad-in-a-bowl-42907-large.mp4';

function defaultPrepLiveVideoUrl() {
    const u = (process.env.PREP_LIVE_VIDEO_URL || '').trim();
    return u || DEFAULT_PREP_LIVE_VIDEO_URL;
}

function buildOrderTrackTimeline(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'cancelled') {
        return [{ key: 'cancelled', label: 'Cancelled', done: false, active: true }];
    }
    const prepDone = s === 'transit' || s === 'delivered';
    const prepActive = s === 'pending' || s === 'confirmed' || s === 'preparing';
    const transitDone = s === 'delivered';
    const transitActive = s === 'transit';
    const deliveredActive = s === 'delivered';
    return [
        { key: 'prep', label: 'Preparation', done: prepDone, active: prepActive },
        { key: 'transit', label: 'On the way', done: transitDone, active: transitActive },
        { key: 'delivered', label: 'Delivered', done: deliveredActive, active: deliveredActive },
    ];
}

function resolveEstimatedDeliveryIso(row) {
    if (row.estimated_delivery_at != null) {
        const d = new Date(row.estimated_delivery_at);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const created = row.created_at ? new Date(row.created_at) : new Date();
    return new Date(created.getTime() + 45 * 60 * 1000).toISOString();
}

function loadJsonUsersFallback() {
    try {
        const usersPath = path.join(__dirname, 'database', 'users.json');
        if (!fs.existsSync(usersPath)) return [];
        const raw = fs.readFileSync(usersPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.users)) return [];
        return parsed.users;
    } catch (e) {
        console.warn('users.json fallback load error:', e.message);
        return [];
    }
}

const DEFAULT_SEED_MENU_ITEMS = [
    ['Nyama Choma', 'Popular with nearby orders', 450, 'Main Course'],
    ['Pilau Beef', 'Spiced rice with tender beef', 380, 'Main Course'],
    ['Fish Fillet', 'Crispy fillet with lemon sauce', 420, 'Main Course'],
    ['Chicken Biryani', 'Aromatic biryani with tender chicken', 520, 'Main Course'],
    ['Beef Stew & Rice', 'Slow-cooked beef stew with steamed rice', 360, 'Main Course'],
    ['Chapati & Beans', 'Soft chapati served with rich beans', 220, 'Main Course'],
    ['Ugali & Tilapia', 'Classic ugali with fried tilapia', 600, 'Main Course'],
    ['Mandazi', 'Freshly made soft mandazi', 80, 'Snacks'],
    ['Samosa', 'Crispy snack with spicy filling', 70, 'Snacks'],
    ['Chips Masala', 'Fries tossed in tangy masala sauce', 260, 'Snacks'],
    ['Bhajia', 'Crunchy potato bhajia with dip', 190, 'Snacks'],
    ['Hot Tea', 'Pairs well with your usual picks', 80, 'Drinks'],
    ['Fresh Juice', 'Seasonal fruit blend', 150, 'Drinks'],
    ['Soda 500ml', 'Chilled soft drink', 100, 'Drinks'],
    ['Mineral Water', 'Still bottled water', 70, 'Drinks'],
    ['Chocolate Cake', 'Rich slice for dessert', 220, 'Desserts'],
    ['Ice Cream Sundae', 'Vanilla sundae with toppings', 240, 'Desserts'],
    ['Fruit Salad', 'Fresh seasonal fruit bowl', 180, 'Desserts'],
    ['Pancake Stack', 'Fluffy pancakes with syrup', 260, 'Breakfast'],
    ['Spanish Omelette', 'Three-egg omelette with veggies', 230, 'Breakfast'],
    ['Sausage & Eggs', 'Breakfast plate with sausage and eggs', 250, 'Breakfast'],
    ['Coleslaw', 'Creamy fresh coleslaw side', 120, 'Sides'],
    ['Kachumbari', 'Fresh tomato-onion-coriander side', 90, 'Sides'],
    ['Kenyan Cane 250ml', 'Kenyan Cane spirit (18+ only)', 350, 'Alcoholic Drinks'],
    ['Johnnie Walker Red Label', 'Whisky serving (18+ only)', 650, 'Alcoholic Drinks'],
    ['Smirnoff Vodka', 'Vodka serving (18+ only)', 450, 'Alcoholic Drinks'],
    ['Tusker Lager', 'Local beer bottle (18+ only)', 300, 'Alcoholic Drinks'],
    ['Captain Morgan Rum', 'Dark rum serving (18+ only)', 500, 'Alcoholic Drinks'],
    ['Gilbeys Gin', 'Gin serving (18+ only)', 480, 'Alcoholic Drinks'],
];

function getOfflineMenuFallbackItems() {
    return DEFAULT_SEED_MENU_ITEMS.map(([name, description, price, category], idx) => ({
        id: idx + 1,
        name,
        description,
        price: Number(price),
        compare_at_price: null,
        image_url: '',
        category,
        status: 'Available',
    }));
}

function loadJsonSafe(filePath, fallbackValue) {
    try {
        if (!fs.existsSync(filePath)) return fallbackValue;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) return fallbackValue;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('loadJsonSafe error:', e.message);
        return fallbackValue;
    }
}

function saveJsonSafe(filePath, value) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn('saveJsonSafe error:', e.message);
        return false;
    }
}

function getDemoStatePath() {
    return path.join(__dirname, 'database', 'demo-state.json');
}

function getDemoState() {
    return loadJsonSafe(getDemoStatePath(), {
        loyaltyPointsByEmail: {},
        reviews: [],
        reviewedOrdersByEmail: {},
    });
}

function setDemoState(next) {
    saveJsonSafe(getDemoStatePath(), next);
}

function demoLoyaltyBalanceForUser(user) {
    const st = getDemoState();
    const email = String(user?.email || '').toLowerCase();
    const pts = st.loyaltyPointsByEmail?.[email];
    if (Number.isFinite(Number(pts))) return Number(pts);
    // Demo balance so redemption works even offline.
    return 420;
}

function buildOfflineLoyaltyRewards() {
    const items = getOfflineMenuFallbackItems();
    return items.map((it) => ({
        id: it.id,
        name: it.name,
        description: it.description,
        price: it.price,
        compare_at_price: it.compare_at_price,
        image_url: it.image_url,
        category: it.category,
        pointsCost: loyaltyPointsCostForMenuPrice(it.price),
    }));
}

function buildOfflineLeaderboardWinners(currentUser) {
    const winners = [
        {
            rank: 1,
            userId: 1,
            name: 'Amina W.',
            email: 'amina@example.com',
            ordersCount: 14,
            totalSpent: 8420,
            avgRating: 4.7,
            perks: { freeFoodVoucherKes: 800, freeDelivery: true },
        },
        {
            rank: 2,
            userId: 2,
            name: 'Kevin M.',
            email: 'kevin@example.com',
            ordersCount: 11,
            totalSpent: 6590,
            avgRating: 4.5,
            perks: { freeFoodVoucherKes: 600, freeDelivery: true },
        },
        {
            rank: 3,
            userId: 3,
            name: 'Joy N.',
            email: 'joy@example.com',
            ordersCount: 9,
            totalSpent: 5210,
            avgRating: 4.4,
            perks: { freeFoodVoucherKes: 400, freeDelivery: true },
        },
    ];

    let currentUserReward = null;
    if (currentUser?.email) {
        const match = winners.find(
            (w) => String(w.email).toLowerCase() === String(currentUser.email).toLowerCase()
        );
        if (match) {
            currentUserReward = {
                rank: match.rank,
                freeFoodVoucherKes: match.perks.freeFoodVoucherKes,
                freeDelivery: match.perks.freeDelivery,
            };
        }
    }
    return { winners, currentUserReward };
}

function buildOfflinePendingReviewsForEmail(emailLower) {
    const st = getDemoState();
    const reviewed = new Set(st.reviewedOrdersByEmail?.[emailLower] || []);
    const demoOrders = [
        { order_id: 101, total_amount: 860, status: 'delivered' },
        { order_id: 102, total_amount: 520, status: 'transit' },
    ];
    const now = Date.now();
    return demoOrders
        .filter((o) => !reviewed.has(o.order_id))
        .map((o, idx) => ({
            order_id: o.order_id,
            total_amount: o.total_amount,
            status: o.status,
            created_at: new Date(now - (idx + 1) * 24 * 60 * 60 * 1000).toISOString(),
        }));
}

if (process.env.VERCEL) {
    app.set('trust proxy', 1);
}

/** @type {Map<string, { status: string, resultCode?: number, resultDesc?: string, amount?: number, mpesaReceipt?: string, phone254?: string, createdAt: number, simulated?: boolean }>} */
const mpesaTransactionState = new Map();

// Uploads: local disk in dev; /tmp on Vercel (ephemeral — use image URLs or cloud storage for production).
const uploadsDir = process.env.VERCEL
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('📁 Created uploads directory');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename: timestamp-randomnumber-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'food-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 80 * 1024 * 1024 }, // 80MB (videos)
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const imageExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const videoExt = ['.mp4', '.webm', '.mov', '.m4v'];
        const okExt = imageExt.includes(ext) || videoExt.includes(ext);
        if (!okExt) {
            return cb(
                new Error(
                    'Allowed: images (jpg, png, gif, webp) or videos (mp4, webm, mov, m4v).'
                )
            );
        }
        const isImg = file.mimetype.startsWith('image/');
        const isVid = file.mimetype.startsWith('video/') || file.mimetype === 'application/octet-stream';
        if (imageExt.includes(ext) && isImg) return cb(null, true);
        if (videoExt.includes(ext) && (isVid || file.mimetype === '')) return cb(null, true);
        // Some clients send generic types; extension already validated above.
        return cb(null, true);
    },
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Vercel rewrites /api/* and /uploads/* to this serverless entry with ?__v_path=... (see vercel.json).
// Without this, Express only sees "/" and returns HTML — the dashboard then throws "Unexpected token '<'".
app.use((req, res, next) => {
    const raw = req.query.__v_path;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return next();
    }
    try {
        const pathPart = decodeURIComponent(Array.isArray(raw) ? raw[0] : String(raw));
        const normalized = pathPart.replace(/^\/+/, '').replace(/\.\./g, '');
        if (!normalized) return next();

        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(req.query)) {
            if (k === '__v_path') continue;
            if (Array.isArray(v)) {
                v.forEach((item) => params.append(k, String(item)));
            } else if (v != null) {
                params.append(k, String(v));
            }
        }
        const tail = params.toString();
        const prefix = normalized.startsWith('uploads/') ? '/' : '/api/';
        req.url = prefix + normalized + (tail ? `?${tail}` : '');
        // Express already parsed req.query from the original URL; refresh so handlers see orderId, userId, etc.
        if (tail) {
            req.query = Object.fromEntries(new URLSearchParams(tail));
        } else {
            req.query = {};
        }
    } catch (e) {
        console.warn('__v_path rewrite:', e.message);
    }
    next();
});

// Serve uploaded images statically
app.use('/uploads', express.static(uploadsDir));

// Serve user-provided hero/background images from Cursor-attached assets (local/dev convenience).
const sharedImagesDir = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '.cursor',
    'projects',
    'c-Users-hp-my-projects-food-delivery-app',
    'assets'
);
if (fs.existsSync(sharedImagesDir)) {
    app.use('/shared-images', express.static(sharedImagesDir));
}

// Note: express.static moved to bottom - API routes must come first!
// (This ensures /api/* routes are handled by Express, not served as static files)

// Initialize admin user on startup
async function initializeAdmin() {
    try {
        // First check if users table exists
        const [tables] = await db.query("SHOW TABLES LIKE 'users'");
        
        if (tables.length === 0) {
            console.log('🛠️ users table missing. Creating core users table...');
            await db.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    email VARCHAR(100) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    phone VARCHAR(20),
                    address TEXT,
                    is_admin TINYINT(1) DEFAULT 0,
                    loyalty_points INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ users table ready');
        }
        
        // Check if is_admin column exists, if not add it
        try {
            await db.query('SELECT is_admin FROM users LIMIT 1');
        } catch (error) {
            // Column doesn't exist, add it
            console.log('📝 Adding is_admin column to users table...');
            await db.query('ALTER TABLE users ADD COLUMN is_admin TINYINT(1) DEFAULT 0');
            console.log('✅ is_admin column added');
        }
        
        // Check if admin exists
        const [admins] = await db.query('SELECT * FROM users WHERE is_admin = 1 LIMIT 1');
        
        if (admins.length === 0) {
            // Create default admin user
            console.log('👑 Creating default admin user...');
            const adminEmail = 'admin@fooddelivery.com';
            const adminPassword = await bcrypt.hash('admin123', 10);
            
            try {
                const [result] = await db.query(
                    'INSERT INTO users (name, email, password, phone, address, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
                    ['Admin User', adminEmail, adminPassword, '1234567890', 'Admin Address', 1]
                );
                console.log('✅ Default admin created!');
                console.log('   📧 Email: admin@fooddelivery.com');
                console.log('   🔑 Password: admin123');
            } catch (error) {
                // User might already exist, just update to admin
                await db.query('UPDATE users SET is_admin = 1 WHERE email = ?', [adminEmail]);
                console.log('✅ Existing user promoted to admin');
            }
        } else {
            console.log('✅ Admin user already exists');
        }
    } catch (error) {
        console.error('⚠️ Error initializing admin:', error.message);
        console.log('💡 Admin can be created later using /api/admin/create-admin endpoint');
    }
}

async function ensureCoreMysqlTablesAndSeed() {
    if (db.dialect !== 'mysql') return;
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS category (
                category_id INT AUTO_INCREMENT PRIMARY KEY,
                category_name VARCHAR(255) NOT NULL UNIQUE
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS food_item (
                food_id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL,
                compare_at_price DECIMAL(10,2) NULL,
                image VARCHAR(500),
                category_id INT NULL,
                status VARCHAR(50) DEFAULT 'Available',
                CONSTRAINT fk_food_category
                    FOREIGN KEY (category_id) REFERENCES category(category_id)
                    ON DELETE SET NULL
                    ON UPDATE CASCADE
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                delivery_address TEXT NOT NULL,
                payment_method VARCHAR(100) DEFAULT 'Cash on Delivery',
                estimated_delivery_at DATETIME NULL,
                prep_live_video_url VARCHAR(500) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_orders_user
                    FOREIGN KEY (customer_id) REFERENCES users(id)
                    ON DELETE CASCADE
                    ON UPDATE CASCADE
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                food_id INT NOT NULL,
                quantity INT NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                CONSTRAINT fk_order_items_order
                    FOREIGN KEY (order_id) REFERENCES orders(order_id)
                    ON DELETE CASCADE
                    ON UPDATE CASCADE,
                CONSTRAINT fk_order_items_food
                    FOREIGN KEY (food_id) REFERENCES food_item(food_id)
                    ON DELETE RESTRICT
                    ON UPDATE CASCADE
            )
        `);

        const categoryNames = [
            'Main Course',
            'Snacks',
            'Drinks',
            'Desserts',
            'Breakfast',
            'Sides',
            'Alcoholic Drinks',
        ];
        for (const cat of categoryNames) {
            await db.query('INSERT IGNORE INTO category (category_name) VALUES (?)', [cat]);
        }

        const [cats] = await db.query('SELECT category_id, category_name FROM category');
        const catIdByName = Object.fromEntries(
            (cats || []).map((c) => [String(c.category_name), Number(c.category_id)])
        );

        // Keep Alcoholic Drinks strictly alcohol (no juice/soda/water/tea rows).
        const alcCatId = catIdByName['Alcoholic Drinks'];
        const softDrinksCatId = catIdByName['Drinks'];
        if (alcCatId && softDrinksCatId) {
            await db.query(
                `UPDATE food_item
                 SET category_id = ?
                 WHERE category_id = ?
                   AND (
                       LOWER(name) LIKE '%juice%' OR
                       LOWER(name) LIKE '%soda%' OR
                       LOWER(name) LIKE '%water%' OR
                       LOWER(name) LIKE '%tea%'
                   )`,
                [softDrinksCatId, alcCatId]
            );
        }

        let inserted = 0;
        for (const [name, description, price, catName] of DEFAULT_SEED_MENU_ITEMS) {
            const [exists] = await db.query(
                'SELECT food_id FROM food_item WHERE LOWER(name) = LOWER(?) LIMIT 1',
                [name]
            );
            if (exists.length > 0) continue;
            await db.query(
                'INSERT INTO food_item (name, description, price, category_id, status) VALUES (?, ?, ?, ?, ?)',
                [name, description, price, catIdByName[catName] || null, 'Available']
            );
            inserted += 1;
        }
        if (inserted > 0) {
            console.log(`✅ Seeded ${inserted} menu items (including alcoholic drinks)`);
        }
    } catch (error) {
        console.warn('ensureCoreMysqlTablesAndSeed:', error.message);
    }
}

async function ensureSampleLeaderboardOrders() {
    if (db.dialect !== 'mysql') return;
    try {
        const [orderCountRows] = await db.query('SELECT COUNT(*) AS c FROM orders');
        const orderCount = Number(orderCountRows?.[0]?.c || 0);
        if (orderCount > 0) return;

        const [foodRows] = await db.query(
            `SELECT food_id, name, price FROM food_item WHERE status = 'Available' ORDER BY food_id`
        );
        if (!Array.isArray(foodRows) || foodRows.length === 0) return;

        let [userRows] = await db.query(
            'SELECT id, name, address, is_admin FROM users WHERE COALESCE(is_admin,0) = 0 ORDER BY id ASC LIMIT 3'
        );
        if (!Array.isArray(userRows) || userRows.length < 3) {
            [userRows] = await db.query(
                'SELECT id, name, address, is_admin FROM users ORDER BY COALESCE(is_admin,0) ASC, id ASC LIMIT 3'
            );
        }
        if (!Array.isArray(userRows) || userRows.length === 0) return;

        const picksForUser = [
            [0, 1, 2], // strongest spender
            [2, 3, 5],
            [1, 4, 6],
        ];
        const orderCountPerUser = [3, 2, 1];

        for (let uIdx = 0; uIdx < userRows.length; uIdx++) {
            const u = userRows[uIdx];
            const cycles = orderCountPerUser[uIdx] || 1;
            for (let o = 0; o < cycles; o++) {
                const pickIndexes = picksForUser[uIdx] || [0, 1, 2];
                const selected = pickIndexes.map((idx) => foodRows[(idx + o) % foodRows.length]);
                const lines = selected.map((f, i) => ({
                    food_id: Number(f.food_id),
                    quantity: i === 0 ? 2 : 1,
                    price: Number(f.price || 0),
                }));
                const total = lines.reduce((sum, ln) => sum + ln.price * ln.quantity, 0);
                const status = o === cycles - 1 ? 'pending' : 'delivered';
                const createdAt = new Date(Date.now() - (uIdx * 3 + o + 1) * 86400000);

                const [ins] = await db.query(
                    'INSERT INTO orders (customer_id, total_amount, status, delivery_address, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                    [
                        Number(u.id),
                        Math.round(total * 100) / 100,
                        status,
                        String(u.address || 'Nairobi'),
                        'M-Pesa STK (simulation)',
                        createdAt,
                    ]
                );
                const orderId = Number(ins.insertId);
                for (const ln of lines) {
                    await db.query(
                        'INSERT INTO order_items (order_id, food_id, quantity, price) VALUES (?, ?, ?, ?)',
                        [orderId, ln.food_id, ln.quantity, ln.price]
                    );
                }
            }
        }
        console.log('✅ Seeded sample orders for leaderboard');
    } catch (error) {
        console.warn('ensureSampleLeaderboardOrders:', error.message);
    }
}

// Ensure feature tables, then admin bootstrap
(async () => {
    await ensureCoreMysqlTablesAndSeed();
    try {
        await ensureFeatureTables(db);
    } catch (e) {
        console.warn('ensureFeatureTables:', e.message);
    }
    await initializeAdmin();
    await ensureSampleLeaderboardOrders();
})();

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

// Test admin endpoint (simple version) - ADDED AT: ' + new Date().toISOString()
app.get('/api/test-admin-route', (req, res) => {
    res.json({ 
        message: 'Admin route test - server can see this route!',
        timestamp: new Date().toISOString(),
        serverVersion: 'v2.0'
    });
});

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

function sanitizeDbErrorForClient(error) {
    const m = (error.message || '').slice(0, 280);
    const c = error.code;
    if (c === '28P01' || /password authentication failed/i.test(m)) {
        return 'PostgreSQL authentication failed. In Supabase, reset the database password and refresh the Vercel Supabase integration (or update POSTGRES_* URLs).';
    }
    if (/certificate|self-signed|TLS|SSL/i.test(m)) {
        return 'TLS/SSL error while connecting to Postgres.';
    }
    if (c === 'ENOTFOUND' || c === 'ECONNREFUSED' || /getaddrinfo|ETIMEDOUT|timeout/i.test(m)) {
        return 'Network error: could not reach the database host (wrong host/port or firewall).';
    }
    return m || String(c || 'unknown error');
}

// Test database connection
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS solution');
        res.json({
            success: true,
            message: 'Database connected!',
            solution: rows[0].solution,
            dialect: db.dialect,
            mysqlForced: db.forceMysqlDialect,
        });
    } catch (error) {
        console.error('Database connection error:', error);
        const payload = {
            success: false,
            message: 'Database connection failed',
            dialect: db.dialect,
            detail: sanitizeDbErrorForClient(error),
            code: error.code != null ? String(error.code) : null,
        };
        if (db.dialect === 'postgres') {
            payload.postgresConnectionFrom = db.getPostgresConnectionEnvKey();
            payload.postgresEnvSet = db.getPostgresEnvFlags();
        }
        if (process.env.VERCEL) {
            payload.hint =
                db.dialect === 'postgres'
                    ? 'Supabase: use a full postgresql:// URI on POSTGRES_PRISMA_URL or POSTGRES_URL. Run backend/schema.supabase.sql in the SQL Editor if tables are missing.'
                    : 'Set DATABASE_URL (mysql://…) or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME. Most cloud MySQL needs DB_SSL=true.';
        } else if (db.dialect === 'mysql') {
            payload.hint =
                'Local/ngrok: start MySQL (e.g. XAMPP), set DATABASE_DIALECT=mysql and DB_* in backend/.env, create DB_NAME and import schema if needed. Hit /api/test-db on the same base URL as the app.';
        }
        if (db.forceMysqlDialect) {
            payload.mysqlForced = true;
        }
        res.status(500).json(payload);
    }
});

// SIGNUP endpoint - FIXED VERSION
app.post('/api/signup', async (req, res) => {
    try {
        console.log('🔵 SIGNUP ATTEMPT:', req.body);
        
        const { name, email, password, phone, address } = req.body;
        
        // Basic validation
        if (!name || !email || !password || !phone || !address) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required' 
            });
        }
        
        // Check if user exists
        const [existing] = await db.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email already exists' 
            });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert user
        const [result] = await db.query(
            'INSERT INTO users (name, email, password, phone, address) VALUES (?, ?, ?, ?, ?)',
            [name, email, hashedPassword, phone, address]
        );
        
        console.log('✅ USER SAVED TO MySQL! ID:', result.insertId);
        
        // Verify it was saved
        const [check] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        console.log('📊 Verification - User in DB:', check[0] ? 'YES' : 'NO');
        
        res.json({ 
            success: true, 
            message: 'Signup successful!',
            user: {
                id: result.insertId,
                name,
                email
            }
        });
        
    } catch (error) {
        console.error('❌ SIGNUP ERROR:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

// LOGIN endpoint with MySQL
app.post('/api/login', async (req, res) => {
    try {
        console.log('🔑 Login attempt received:', req.body.email);
        const { email, password } = req.body;

        // Basic validation
        if (!email || !password) {
            console.log('❌ Missing email or password');
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }

        // Find user in DB first; when DB is offline (demo/local), fall back to users.json.
        console.log('🔍 Finding user:', email);
        let users;
        try {
            const [dbUsers] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
            users = dbUsers;
        } catch (dbError) {
            if (String(dbError?.code) !== 'ECONNREFUSED') {
                throw dbError;
            }
            const jsonUsers = loadJsonUsersFallback();
            users = jsonUsers.filter(
                (u) => String(u?.email || '').toLowerCase() === String(email).toLowerCase()
            );
            console.warn(
                `DB connection refused during login. Using users.json fallback for ${email}.`
            );
        }

        if (users.length === 0) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        const user = users[0];
        console.log('✅ User found:', user.name);

        if (!user.password) {
            console.log('❌ User has no password hash:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        // Check password
        console.log('🔐 Verifying password...');
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        console.log('✅ Login successful for:', email);
        const loyaltyPts =
            user.loyalty_points != null ? Number(user.loyalty_points) : 0;
        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                address: user.address,
                loyaltyPoints: Number.isFinite(loyaltyPts) ? loyaltyPts : 0,
                isAdmin:
                    user.is_admin === 1 ||
                    user.is_admin === true ||
                    user.is_admin === '1' ||
                    user.isAdmin === true,
            },
        });

    } catch (error) {
        console.error('❌❌❌ LOGIN ERROR DETAILS:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error stack:', error.stack);

        const payload = {
            success: false,
            message: 'Server error during login',
            hint:
                'Put DATABASE_DIALECT=mysql and DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in backend/.env (the server does not load the repo root .env). Start MySQL, then open /api/test-db on the same URL you use for the app.',
        };
        if (process.env.NODE_ENV !== 'production') {
            payload.detail = error.message;
            if (error.code) payload.code = String(error.code);
        }
        res.status(500).json(payload);
    }
});

/** Normalize phone digits for comparison (07…, 7…, 254…). */
function normalizePhoneDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '254' + d.slice(1);
    else if (d.startsWith('7') && d.length === 9) d = '254' + d;
    return d;
}

// Reset password when user forgot it — verifies email + phone match the account (no email SMTP).
app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, phone, newPassword } = req.body;

        if (!email || !phone || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Email, phone, and new password are required.',
            });
        }

        if (String(newPassword).length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters.',
            });
        }

        const emailNorm = String(email).trim();
        const [users] = await db.query(
            'SELECT id, email, phone FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))',
            [emailNorm]
        );

        const genericFail = {
            success: false,
            message:
                'Could not reset password. Make sure the email and phone number match what you used at sign up.',
        };

        if (users.length === 0) {
            return res.status(400).json(genericFail);
        }

        const user = users[0];
        const inputPhone = normalizePhoneDigits(phone);
        const storedPhone = normalizePhoneDigits(user.phone);

        if (!inputPhone || inputPhone !== storedPhone) {
            return res.status(400).json(genericFail);
        }

        const hashedPassword = await bcrypt.hash(String(newPassword), 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

        console.log('✅ Password reset for user id:', user.id);
        res.json({
            success: true,
            message: 'Password updated. You can log in with your new password.',
        });
    } catch (error) {
        console.error('❌ reset-password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while resetting password.',
            ...(process.env.NODE_ENV !== 'production' ? { detail: error.message } : {}),
        });
    }
});

// Get all users - ONE VERSION ONLY
app.get('/api/users', async (req, res) => {
    try {
        console.log('📋 Fetching all users...');
        const [users] = await db.query('SELECT id, name, email, phone, address, created_at FROM users');
        console.log(`✅ Found ${users.length} users`);
        res.json({ success: true, users });
    } catch (error) {
        console.error('❌ Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT id, name, email, phone, address, created_at FROM users WHERE id = ?',
            [req.params.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json({ success: true, user: users[0] });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/** Menu price (KSh) → loyalty points to redeem that dish as a free cart line (server is source of truth). */
function loyaltyPointsCostForMenuPrice(price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return 50;
    return Math.max(30, Math.round(p * 2.2));
}

// ==================== ORDER ENDPOINTS ====================

// Create new order — paid lines use item.price; lines with loyaltyRedeem: true are free in KSh and cost points (computed from DB price)
app.post('/api/orders', async (req, res) => {
    try {
        console.log('🛒 Order received:', JSON.stringify(req.body, null, 2));

        const { userId, items, deliveryAddress, paymentMethod } = req.body;

        if (!userId) {
            console.log('❌ Missing userId');
            return res.status(400).json({
                success: false,
                message: 'User ID is required',
            });
        }

        if (!items || items.length === 0) {
            console.log('❌ No items in cart');
            return res.status(400).json({
                success: false,
                message: 'Cart is empty',
            });
        }

        if (!deliveryAddress) {
            console.log('❌ Missing delivery address');
            return res.status(400).json({
                success: false,
                message: 'Delivery address is required',
            });
        }

        const loyaltyIds = [
            ...new Set(
                items.filter((i) => i.loyaltyRedeem).map((i) => i.id)
            ),
        ];
        const priceById = {};
        if (loyaltyIds.length > 0) {
            const ph = loyaltyIds.map(() => '?').join(',');
            const [frows] = await db.query(
                `SELECT food_id, price FROM food_item WHERE food_id IN (${ph})`,
                loyaltyIds
            );
            frows.forEach((r) => {
                priceById[r.food_id] = r.price;
            });
        }

        let cashSubtotal = 0;
        let rewardPointsTotal = 0;

        for (const item of items) {
            const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
            if (item.loyaltyRedeem) {
                const dbPrice = priceById[item.id];
                if (dbPrice == null) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid or unavailable loyalty reward item',
                    });
                }
                rewardPointsTotal += loyaltyPointsCostForMenuPrice(dbPrice) * qty;
            } else {
                cashSubtotal += parseFloat(item.price) * qty;
            }
        }
        cashSubtotal = Math.round(cashSubtotal * 100) / 100;

        const [urows] = await db.query(
            'SELECT loyalty_points FROM users WHERE id = ?',
            [userId]
        );
        if (urows.length === 0) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }
        const balance = Number(urows[0].loyalty_points || 0);

        if (rewardPointsTotal > balance) {
            return res.status(400).json({
                success: false,
                message: 'Not enough loyalty points for the rewards in your cart',
            });
        }

        const totalAmount = Math.round(cashSubtotal * 100) / 100;
        if (totalAmount <= 0 && rewardPointsTotal <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Cart has nothing to bill',
            });
        }

        const pointsEarned =
            totalAmount > 0 ? Math.max(0, Math.floor(totalAmount / 10)) : 0;

        console.log(
            `💰 Cash subtotal: ${totalAmount}, loyalty reward pts: ${rewardPointsTotal}, earn pts: ${pointsEarned}`
        );

        const etaFragment =
            db.dialect === 'postgres'
                ? `(NOW() + INTERVAL '45 minutes')`
                : 'DATE_ADD(NOW(), INTERVAL 45 MINUTE)';
        const [orderResult] = await db.query(
            `INSERT INTO orders (customer_id, total_amount, status, delivery_address, payment_method, estimated_delivery_at) VALUES (?, ?, ?, ?, ?, ${etaFragment})`,
            [
                userId,
                totalAmount,
                'pending',
                deliveryAddress,
                paymentMethod || 'Cash on Delivery',
            ]
        );

        const orderId = orderResult.insertId;

        for (const item of items) {
            const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
            const linePrice = item.loyaltyRedeem ? 0 : parseFloat(item.price);
            await db.query(
                'INSERT INTO order_items (order_id, food_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.id, qty, linePrice]
            );
        }

        await db.query(
            'UPDATE users SET loyalty_points = GREATEST(0, COALESCE(loyalty_points,0) - ? + ?) WHERE id = ?',
            [rewardPointsTotal, pointsEarned, userId]
        );

        const [after] = await db.query('SELECT loyalty_points FROM users WHERE id = ?', [userId]);
        const newBal = after[0]?.loyalty_points ?? 0;

        res.json({
            success: true,
            message: 'Order placed successfully',
            orderId,
            subtotal: cashSubtotal.toFixed(2),
            loyaltyRedeemed: rewardPointsTotal,
            pointsEarned,
            totalAmount: totalAmount.toFixed(2),
            loyaltyPointsBalance: Number(newBal),
        });
    } catch (error) {
        console.error('❌ ORDER ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Error placing order: ' + error.message,
            error: error.code || 'UNKNOWN_ERROR',
        });
    }
});

// Get user's orders
app.get('/api/orders/user/:userId', async (req, res) => {
    try {
        const [orders] = await db.query(
            'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC',
            [req.params.userId]
        );
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Customer order tracking — query form avoids some proxy/path issues; same payload as /api/orders/:orderId/track
async function serveCustomerOrderTrack(req, res) {
    try {
        const orderId = String(req.params.orderId ?? req.query.orderId ?? '').trim();
        const userId = req.query.userId;
        if (!userId || !/^\d+$/.test(String(orderId))) {
            return res.status(400).json({ success: false, message: 'orderId and userId required' });
        }
        const [rows] = await db.query(
            `SELECT order_id, customer_id, status, created_at, estimated_delivery_at, prep_live_video_url
             FROM orders WHERE order_id = ?`,
            [orderId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        const row = rows[0];
        if (String(row.customer_id) !== String(userId)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const status = String(row.status || 'pending').toLowerCase();
        const estimatedDeliveryAt = resolveEstimatedDeliveryIso(row);
        const terminal = status === 'delivered' || status === 'cancelled';
        const secondsRemaining = terminal
            ? 0
            : Math.max(
                  0,
                  Math.floor((new Date(estimatedDeliveryAt).getTime() - Date.now()) / 1000)
              );
        const showLive = status === 'preparing';
        const customUrl = row.prep_live_video_url && String(row.prep_live_video_url).trim();
        const liveVideoUrl = showLive ? customUrl || defaultPrepLiveVideoUrl() : null;

        res.json({
            success: true,
            orderId: Number(row.order_id),
            status,
            estimatedDeliveryAt,
            secondsRemaining,
            showLive,
            liveVideoUrl,
            timeline: buildOrderTrackTimeline(status),
        });
    } catch (error) {
        console.error('order track:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}

app.get('/api/orders/track', serveCustomerOrderTrack);
app.get('/api/orders/:orderId/track', serveCustomerOrderTrack);

// Customer leaderboard (top spenders/non-cancelled orders) + reward perks for top 3
app.get('/api/leaderboard/customers', async (req, res) => {
    try {
        const currentUserIdRaw = req.query.currentUserId;
        const currentUserId =
            currentUserIdRaw != null && /^\d+$/.test(String(currentUserIdRaw))
                ? Number(currentUserIdRaw)
                : null;

        const [rows] = await db.query(
            `
            SELECT
                u.id AS user_id,
                u.name,
                u.email,
                COUNT(o.order_id) AS orders_count,
                COALESCE(SUM(o.total_amount), 0) AS total_spent,
                COALESCE(AVG(r.stars), 0) AS avg_rating
            FROM users u
            JOIN orders o ON o.customer_id = u.id
            LEFT JOIN reviews r ON r.order_id = o.order_id AND r.user_id = u.id
            WHERE COALESCE(o.status, '') <> 'cancelled'
            GROUP BY u.id, u.name, u.email
            HAVING COUNT(o.order_id) > 0
            ORDER BY total_spent DESC, orders_count DESC, avg_rating DESC, u.id ASC
            LIMIT 3
            `
        );

        const rewardByRank = {
            1: { freeFoodVoucherKes: 800, freeDelivery: true },
            2: { freeFoodVoucherKes: 600, freeDelivery: true },
            3: { freeFoodVoucherKes: 400, freeDelivery: true },
        };

        const winners = rows.map((row, idx) => {
            const rank = idx + 1;
            const perks = rewardByRank[rank] || {
                freeFoodVoucherKes: 0,
                freeDelivery: false,
            };
            return {
                rank,
                userId: Number(row.user_id),
                name: row.name,
                email: row.email,
                ordersCount: Number(row.orders_count || 0),
                totalSpent: Number(row.total_spent || 0),
                avgRating: Number(row.avg_rating || 0),
                perks,
            };
        });

        const myEntry =
            currentUserId == null
                ? null
                : winners.find((w) => Number(w.userId) === Number(currentUserId)) || null;

        res.json({
            success: true,
            period: 'all-time',
            winners,
            currentUserReward: myEntry
                ? {
                      rank: myEntry.rank,
                      freeFoodVoucherKes: myEntry.perks.freeFoodVoucherKes,
                      freeDelivery: myEntry.perks.freeDelivery,
                  }
                : null,
            note: 'Top 3 clients receive free food vouchers and free delivery perks.',
        });
    } catch (error) {
        console.error('leaderboard:', error);
        if (String(error?.code) === 'ECONNREFUSED') {
            const jsonUsers = loadJsonUsersFallback();
            const currentUserIdRaw = req.query.currentUserId;
            const currentUser =
                currentUserIdRaw != null
                    ? jsonUsers.find((u) => String(u?.id) === String(currentUserIdRaw)) || null
                    : null;
            const { winners, currentUserReward } = buildOfflineLeaderboardWinners(currentUser || {});
            return res.json({
                success: true,
                period: 'demo',
                winners,
                currentUserReward,
                fallback: true,
                note: 'Demo leaderboard shown while database is offline.',
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

// Loyalty reward catalog — use /api/loyalty-rewards (not under /api/loyalty/:id) so "rewards" is never captured as userId
async function handleLoyaltyRewardsCatalog(req, res) {
    try {
        const query = `
            SELECT 
                f.food_id AS id,
                f.name,
                f.description,
                f.price,
                f.compare_at_price,
                f.image AS image_url,
                c.category_name AS category
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            WHERE f.status = 'Available'
            ORDER BY c.category_name, f.name
        `;
        const [rows] = await db.query(query);
        const rewards = rows.map((row) => ({
            ...row,
            pointsCost: loyaltyPointsCostForMenuPrice(row.price),
        }));
        res.json({ success: true, rewards });
    } catch (error) {
        console.error('loyalty rewards:', error);
        if (String(error?.code) === 'ECONNREFUSED') {
            const rewards = buildOfflineLoyaltyRewards();
            return res.json({
                success: true,
                rewards,
                fallback: true,
                message: 'Database offline - showing demo redeem options.',
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
}

app.get('/api/loyalty-rewards', handleLoyaltyRewardsCatalog);
app.get('/api/loyalty/rewards', handleLoyaltyRewardsCatalog);

// Loyalty balance (numeric user id only — avoids treating "rewards" as an id)
app.get('/api/loyalty/:userId', async (req, res) => {
    try {
        const uid = req.params.userId;
        if (!/^\d+$/.test(String(uid))) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const [rows] = await db.query('SELECT loyalty_points FROM users WHERE id = ?', [uid]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, loyaltyPoints: Number(rows[0].loyalty_points || 0) });
    } catch (error) {
        console.error('loyalty:', error);
        if (String(error?.code) === 'ECONNREFUSED') {
            const uid = String(req.params.userId);
            const jsonUsers = loadJsonUsersFallback();
            const u =
                jsonUsers.find((x) => String(x?.id) === uid) ||
                jsonUsers.find((x) => String(x?.id) === String(Number(uid))) ||
                null;
            const pts = demoLoyaltyBalanceForUser(u || {});
            return res.json({
                success: true,
                loyaltyPoints: pts,
                fallback: true,
                message: 'Database offline - demo loyalty balance.',
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

// Reviews
app.get('/api/reviews/pending/:userId', async (req, res) => {
    try {
        const [rows] = await db.query(
            `
            SELECT o.order_id, o.total_amount, o.created_at, o.status
            FROM orders o
            LEFT JOIN reviews r ON r.order_id = o.order_id AND r.user_id = o.customer_id
            WHERE o.customer_id = ?
              AND o.status IN ('pending', 'confirmed', 'preparing', 'transit', 'delivered')
              AND r.review_id IS NULL
            ORDER BY o.created_at DESC
            LIMIT 30
            `,
            [req.params.userId]
        );
        res.json({ success: true, pending: rows });
    } catch (error) {
        if (String(error?.code) === 'ECONNREFUSED') {
            const jsonUsers = loadJsonUsersFallback();
            const u = jsonUsers.find((x) => String(x?.id) === String(req.params.userId)) || null;
            const emailLower = String(u?.email || '').toLowerCase();
            const pending = buildOfflinePendingReviewsForEmail(emailLower);
            return res.json({
                success: true,
                pending,
                fallback: true,
                message: 'Database offline - demo pending reviews.',
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const { userId, orderId, stars, comment } = req.body;
        if (!userId || !orderId || stars == null) {
            return res.status(400).json({ success: false, message: 'userId, orderId, stars required' });
        }
        const s = Math.min(5, Math.max(1, Math.round(Number(stars))));
        try {
            const [ords] = await db.query('SELECT customer_id, status FROM orders WHERE order_id = ?', [
                orderId,
            ]);
            if (ords.length === 0 || String(ords[0].customer_id) !== String(userId)) {
                return res.status(403).json({ success: false, message: 'Invalid order' });
            }
            const reviewable = ['pending', 'confirmed', 'preparing', 'transit', 'delivered'];
            if (!reviewable.includes(String(ords[0].status))) {
                return res.status(400).json({
                    success: false,
                    message: 'This order cannot be reviewed (e.g. cancelled).',
                });
            }
            await db.query('INSERT INTO reviews (user_id, order_id, stars, comment) VALUES (?, ?, ?, ?)', [
                userId,
                orderId,
                s,
                String(comment || '').slice(0, 500),
            ]);
            return res.json({ success: true, message: 'Thank you for your review!' });
        } catch (dbErr) {
            if (String(dbErr?.code) !== 'ECONNREFUSED') throw dbErr;
            const jsonUsers = loadJsonUsersFallback();
            const u = jsonUsers.find((x) => String(x?.id) === String(userId)) || null;
            const emailLower = String(u?.email || '').toLowerCase();
            if (!emailLower) {
                return res.status(400).json({ success: false, message: 'User not found (demo mode)' });
            }
            const st = getDemoState();
            const reviewed = new Set(st.reviewedOrdersByEmail?.[emailLower] || []);
            if (reviewed.has(Number(orderId))) {
                return res.status(400).json({ success: false, message: 'You already reviewed this order.' });
            }
            const safeComment = String(comment || '').slice(0, 500);
            st.reviews = Array.isArray(st.reviews) ? st.reviews : [];
            st.reviews.push({
                email: emailLower,
                userId: String(userId),
                orderId: Number(orderId),
                stars: s,
                comment: safeComment,
                createdAt: new Date().toISOString(),
            });
            st.reviewedOrdersByEmail = st.reviewedOrdersByEmail || {};
            st.reviewedOrdersByEmail[emailLower] = [...reviewed, Number(orderId)];
            setDemoState(st);
            return res.json({
                success: true,
                fallback: true,
                message: 'Thank you for your review! (saved in demo mode)',
            });
        }
    } catch (error) {
        if (String(error.code) === 'ER_DUP_ENTRY' || /Duplicate/i.test(error.message)) {
            return res.status(400).json({ success: false, message: 'You already reviewed this order.' });
        }
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

app.get('/api/reviews/stats', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT AVG(stars) AS avgStars, COUNT(*) AS cnt FROM reviews'
        );
        res.json({
            success: true,
            averageStars: rows[0]?.avgStars != null ? Number(rows[0].avgStars) : null,
            count: Number(rows[0]?.cnt || 0),
        });
    } catch (error) {
        if (String(error?.code) === 'ECONNREFUSED') {
            const st = getDemoState();
            const reviews = Array.isArray(st.reviews) ? st.reviews : [];
            const count = reviews.length;
            const avg =
                count === 0
                    ? null
                    : reviews.reduce((sum, r) => sum + (Number(r.stars) || 0), 0) / count;
            return res.json({
                success: true,
                averageStars: avg != null ? Number(avg) : null,
                count,
                fallback: true,
                message: 'Database offline - demo review stats.',
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
});

// AI chat + recommendations
app.post('/api/ai/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ success: false, message: 'message required' });
        }
        const hist = Array.isArray(history) ? history : [];
        const reply = await aiAssist.chatReply(message, hist);
        res.json({ success: true, reply });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/ai/recommendations/:userId', async (req, res) => {
    try {
        const uid = req.params.userId;
        const [past] = await db.query(
            `
            SELECT DISTINCT oi.food_id
            FROM order_items oi
            JOIN orders o ON o.order_id = oi.order_id
            WHERE o.customer_id = ?
            `,
            [uid]
        );
        const pastIds = past.map((p) => p.food_id);
        const [menu] = await db.query(
            `
            SELECT f.food_id AS id, f.name, f.description, f.price, f.compare_at_price,
                   f.image AS image_url, c.category_name AS category
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            WHERE f.status = 'Available'
            `
        );
        const picks = await aiAssist.recommendMeals(menu, pastIds);
        res.json({ success: true, recommendations: picks, pastOrderFoodIds: pastIds });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== M-PESA PAYMENT ENDPOINTS (Safaricom Daraja STK Push) ====================

/** Which MPESA_* vars are set (no secret values). Use when STK returns “not configured”. */
app.get('/api/payment/mpesa/env-check', (req, res) => {
    const configured = mpesaDaraja.isConfigured();
    res.json({
        configured,
        presence: mpesaDaraja.getConfigPresence(),
        effectiveCallbackUrl: mpesaDaraja.effectiveCallbackUrl() || null,
        hint: 'Restart the server after editing backend/.env. Free ngrok URLs change when you restart ngrok — copy the new https URL from http://127.0.0.1:4040',
    });
});

// M-Pesa sends the STK result to CallBackURL — must be HTTPS and publicly reachable (e.g. ngrok).
// GET: opening the callback URL in a browser (or probes) — not a payment. Real callbacks are POST only.
app.get('/api/payment/mpesa/callback', (req, res) => {
    res.status(200).json({
        ok: true,
        message:
            'M-Pesa STK callback endpoint is active. Safaricom sends payment results with HTTP POST only; a browser visit (GET) does not trigger a payment.',
    });
});

app.post('/api/payment/mpesa/callback', (req, res) => {
    try {
        const parsed = mpesaDaraja.parseStkCallback(req.body);
        if (parsed?.checkoutRequestId) {
            const ok = Number(parsed.resultCode) === 0;
            mpesaTransactionState.set(parsed.checkoutRequestId, {
                status: ok ? 'completed' : 'failed',
                resultCode: parsed.resultCode,
                resultDesc: parsed.resultDesc,
                amount: parsed.amount,
                mpesaReceipt: parsed.mpesaReceipt,
                createdAt: Date.now(),
            });
            console.log(
                ok ? '✅ M-Pesa STK completed:' : '⚠️ M-Pesa STK failed:',
                parsed.checkoutRequestId,
                parsed.resultDesc
            );
        } else {
            console.log('📩 M-Pesa callback (unparsed):', JSON.stringify(req.body).slice(0, 500));
        }
        res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (e) {
        console.error('❌ M-Pesa callback error:', e);
        res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
});

app.post('/api/payment/mpesa/stk-push', async (req, res) => {
    try {
        const { phoneNumber, amount, accountReference, transactionDesc } = req.body;

        if (!phoneNumber || amount == null) {
            return res.status(400).json({
                success: false,
                message: 'Phone number and amount are required',
            });
        }

        const formattedPhone = mpesaDaraja.formatPhone254(phoneNumber);
        const amountNum = Math.max(1, Math.round(Number(amount)));

        console.log('📱 STK Push request:', formattedPhone, 'KSh', amountNum);

        if (mpesaDaraja.useSimulation() || !mpesaDaraja.isConfigured()) {
            if (!mpesaDaraja.useSimulation() && !mpesaDaraja.isConfigured()) {
                const presence = mpesaDaraja.getConfigPresence();
                const payload = {
                    success: false,
                    code: 'MPESA_NOT_CONFIGURED',
                    message:
                        'M-Pesa Daraja is not configured. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, and MPESA_CALLBACK_URL in backend/.env (not the repo root .env), then restart node. Or set MPESA_USE_SIMULATION=true for local testing.',
                    presence,
                    hint:
                        'Open GET /api/payment/mpesa/env-check to see which variables the server sees. Ngrok base URL alone is OK — we append /api/payment/mpesa/callback.',
                };
                if (process.env.NODE_ENV !== 'production') {
                    payload.effectiveCallbackUrl = mpesaDaraja.effectiveCallbackUrl() || null;
                }
                return res.status(503).json(payload);
            }

            await new Promise((r) => setTimeout(r, 1500));
            const checkoutRequestId = 'SIM_' + Date.now();
            mpesaTransactionState.set(checkoutRequestId, {
                status: 'pending',
                phone254: formattedPhone,
                createdAt: Date.now(),
                simulated: true,
            });
            console.log('✅ (simulation) STK Push fake ID:', checkoutRequestId);
            return res.json({
                success: true,
                mode: 'simulation',
                message:
                    'Simulated STK Push. No real charge. Status will succeed after a few seconds for testing.',
                checkoutRequestId,
                phoneNumber: formattedPhone,
                amount: amountNum,
            });
        }

        const stk = await mpesaDaraja.initiateStkPush({
            phoneNumber,
            amount: amountNum,
            accountReference: accountReference || 'FoodDelivery',
            transactionDesc: transactionDesc || 'Food order',
        });

        mpesaTransactionState.set(stk.checkoutRequestId, {
            status: 'pending',
            phone254: stk.phone254,
            createdAt: Date.now(),
        });

        res.json({
            success: true,
            mode: 'daraja',
            message:
                stk.customerMessage ||
                'Payment request sent to your phone. Enter your M-Pesa PIN when prompted.',
            checkoutRequestId: stk.checkoutRequestId,
            merchantRequestId: stk.merchantRequestId,
            phoneNumber: stk.phone254,
            amount: stk.amount,
        });
    } catch (error) {
        console.error('❌ Error initiating M-Pesa payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error initiating payment: ' + error.message,
        });
    }
});

app.get('/api/payment/mpesa/status/:checkoutRequestId', (req, res) => {
    try {
        const { checkoutRequestId } = req.params;
        const row = mpesaTransactionState.get(checkoutRequestId);

        if (!row) {
            return res.json({
                success: true,
                status: 'unknown',
                message: 'No transaction found. It may have expired — try initiating payment again.',
            });
        }

        if (row.simulated && row.status === 'pending') {
            if (Date.now() - row.createdAt > 5000) {
                row.status = 'completed';
                row.resultDesc = 'Simulated success';
                mpesaTransactionState.set(checkoutRequestId, row);
            }
        }

        const status = row.status;
        const messages = {
            pending: 'Waiting for you to complete payment on your phone…',
            completed: 'Payment received.',
            failed: row.resultDesc || 'Payment was not completed.',
            unknown: 'Unknown state.',
        };

        res.json({
            success: true,
            status,
            message: messages[status] || messages.unknown,
            mpesaReceipt: row.mpesaReceipt,
            resultCode: row.resultCode,
        });
    } catch (error) {
        console.error('❌ Error checking payment status:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking payment status: ' + error.message,
        });
    }
});

// ==================== MENU ENDPOINTS ====================

/** Some drivers return odd column name casing; always resolve food_item.compare_at_price. */
function pickCompareAtFromRow(row) {
    if (!row || typeof row !== 'object') return undefined;
    const key = Object.keys(row).find((k) => String(k).toLowerCase() === 'compare_at_price');
    if (key !== undefined) return row[key];
    if (row.compareAtPrice !== undefined) return row.compareAtPrice;
    return undefined;
}

/** Parse stored compare-at / “was” price for JSON (handles strings, commas, driver quirks). */
function normalizeCompareAtForApi(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim().replace(/\s/g, '').replace(/,/g, '.');
    if (s === '') return null;
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

const comparePricingErrorMessage =
    'For a discount, set “Was” higher than the sale price. Sale price = “Price (what customers pay)” (e.g. 150). “Was” = old list price (e.g. 200).';

function mapPublicMenuRow(row) {
    const priceNum = row.price != null ? Number(row.price) : NaN;
    const price = Number.isFinite(priceNum) ? priceNum : 0;
    const out = {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        price,
        compare_at_price: normalizeCompareAtForApi(pickCompareAtFromRow(row)),
        image_url: row.image_url,
        category: row.category,
    };
    if (row.status != null && row.status !== undefined) {
        out.status = row.status;
    }
    return out;
}

// Get all menu items (for users)
app.get('/api/menu-items', async (req, res) => {
    try {
        console.log('📋 Fetching menu items...');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
        const query = `
            SELECT 
                f.food_id as id,
                f.name,
                f.description,
                f.price,
                f.compare_at_price,
                f.image as image_url,
                c.category_name as category,
                f.status
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            WHERE f.status = 'Available'
            ORDER BY c.category_name, f.name
        `;
        
        const [rows] = await db.query(query);
        const items = rows.map(mapPublicMenuRow);
        console.log(`✅ Found ${items.length} menu items`);
        
        res.json({ success: true, items });
    } catch (error) {
        console.error('❌ Error fetching menu:', error);
        if (String(error?.code) === 'ECONNREFUSED') {
            const fallbackItems = getOfflineMenuFallbackItems();
            console.warn(
                `DB connection refused while loading menu. Returning offline fallback (${fallbackItems.length} items).`
            );
            return res.json({
                success: true,
                items: fallbackItems,
                fallback: true,
                message: 'Database offline - showing demo menu.',
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// Loyalty redeem list — registered here (before /category/:name) so it is never mistaken for a category
app.get('/api/menu-items/loyalty-catalog', handleLoyaltyRewardsCatalog);

// Get menu items by category
app.get('/api/menu-items/category/:categoryName', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        const query = `
            SELECT 
                f.food_id as id,
                f.name,
                f.description,
                f.price,
                f.compare_at_price,
                f.image as image_url,
                c.category_name as category
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            WHERE c.category_name = ? AND f.status = 'Available'
            ORDER BY f.name
        `;
        
        const [rows] = await db.query(query, [req.params.categoryName]);
        const items = rows.map(mapPublicMenuRow);
        res.json({ success: true, items });
    } catch (error) {
        console.error('❌ Error fetching menu by category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get all categories
app.get('/api/categories', async (req, res) => {
    try {
        const [categories] = await db.query(
            'SELECT category_id, category_name FROM category ORDER BY category_name'
        );
        res.json({ 
            success: true, 
            categories: categories.map(c => ({
                id: c.category_id,
                name: c.category_name
            }))
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==================== ADMIN ENDPOINTS ====================

// Create or promote user to admin (NO SQL NEEDED - just call this endpoint)
app.post('/api/admin/create-admin', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }
        
        // Check if users table exists, if not create it
        try {
            const [tables] = await db.query("SHOW TABLES LIKE 'users'");
            if (tables.length === 0) {
                console.log('📝 Creating users table...');
                await db.query(`
                    CREATE TABLE IF NOT EXISTS users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        email VARCHAR(255) NOT NULL UNIQUE,
                        password VARCHAR(255) NOT NULL,
                        phone VARCHAR(20) NOT NULL,
                        address TEXT NOT NULL,
                        is_admin TINYINT(1) DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                `);
                console.log('✅ Users table created');
            }
        } catch (error) {
            console.error('Error checking/creating users table:', error);
        }
        
        // Add is_admin column if it doesn't exist
        try {
            await db.query('SELECT is_admin FROM users LIMIT 1');
        } catch (error) {
            await db.query('ALTER TABLE users ADD COLUMN is_admin TINYINT(1) DEFAULT 0');
        }
        
        // Check if user exists
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            // Create new admin user
            const hashedPassword = await bcrypt.hash(password, 10);
            const [result] = await db.query(
                'INSERT INTO users (name, email, password, phone, address, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
                ['Admin', email, hashedPassword, '0000000000', 'Admin Address', 1]
            );
            
            return res.json({ 
                success: true, 
                message: 'Admin user created successfully!',
                userId: result.insertId,
                email: email
            });
        } else {
            // Promote existing user to admin
            await db.query('UPDATE users SET is_admin = 1 WHERE email = ?', [email]);
            return res.json({ 
                success: true, 
                message: 'User promoted to admin successfully!',
                email: email
            });
        }
    } catch (error) {
        console.error('Error creating admin:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// Middleware to check if user is admin (simple version - in production use JWT tokens)
async function checkAdmin(req, res, next) {
    try {
        const userId = req.headers['user-id'] || req.body.userId;
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'User ID required' });
        }
        
        const [users] = await db.query('SELECT is_admin FROM users WHERE id = ?', [userId]);
        
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (!users[0].is_admin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error checking admin status' });
    }
}

// Get all food items (for admin management)
app.get('/api/admin/food-items', checkAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                f.food_id as id,
                f.name,
                f.description,
                f.price,
                f.compare_at_price,
                f.image,
                f.status,
                f.category_id,
                c.category_name as category
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            ORDER BY f.food_id DESC
        `);
        const items = rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            price: row.price,
            compare_at_price: normalizeCompareAtForApi(pickCompareAtFromRow(row)),
            image: row.image,
            status: row.status,
            category_id: row.category_id,
            category: row.category,
        }));
        res.json({ success: true, items });
    } catch (error) {
        console.error('Error fetching food items:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get all categories (for admin dropdown)
app.get('/api/admin/categories', checkAdmin, async (req, res) => {
    try {
        const [categories] = await db.query('SELECT category_id, category_name FROM category ORDER BY category_name');
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add new food item (with file upload support)
app.post('/api/admin/food-items', checkAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, description, price, category_id, status, image, compare_at_price } = req.body;

        const compareAt = normalizeCompareAtForApi(compare_at_price);

        if (!name || !price || !category_id) {
            // Delete uploaded file if validation fails
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ 
                success: false, 
                message: 'Name, price, and category are required' 
            });
        }

        const saleNum = parseFloat(String(price).trim().replace(/\s/g, '').replace(/,/g, '.'));
        if (compareAt != null && Number.isFinite(saleNum) && compareAt <= saleNum) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ success: false, message: comparePricingErrorMessage });
        }
        
        // Use uploaded file path if file was uploaded, otherwise use provided image URL
        let imagePath = image || '';
        if (req.file) {
            // Store relative path: /uploads/filename.ext
            imagePath = '/uploads/' + req.file.filename;
            console.log('📎 Media uploaded:', imagePath);
        }
        
        const [result] = await db.query(
            'INSERT INTO food_item (name, description, price, compare_at_price, image, category_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, description || '', price, compareAt, imagePath, category_id, status || 'Available']
        );
        
        console.log('✅ Food item added with ID:', result.insertId);
        res.json({ 
            success: true, 
            message: 'Food item added successfully',
            itemId: result.insertId,
            imageUrl: imagePath
        });
    } catch (error) {
        // Delete uploaded file if error occurs
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error adding food item:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// Update food item (with file upload support)
app.put('/api/admin/food-items/:id', checkAdmin, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, image, category_id, status, compare_at_price } = req.body;

        const [existingRows] = await db.query(
            'SELECT image, price, compare_at_price FROM food_item WHERE food_id = ?',
            [id]
        );
        if (existingRows.length === 0) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({ success: false, message: 'Food item not found' });
        }
        const cur = existingRows[0];

        let oldImagePath = null;
        if (req.file && cur.image) {
            oldImagePath = cur.image;
        }

        const updates = [];
        const values = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description);
        }
        if (price !== undefined) {
            updates.push('price = ?');
            values.push(price);
        }
        if (req.file) {
            // New file uploaded
            const imagePath = '/uploads/' + req.file.filename;
            updates.push('image = ?');
            values.push(imagePath);
            console.log('📎 New media uploaded:', imagePath);
        } else if (image !== undefined) {
            // Image URL provided (no file upload)
            updates.push('image = ?');
            values.push(image);
        }
        if (category_id !== undefined) {
            updates.push('category_id = ?');
            values.push(category_id);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }
        if (compare_at_price !== undefined) {
            const raw = compare_at_price;
            if (raw === null || String(raw).trim() === '') {
                updates.push('compare_at_price = NULL');
            } else {
                const c = normalizeCompareAtForApi(raw);
                if (c != null) {
                    updates.push('compare_at_price = ?');
                    values.push(c);
                } else {
                    updates.push('compare_at_price = NULL');
                }
            }
        }

        if (updates.length === 0) {
            // Delete uploaded file if no updates
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        const pricingTouched = price !== undefined || compare_at_price !== undefined;
        if (pricingTouched) {
            let nextSale = parseFloat(String(cur.price).replace(/\s/g, '').replace(/,/g, '.'));
            let nextCap = normalizeCompareAtForApi(pickCompareAtFromRow(cur));
            if (price !== undefined) {
                nextSale = parseFloat(String(price).trim().replace(/\s/g, '').replace(/,/g, '.'));
            }
            if (compare_at_price !== undefined) {
                const raw = compare_at_price;
                if (raw === null || String(raw).trim() === '') {
                    nextCap = null;
                } else {
                    nextCap = normalizeCompareAtForApi(raw);
                }
            }
            if (nextCap != null && Number.isFinite(nextSale) && nextCap <= nextSale) {
                if (req.file) {
                    fs.unlinkSync(req.file.path);
                }
                return res.status(400).json({ success: false, message: comparePricingErrorMessage });
            }
        }

        values.push(id);

        await db.query(`UPDATE food_item SET ${updates.join(', ')} WHERE food_id = ?`, values);
        
        // Delete old image file if new one was uploaded
        if (oldImagePath && oldImagePath.startsWith('/uploads/')) {
            const oldFilePath = path.join(uploadsDir, path.basename(oldImagePath));
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
                console.log('🗑️ Deleted old media file:', oldImagePath);
            }
        }
        
        console.log('✅ Food item updated:', id);
        res.json({ success: true, message: 'Food item updated successfully' });
    } catch (error) {
        // Delete uploaded file if error occurs
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error updating food item:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// Delete food item
app.delete('/api/admin/food-items/:id', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.query('DELETE FROM food_item WHERE food_id = ?', [id]);
        
        console.log('✅ Food item deleted:', id);
        res.json({ success: true, message: 'Food item deleted successfully' });
    } catch (error) {
        console.error('Error deleting food item:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// Get all orders (for admin)
app.get('/api/admin/orders', checkAdmin, async (req, res) => {
    try {
        const [orders] = await db.query(`
            SELECT 
                o.order_id,
                o.customer_id,
                u.name as customer_name,
                u.email as customer_email,
                o.total_amount,
                o.status,
                o.delivery_address,
                o.payment_method,
                o.created_at,
                o.estimated_delivery_at,
                o.prep_live_video_url
            FROM orders o
            LEFT JOIN users u ON o.customer_id = u.id
            ORDER BY o.created_at DESC
        `);
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update order status
app.put('/api/admin/orders/:id/status', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, prep_live_video_url, estimated_delivery_at } = req.body || {};
        
        const validStatuses = ['pending', 'confirmed', 'preparing', 'transit', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const updates = ['status = ?'];
        const values = [status];

        if (prep_live_video_url !== undefined) {
            const u = prep_live_video_url == null || String(prep_live_video_url).trim() === ''
                ? null
                : String(prep_live_video_url).trim().slice(0, 500);
            updates.push('prep_live_video_url = ?');
            values.push(u);
        }
        if (estimated_delivery_at !== undefined && estimated_delivery_at !== null && String(estimated_delivery_at).trim() !== '') {
            const d = new Date(estimated_delivery_at);
            if (!Number.isNaN(d.getTime())) {
                updates.push('estimated_delivery_at = ?');
                values.push(d);
            }
        }

        values.push(id);
        await db.query(`UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`, values);
        
        console.log('✅ Order status updated:', id, 'to', status);
        res.json({ success: true, message: 'Order status updated' });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// ==================== USER MANAGEMENT ====================

// Get all users (for admin)
app.get('/api/admin/users', checkAdmin, async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT id, name, email, phone, is_admin, COALESCE(loyalty_points, 0) AS loyalty_points, created_at FROM users ORDER BY created_at DESC'
        );
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add or set loyalty points for a user (admin — for demos and support)
app.post('/api/admin/users/:targetUserId/loyalty', checkAdmin, async (req, res) => {
    try {
        const targetUserId = req.params.targetUserId;
        const { addPoints, setPoints } = req.body || {};

        const [rows] = await db.query('SELECT COALESCE(loyalty_points, 0) AS lp FROM users WHERE id = ?', [
            targetUserId,
        ]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let next;
        if (setPoints != null && String(setPoints).trim() !== '') {
            next = Math.max(0, Math.floor(Number(setPoints)));
        } else {
            const add = Math.max(0, Math.floor(Number(addPoints) || 0));
            next = Math.max(0, Number(rows[0].lp || 0) + add);
        }

        await db.query('UPDATE users SET loyalty_points = ? WHERE id = ?', [next, targetUserId]);
        res.json({ success: true, loyaltyPoints: next });
    } catch (error) {
        console.error('admin loyalty:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update user admin status
app.put('/api/admin/users/:id/admin', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_admin } = req.body;
        
        await db.query('UPDATE users SET is_admin = ? WHERE id = ?', [is_admin ? 1 : 0, id]);
        
        console.log('✅ User admin status updated:', id, 'to', is_admin ? 'admin' : 'user');
        res.json({ success: true, message: `User ${is_admin ? 'promoted to' : 'removed from'} admin` });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// ==================== CATEGORY MANAGEMENT ====================

// Add new category
app.post('/api/admin/categories', checkAdmin, async (req, res) => {
    try {
        const { category_name } = req.body;
        
        if (!category_name) {
            return res.status(400).json({ success: false, message: 'Category name is required' });
        }
        
        const [result] = await db.query(
            'INSERT INTO category (category_name) VALUES (?)',
            [category_name]
        );
        
        console.log('✅ Category added:', category_name);
        res.json({ success: true, message: 'Category added successfully', categoryId: result.insertId });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// Delete category
app.delete('/api/admin/categories/:id', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.query('DELETE FROM category WHERE category_id = ?', [id]);
        
        console.log('✅ Category deleted:', id);
        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ success: false, message: 'Error: ' + error.message });
    }
});

// Serve static files AFTER all API routes (important!)
app.use(express.static(path.join(__dirname, '../frontend')));

module.exports = app;

// Local dev only — Vercel loads this file via api/index.js (require.main !== module).
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`Open http://localhost:${PORT} to access the app`);
        const dbLabel =
            db.dialect === 'postgres'
                ? 'PostgreSQL'
                : db.forceMysqlDialect
                  ? 'MySQL (DATABASE_DIALECT=mysql)'
                  : 'MySQL';
        console.log(`✅ Database: ${dbLabel} — pool ready`);
        console.log('📋 Admin endpoint: POST /api/admin/create-admin');
        console.log(
            '⭐ Loyalty catalog: GET /api/loyalty-rewards or GET /api/menu-items/loyalty-catalog'
        );
        if (mpesaDaraja.useSimulation()) {
            console.log('💳 M-Pesa: simulation mode (MPESA_USE_SIMULATION=true)');
        } else if (mpesaDaraja.isConfigured()) {
            console.log('💳 M-Pesa: Daraja STK push enabled');
            const cb = mpesaDaraja.effectiveCallbackUrl();
            if (cb) console.log('   Callback URL:', cb);
        } else {
            const p = mpesaDaraja.getConfigPresence();
            console.log(
                '💳 M-Pesa: not configured — add backend/.env or MPESA_USE_SIMULATION=true. Vars set:',
                JSON.stringify(p)
            );
            console.log('   Diagnose: GET http://localhost:' + PORT + '/api/payment/mpesa/env-check');
        }
    });
}
