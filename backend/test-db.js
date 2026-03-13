const db = require('./config/database');

async function testConnection() {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS solution');
        console.log('✅ Database connected!');
        console.log('Test query result:', rows[0].solution);
        
        // Check if users table exists
        const [tables] = await db.query('SHOW TABLES');
        console.log('\n📊 Tables in database:');
        tables.forEach(table => console.log('   - ' + Object.values(table)[0]));
        
        // Count users
        const [users] = await db.query('SELECT COUNT(*) as count FROM users');
        console.log('\n👥 Total users in database:', users[0].count);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Database connection failed!');
        console.error('Error:', error.message);
        process.exit(1);
    }
}

testConnection();