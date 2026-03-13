const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

console.log('Starting migration...');

// MySQL connection
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'peter368', // Try 'root' as password, or leave blank if no password
    database: 'food_delivery_db'
});

connection.connect(function(err) {
    if (err) {
        console.error('❌ MySQL Connection Error:', err.message);
        console.log('\nTroubleshooting:');
        console.log('1. Is MySQL running? Check Services (Windows Key + R, type "services.msc")');
        console.log('2. Is your password correct? Try "root" or blank password');
        console.log('3. Does database "food_delivery_db" exist?');
        return;
    }
    
    console.log('✅ Connected to MySQL!');
    
    // Read JSON file
    const jsonPath = path.join(__dirname, 'database', 'users.json');
    console.log('📁 Reading from:', jsonPath);
    
    try {
        const jsonData = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(jsonData);
        
        console.log('📊 Users found in JSON:', data.users.length);
        
        if (data.users.length === 0) {
            console.log('No users to migrate.');
            connection.end();
            return;
        }
        
        console.log('\n🔄 Starting migration...\n');
        
        // Insert each user
        let completed = 0;
        data.users.forEach((user, index) => {
            const query = 'INSERT IGNORE INTO users (id, name, email, password, phone, address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
            connection.query(query, 
                [user.id, user.name, user.email, user.password, user.phone, user.address, new Date(user.createdAt)],
                function(err, result) {
                    if (err) {
                        console.log(`❌ ${index + 1}. Failed: ${user.email} - ${err.message}`);
                    } else {
                        console.log(`✅ ${index + 1}. Migrated: ${user.email}`);
                    }
                    
                    completed++;
                    if (completed === data.users.length) {
                        console.log('\n✅ Migration completed!');
                        connection.end();
                    }
                }
            );
        });
    } catch (err) {
        console.error('❌ Error reading JSON file:', err.message);
        connection.end();
    }
});