/**
 * Creates loyalty / reviews tables (MySQL). Safe to run on every startup.
 * Adds optional compare_at_price on food_item for "was / now" pricing (MySQL + Postgres).
 */
async function ensureFeatureTables(db) {
    if (db.dialect === 'mysql') {
        try {
            await db.query('ALTER TABLE users ADD COLUMN loyalty_points INT NOT NULL DEFAULT 0');
        } catch (e) {
            if (!/Duplicate column name/i.test(String(e.message))) {
                console.warn('ensureFeatureTables users.loyalty_points:', e.message);
            }
        }

        await db.query(`
            CREATE TABLE IF NOT EXISTS reviews (
                review_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                order_id INT NOT NULL,
                stars TINYINT NOT NULL,
                comment VARCHAR(500) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_user_order (user_id, order_id),
                INDEX idx_reviews_order (order_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        try {
            await db.query('ALTER TABLE food_item ADD COLUMN compare_at_price DECIMAL(10,2) NULL');
        } catch (e) {
            if (!/Duplicate column name/i.test(String(e.message))) {
                console.warn('ensureFeatureTables food_item.compare_at_price:', e.message);
            }
        }

        try {
            await db.query('ALTER TABLE orders ADD COLUMN estimated_delivery_at DATETIME NULL');
        } catch (e) {
            if (!/Duplicate column name/i.test(String(e.message))) {
                console.warn('ensureFeatureTables orders.estimated_delivery_at:', e.message);
            }
        }
        try {
            await db.query('ALTER TABLE orders ADD COLUMN prep_live_video_url VARCHAR(500) NULL');
        } catch (e) {
            if (!/Duplicate column name/i.test(String(e.message))) {
                console.warn('ensureFeatureTables orders.prep_live_video_url:', e.message);
            }
        }
        return;
    }

    if (db.dialect === 'postgres') {
        try {
            await db.query(
                'ALTER TABLE food_item ADD COLUMN IF NOT EXISTS compare_at_price DECIMAL(10,2)'
            );
        } catch (e) {
            console.warn('ensureFeatureTables postgres compare_at_price:', e.message);
        }
        try {
            await db.query(
                'ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ'
            );
        } catch (e) {
            console.warn('ensureFeatureTables postgres orders.estimated_delivery_at:', e.message);
        }
        try {
            await db.query(
                'ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_live_video_url VARCHAR(500)'
            );
        } catch (e) {
            console.warn('ensureFeatureTables postgres orders.prep_live_video_url:', e.message);
        }
    }
}

module.exports = { ensureFeatureTables };
