const db = require('./config/database');
const bcrypt = require('bcryptjs');

async function insertTestUser() {
    try {
        const hashedPassword = await bcrypt.hash('test123', 10);
        
        const [result] = await db.query(
            'INSERT INTO users (name, email, password, phone, address) VALUES (?, ?, ?, ?, ?)',
            ['Test User', 'test' + Date.now() + '@example.com', hashedPassword, '1234567890', 'Test Address']
        );
        
        console.log('✅ Test user inserted with ID:', result.insertId);
        
        // Show all users
        const [users] = await db.query('SELECT id, name, email FROM users');
        console.log('\n📊 All users in database:');
        users.forEach(user => {
            console.log(`   - ${user.name} (${user.email})`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

insertTestUser();