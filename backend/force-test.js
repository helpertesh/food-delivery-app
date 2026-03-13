const mysql = require('mysql2');

// Direct connection - no config file
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'peter368', // CHANGE THIS TO YOUR MYSQL PASSWORD
    database: 'food_delivery_db'
});

connection.connect(function(err) {
    if (err) {
        console.error('❌ Connection Failed:', err.message);
        return;
    }
    
    console.log('✅ Connected to MySQL!');
    
    // Insert a test user
    const testEmail = 'test_' + Date.now() + '@example.com';
    const query = "INSERT INTO users (name, email, password, phone, address) VALUES (?, ?, ?, ?, ?)";
    
    connection.query(query, 
        ['Force Test', testEmail, 'dummyhash', '1234567890', 'Test Address'],
        function(err, result) {
            if (err) {
                console.error('❌ Insert Failed:', err.message);
            } else {
                console.log('✅ Insert Successful! ID:', result.insertId);
            }
            
            // Check if user exists
            connection.query('SELECT * FROM users', function(err, results) {
                if (err) {
                    console.error('❌ Select Failed:', err);
                } else {
                    console.log('\n📊 Users in database:', results.length);
                    results.forEach(user => {
                        console.log(`   ID: ${user.id}, Name: ${user.name}, Email: ${user.email}`);
                    });
                }
                connection.end();
            });
        }
    );
});