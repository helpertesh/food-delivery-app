const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const mpesaDaraja = require('./services/mpesaDaraja');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        // Accept only image files
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed!'));
        }
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve uploaded images statically
app.use('/uploads', express.static(uploadsDir));

// Note: express.static moved to bottom - API routes must come first!
// (This ensures /api/* routes are handled by Express, not served as static files)

// Initialize admin user on startup
async function initializeAdmin() {
    try {
        // First check if users table exists
        const [tables] = await db.query("SHOW TABLES LIKE 'users'");
        
        if (tables.length === 0) {
            console.log('⚠️ Users table does not exist yet. Admin will be created when first user signs up.');
            return;
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

// Initialize admin on startup
initializeAdmin();

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

// Test database connection
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS solution');
        res.json({ success: true, message: 'Database connected!', solution: rows[0].solution });
    } catch (error) {
        console.error('Database connection error:', error);
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            hint:
                process.env.VERCEL &&
                'In Vercel → Settings → Environment Variables set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME. Most cloud MySQL needs DB_SSL=true.',
        });
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

        // Find user
        console.log('🔍 Finding user:', email);
        const [users] = await db.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        const user = users[0];
        console.log('✅ User found:', user.name);

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
        res.json({ 
            success: true, 
            message: 'Login successful',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                address: user.address,
                isAdmin: user.is_admin === 1 || user.is_admin === true
            }
        });

    } catch (error) {
        console.error('❌❌❌ LOGIN ERROR DETAILS:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error during login',
            error: error.message
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
// ==================== ORDER ENDPOINTS ====================

// Create new order
app.post('/api/orders', async (req, res) => {
    try {
        console.log('🛒 Order received:', JSON.stringify(req.body, null, 2));
        
        const { userId, items, deliveryAddress, paymentMethod } = req.body;
        
        // Validation
        if (!userId) {
            console.log('❌ Missing userId');
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }
        
        if (!items || items.length === 0) {
            console.log('❌ No items in cart');
            return res.status(400).json({ 
                success: false, 
                message: 'Cart is empty' 
            });
        }
        
        if (!deliveryAddress) {
            console.log('❌ Missing delivery address');
            return res.status(400).json({ 
                success: false, 
                message: 'Delivery address is required' 
            });
        }
        
        // Calculate total amount
        let totalAmount = 0;
        items.forEach(item => {
            totalAmount += parseFloat(item.price) * item.quantity;
        });
        
        console.log(`💰 Total amount: ${totalAmount}`);
        console.log(`📦 Items count: ${items.length}`);
        
        // Insert order
        console.log('📝 Inserting order into database...');
        const [orderResult] = await db.query(
            'INSERT INTO orders (customer_id, total_amount, status, delivery_address, payment_method) VALUES (?, ?, ?, ?, ?)',
            [userId, totalAmount, 'pending', deliveryAddress, paymentMethod || 'Cash on Delivery']
        );
        
        const orderId = orderResult.insertId;
        console.log('✅ Order created with ID:', orderId);
        
        // Insert order items
        console.log('📝 Inserting order items...');
        for (const item of items) {
            console.log(`   - Item: ${item.name || item.id}, Qty: ${item.quantity}, Price: ${item.price}`);
            await db.query(
                'INSERT INTO order_items (order_id, food_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.id, item.quantity, item.price]
            );
        }
        
        console.log('✅ Order completed successfully');
        res.json({ 
            success: true, 
            message: 'Order placed successfully',
            orderId: orderId,
            totalAmount: totalAmount.toFixed(2)
        });
        
    } catch (error) {
        console.error('❌❌❌ ORDER ERROR DETAILS:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({ 
            success: false, 
            message: 'Error placing order: ' + error.message,
            error: error.code || 'UNKNOWN_ERROR'
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

// ==================== M-PESA PAYMENT ENDPOINTS (Safaricom Daraja STK Push) ====================

// M-Pesa sends the STK result to CallBackURL — must be HTTPS and publicly reachable (e.g. ngrok).
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
                return res.status(503).json({
                    success: false,
                    code: 'MPESA_NOT_CONFIGURED',
                    message:
                        'M-Pesa Daraja is not configured. Add MPESA_* variables to backend/.env (see .env.example) or set MPESA_USE_SIMULATION=true for local testing.',
                });
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

// Get all menu items (for users)
app.get('/api/menu-items', async (req, res) => {
    try {
        console.log('📋 Fetching menu items...');
        
        const query = `
            SELECT 
                f.food_id as id,
                f.name,
                f.description,
                f.price,
                f.image as image_url,
                c.category_name as category,
                f.status
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            WHERE f.status = 'Available'
            ORDER BY c.category_name, f.name
        `;
        
        const [items] = await db.query(query);
        console.log(`✅ Found ${items.length} menu items`);
        
        res.json({ success: true, items });
    } catch (error) {
        console.error('❌ Error fetching menu:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get menu items by category
app.get('/api/menu-items/category/:categoryName', async (req, res) => {
    try {
        const query = `
            SELECT 
                f.food_id as id,
                f.name,
                f.description,
                f.price,
                f.image as image_url,
                c.category_name as category
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            WHERE c.category_name = ? AND f.status = 'Available'
            ORDER BY f.name
        `;
        
        const [items] = await db.query(query, [req.params.categoryName]);
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
        const [items] = await db.query(`
            SELECT 
                f.food_id as id,
                f.name,
                f.description,
                f.price,
                f.image,
                f.status,
                f.category_id,
                c.category_name as category
            FROM food_item f
            LEFT JOIN category c ON f.category_id = c.category_id
            ORDER BY f.food_id DESC
        `);
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
        const { name, description, price, category_id, status, image } = req.body;
        
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
        
        // Use uploaded file path if file was uploaded, otherwise use provided image URL
        let imagePath = image || '';
        if (req.file) {
            // Store relative path: /uploads/filename.ext
            imagePath = '/uploads/' + req.file.filename;
            console.log('📸 Image uploaded:', imagePath);
        }
        
        const [result] = await db.query(
            'INSERT INTO food_item (name, description, price, image, category_id, status) VALUES (?, ?, ?, ?, ?, ?)',
            [name, description || '', price, imagePath, category_id, status || 'Available']
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
        const { name, description, price, image, category_id, status } = req.body;
        
        // Get current food item to delete old image if new one is uploaded
        let oldImagePath = null;
        if (req.file) {
            const [items] = await db.query('SELECT image FROM food_item WHERE food_id = ?', [id]);
            if (items.length > 0 && items[0].image) {
                oldImagePath = items[0].image;
            }
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
            console.log('📸 New image uploaded:', imagePath);
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
        
        if (updates.length === 0) {
            // Delete uploaded file if no updates
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }
        
        values.push(id);
        
        await db.query(
            `UPDATE food_item SET ${updates.join(', ')} WHERE food_id = ?`,
            values
        );
        
        // Delete old image file if new one was uploaded
        if (oldImagePath && oldImagePath.startsWith('/uploads/')) {
            const oldFilePath = path.join(__dirname, oldImagePath);
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
                console.log('🗑️ Deleted old image:', oldImagePath);
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
                o.created_at
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
        const { status } = req.body;
        
        const validStatuses = ['pending', 'confirmed', 'preparing', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        
        await db.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, id]);
        
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
        const [users] = await db.query('SELECT id, name, email, phone, is_admin, created_at FROM users ORDER BY created_at DESC');
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Server error' });
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
        console.log(`Open http://localhost:3000 to access the app`);
        console.log('✅ Database: MySQL connected');
        console.log('📋 Admin endpoint: POST /api/admin/create-admin');
        if (mpesaDaraja.useSimulation()) {
            console.log('💳 M-Pesa: simulation mode (MPESA_USE_SIMULATION=true)');
        } else if (mpesaDaraja.isConfigured()) {
            console.log('💳 M-Pesa: Daraja STK push enabled');
        } else {
            console.log(
                '💳 M-Pesa: not configured — add backend/.env (see .env.example) or MPESA_USE_SIMULATION=true'
            );
        }
    });
}