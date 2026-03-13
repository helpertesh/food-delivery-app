const bcrypt = require('bcryptjs');

// ============================================
// INSTRUCTIONS:
// 1. Change the password below to the one you want to use
// 2. Run: node hash-password.js
// 3. Copy the UPDATE query it shows
// 4. Run that query in MySQL Workbench
// ============================================

async function hashPassword() {
    // ⬇️ CHANGE THIS to your actual password
    const plainPassword = 'your_password_here';
    
    // ⬇️ CHANGE THIS to the email you want to update
    const email = 'collins@gmail.com';
    
    console.log('🔄 Hashing password...\n');
    
    try {
        const hashed = await bcrypt.hash(plainPassword, 10);
        
        console.log('✅ Password hashed successfully!\n');
        console.log('📋 Copy and run this SQL query in MySQL Workbench:\n');
        console.log('─'.repeat(60));
        console.log(`UPDATE users SET password = '${hashed}' WHERE email = '${email}';`);
        console.log('─'.repeat(60));
        console.log('\n💡 After running this query, you can login with:');
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${plainPassword}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
    
    process.exit(0);
}

hashPassword();

