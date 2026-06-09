const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../frontend/dashboard.html'), 'utf8');
const body = html.match(/<body>([\s\S]*)<script>/)[1];

const navMatch = body.match(/<nav class="navbar">[\s\S]*?<\/nav>/);
const modalsStart = body.indexOf('<!-- Cart Panel -->');
const modalsEnd = body.indexOf('\n\n    <script>');
const modals = body.slice(modalsStart, modalsEnd);

const nav = `<nav class="navbar">
    <div class="logo">🍔 Food Delivery</div>
    <div class="nav-links">
        <a href="home.html" data-page="home">Home</a>
        <a href="menu.html" data-page="menu">Menu</a>
        <a href="profile.html" data-page="profile">Profile</a>
        <a href="leaderboard.html" data-page="leaderboard">Leaderboard</a>
        <a href="track-order.html" data-page="track-order">Track order</a>
        <a href="about.html" data-page="about">About Us</a>
        <button type="button" class="theme-toggle" id="themeToggle">🌙 Dark</button>
        <span class="loyalty-pill" id="loyaltyNav" title="Tap to redeem points for free food" role="button" tabindex="0">⭐ 0 pts</span>
        <div class="cart-icon" onclick="toggleCart()">
            🛒
            <span class="cart-count" id="cartCount">0</span>
        </div>
        <a href="admin.html" id="adminLink" style="display: none; background: rgba(255,215,0,0.2);">👑 Admin</a>
        <a href="#" onclick="logout(); return false;" style="background: rgba(255,255,255,0.1);">Logout</a>
    </div>
</nav>
`;

const partialsDir = path.join(__dirname, '../frontend/partials');
fs.mkdirSync(partialsDir, { recursive: true });
fs.writeFileSync(path.join(partialsDir, 'nav.html'), nav);
fs.writeFileSync(path.join(partialsDir, 'modals.html'), modals.trim() + '\n');
console.log('Wrote nav.html and modals.html');
