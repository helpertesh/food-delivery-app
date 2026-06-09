// State management
        /** Backend URL: Live Server (e.g. :5500) cannot serve /api — use port 3000. Override: localStorage.foodDeliveryApiBase or <meta name="api-base" content="https://..."> */
        function resolveFoodDeliveryApiBase() {
            const meta = document.querySelector('meta[name="api-base"]');
            if (meta && meta.content && meta.content.trim()) {
                return meta.content.trim().replace(/\/$/, '');
            }
            try {
                const stored = localStorage.getItem('foodDeliveryApiBase');
                if (stored && stored.trim()) return stored.trim().replace(/\/$/, '');
            } catch (_) {}
            if (window.location.protocol === 'file:') return 'http://localhost:3000';
            const host = window.location.hostname;
            const port = window.location.port;
            const loopback =
                host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
            if (port === '3000' || (port === '' && loopback)) {
                return window.location.origin;
            }
            if (loopback) {
                const h = host === '[::1]' || host === '::1' ? '127.0.0.1' : host;
                return `http://${h}:3000`;
            }
            return window.location.origin;
        }
        const API_BASE = resolveFoodDeliveryApiBase();
        /** Free ngrok can inject an HTML warning page unless this header is sent on API requests. */
        function apiFetchHeaders(jsonBody) {
            const h = {};
            if (jsonBody) h['Content-Type'] = 'application/json';
            if (/ngrok-free\.(app|dev)$/i.test(window.location.hostname) || /\.ngrok\.io$/i.test(window.location.hostname)) {
                h['ngrok-skip-browser-warning'] = 'true';
            }
            return h;
        }
        function isVideoMediaUrl(url) {
            if (!url || typeof url !== 'string') return false;
            const u = url.split(/[?#]/)[0].toLowerCase();
            return /\.(mp4|webm|mov|m4v)$/.test(u);
        }

        function resolveMenuMediaUrl(raw) {
            if (!raw) return '';
            const s = String(raw);
            if (s.startsWith('http://') || s.startsWith('https://')) return s;
            return `${API_BASE}${s.startsWith('/') ? '' : '/'}${s}`;
        }

        async function parseJsonResponse(res) {
            const text = await res.text();
            if (!text.trim()) {
                throw new Error(`Empty response (HTTP ${res.status}). If using ngrok, try again or check the server log.`);
            }
            const trimmed = text.trim();
            if (/^\s*</i.test(trimmed)) {
                throw new Error(
                    'Order tracking could not load: the API returned a web page instead of JSON. Open the dashboard from your Node app (e.g. http://localhost:3000/dashboard.html), restart the backend, or deploy the latest server so Vercel path rewriting works.'
                );
            }
            try {
                return JSON.parse(text);
            } catch {
                throw new Error(`Invalid response from server (HTTP ${res.status}). Check that the API is running.`);
            }
        }
        let menuItems = [];
        let cart = JSON.parse(localStorage.getItem('cart')) || [];
        let currentCategory = 'all';
        let userData = null;
        let mpesaPollTimer = null;
        let paymentTotalKes = 0;
        let mpesaPollDeadline = 0;
        let menuSyncTimer = null;
        let reviewOrderId = null;
        let reviewStars = 0;
        let chatHistory = [];
        let orderTrackPollTimer = null;
        let orderTrackCountdownTimer = null;
        let trackEtaDeadlineMs = null;
        let trackCountdownIsTerminal = false;
        let trackTerminalMessage = '';

        function getLocalDemoMenuItems() {
            return [
                { id: 9001, name: 'Nyama Choma', description: 'Popular with nearby orders', price: 450, compare_at_price: null, image_url: '', category: 'Main Course', status: 'Available' },
                { id: 9002, name: 'Pilau Beef', description: 'Spiced rice with tender beef', price: 380, compare_at_price: null, image_url: '', category: 'Main Course', status: 'Available' },
                { id: 9003, name: 'Chicken Biryani', description: 'Aromatic biryani with tender chicken', price: 520, compare_at_price: null, image_url: '', category: 'Main Course', status: 'Available' },
                { id: 9004, name: 'Ugali & Tilapia', description: 'Classic ugali with fried tilapia', price: 600, compare_at_price: null, image_url: '', category: 'Main Course', status: 'Available' },
                { id: 9005, name: 'Chips Masala', description: 'Fries tossed in tangy masala sauce', price: 260, compare_at_price: null, image_url: '', category: 'Snacks', status: 'Available' },
                { id: 9006, name: 'Samosa', description: 'Crispy snack with spicy filling', price: 70, compare_at_price: null, image_url: '', category: 'Snacks', status: 'Available' },
                { id: 9007, name: 'Mandazi', description: 'Freshly made soft mandazi', price: 80, compare_at_price: null, image_url: '', category: 'Snacks', status: 'Available' },
                { id: 9008, name: 'Hot Tea', description: 'Pairs well with your usual picks', price: 80, compare_at_price: null, image_url: '', category: 'Drinks', status: 'Available' },
                { id: 9009, name: 'Fresh Juice', description: 'Seasonal fruit blend', price: 150, compare_at_price: null, image_url: '', category: 'Drinks', status: 'Available' },
                { id: 9010, name: 'Soda 500ml', description: 'Chilled soft drink', price: 100, compare_at_price: null, image_url: '', category: 'Drinks', status: 'Available' },
                { id: 9011, name: 'Chocolate Cake', description: 'Rich slice for dessert', price: 220, compare_at_price: null, image_url: '', category: 'Desserts', status: 'Available' },
                { id: 9012, name: 'Ice Cream Sundae', description: 'Vanilla sundae with toppings', price: 240, compare_at_price: null, image_url: '', category: 'Desserts', status: 'Available' },
                { id: 9013, name: 'Pancake Stack', description: 'Fluffy pancakes with syrup', price: 260, compare_at_price: null, image_url: '', category: 'Breakfast', status: 'Available' },
                { id: 9014, name: 'Spanish Omelette', description: 'Three-egg omelette with veggies', price: 230, compare_at_price: null, image_url: '', category: 'Breakfast', status: 'Available' },
                { id: 9015, name: 'Fruit Salad', description: 'Fresh seasonal fruit bowl', price: 180, compare_at_price: null, image_url: '', category: 'Desserts', status: 'Available' },
            ];
        }

        function cartSubtotalAmount() {
            return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        }

        function cartLoyaltyPointsTotal() {
            return cart.reduce((sum, item) => {
                if (!item.loyaltyRedeem) return sum;
                const ppu = Number(item.loyaltyPointsPerUnit) || 0;
                return sum + ppu * item.quantity;
            }, 0);
        }

        function refreshCartTotals() {
            const sub = cartSubtotalAmount();
            const pts = cartLoyaltyPointsTotal();
            const subEl = document.getElementById('cartSubtotal');
            const totEl = document.getElementById('cartTotal');
            const ptsLine = document.getElementById('cartPointsLine');
            if (subEl) subEl.textContent = `KSh ${sub.toFixed(2)}`;
            if (totEl) totEl.textContent = `KSh ${sub.toFixed(2)}`;
            if (ptsLine) {
                ptsLine.textContent =
                    pts > 0 ? `Loyalty rewards in cart: ${pts} pts (deducted when you place the order)` : '';
            }
        }

        function setPaymentModalLoyaltyOnlyMode(on) {
            const modal = document.getElementById('paymentModal');
            const row = modal?.querySelector('.mpesa-phone-row');
            const till = modal?.querySelector('.payment-till-note');
            const instr = modal?.querySelector('.payment-instructions');
            const lbl = modal?.querySelector('.payment-info-label');
            const infoP = modal?.querySelector('.payment-info > p');
            if (modal) modal.dataset.loyaltyOnly = on ? '1' : '';
            if (on) {
                if (row) row.style.display = 'none';
                if (till) till.style.display = 'none';
                if (instr) instr.style.display = 'none';
                if (lbl) lbl.textContent = 'Loyalty reward order';
                if (infoP)
                    infoP.textContent =
                        'No M-Pesa payment is needed. Confirm to place your order and spend the points shown in the summary.';
            } else {
                if (row) row.style.display = '';
                if (till) till.style.display = '';
                if (instr) instr.style.display = '';
                if (lbl) lbl.textContent = 'M-Pesa (Safaricom STK push)';
                if (infoP)
                    infoP.innerHTML =
                        'Enter the number that receives M-Pesa prompts. You will get a <strong>Lipa na M-Pesa</strong> popup — enter your PIN to pay.';
            }
        }

        /** Same formula as backend loyaltyPointsCostForMenuPrice — used if API catalog routes fail */
        function loyaltyPointsCostClient(price) {
            const p = Number(price);
            if (!Number.isFinite(p) || p <= 0) return 50;
            return Math.max(30, Math.round(p * 2.2));
        }

        function menuItemsToLoyaltyRewards(items) {
            if (!Array.isArray(items)) return [];
            return items.map((it) => ({
                id: it.id,
                name: it.name,
                description: it.description,
                price: it.price,
                compare_at_price: it.compare_at_price,
                image_url: it.image_url,
                category: it.category,
                pointsCost: loyaltyPointsCostClient(it.price),
            }));
        }

        async function openLoyaltyRewardsModal() {
            if (!userData) return;
            await refreshLoyaltyNav();
            const modal = document.getElementById('loyaltyRewardsModal');
            const grid = document.getElementById('loyaltyRewardsGrid');
            const balEl = document.getElementById('loyaltyRewardsBalance');
            const bal = Number(userData.loyaltyPoints ?? 0);
            if (balEl) balEl.textContent = `Your balance: ⭐ ${bal} pts`;
            modal.classList.add('open');
            grid.innerHTML = '<p style="grid-column:1/-1;color:#888;">Loading…</p>';
            const fetchOpts = { headers: apiFetchHeaders(false), cache: 'no-store' };
            const tryUrls = [
                `${API_BASE}/api/loyalty-rewards`,
                `${API_BASE}/api/menu-items/loyalty-catalog`,
                `${API_BASE}/api/loyalty/rewards`,
                `${API_BASE}/api/menu-items`,
            ];
            let rewards = null;
            let lastProblem = '';
            try {
                for (const url of tryUrls) {
                    let r;
                    try {
                        r = await fetch(url, fetchOpts);
                    } catch (netErr) {
                        lastProblem = String(netErr.message || netErr);
                        continue;
                    }
                    const raw = await r.text();
                    let d = {};
                    try {
                        d = raw.trim() ? JSON.parse(raw) : {};
                    } catch {
                        lastProblem = `HTTP ${r.status} (not JSON)`;
                        continue;
                    }
                    if (!r.ok || !d.success) {
                        lastProblem = `HTTP ${r.status}: ${(d.message || raw.slice(0, 120) || '').replace(/</g, '')}`;
                        continue;
                    }
                    if (Array.isArray(d.rewards) && d.rewards.length > 0) {
                        rewards = d.rewards;
                        break;
                    }
                    if (Array.isArray(d.items) && d.items.length > 0) {
                        rewards = menuItemsToLoyaltyRewards(d.items);
                        break;
                    }
                }
                if (!rewards || rewards.length === 0) {
                    grid.innerHTML = `<p style="grid-column:1/-1;color:#c62828;">Could not load redeem options. ${(lastProblem || 'No items').replace(/</g, '')}</p><p style="grid-column:1/-1;color:#666;font-size:0.9rem;">Hard-refresh this page (Ctrl+F5). In the backend folder run <code>node server.js</code> and check the console for: <strong>Loyalty catalog: GET /api/loyalty-rewards…</strong></p>`;
                    return;
                }
                grid.innerHTML = rewards
                    .map((rw) => {
                        const nm = JSON.stringify(rw.name);
                        const cost = Number(rw.pointsCost) || 0;
                        const can = bal >= cost;
                        return `
                        <div class="loyalty-reward-card">
                            <strong>${escapeHtml(rw.name)}</strong>
                            <div class="pts">${cost} pts</div>
                            <div style="font-size:0.8rem;color:#777;">Menu KSh ${parseFloat(rw.price).toFixed(2)}</div>
                            <button type="button" ${can ? '' : 'disabled'} onclick="addLoyaltyRewardToCart(${rw.id}, ${nm}, ${cost})">Add to cart</button>
                        </div>`;
                    })
                    .join('');
            } catch (e) {
                grid.innerHTML = `<p style="grid-column:1/-1;color:#c62828;">Network error: ${String(e.message || e).replace(/</g, '')}. Is the API on the same host/port as this page?</p>`;
            }
        }

        function closeLoyaltyRewardsModal() {
            document.getElementById('loyaltyRewardsModal').classList.remove('open');
        }

        function addLoyaltyRewardToCart(id, name, pointsPerUnit) {
            const bal = Number(userData?.loyaltyPoints ?? 0);
            if (pointsPerUnit > bal) {
                showToast('Not enough points for that reward', 'error');
                return;
            }
            const existingItem = cart.find((item) => item.id === id && item.loyaltyRedeem);
            if (existingItem) {
                if (cartLoyaltyPointsTotal() + pointsPerUnit > bal) {
                    showToast('Not enough points for another one', 'error');
                    return;
                }
                existingItem.quantity += 1;
            } else {
                cart.push({
                    id,
                    name,
                    price: 0,
                    quantity: 1,
                    loyaltyRedeem: true,
                    loyaltyPointsPerUnit: pointsPerUnit,
                });
            }
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartDisplay();
            showToast(`${name} added as a loyalty reward 🎁`, 'success');
            closeLoyaltyRewardsModal();
        }

        function onOrderPlacedSuccess(data, method) {
            if (data.loyaltyPointsBalance != null) {
                userData.loyaltyPoints = data.loyaltyPointsBalance;
                sessionStorage.setItem('user', JSON.stringify(userData));
            }
            displayUserInfo();
            refreshLoyaltyNav();
            loadPendingReviews();
            loadReviewStatsLine();
            loadLeaderboard();
            if (data.orderId != null) {
                sessionStorage.setItem('lastPlacedOrderId', String(data.orderId));
            }
            if (getAppPage() === 'track-order') {
                loadOrderTracking();
            }
            showToast('Order placed successfully! 🎉', 'success');
            cart = [];
            localStorage.removeItem('cart');
            updateCartDisplay();
            closePaymentModal();
            toggleCart();
            setTimeout(() => {
                const ptsLine =
                    data.pointsEarned != null
                        ? `\nPoints earned: ${data.pointsEarned}${
                              data.loyaltyRedeemed ? ` · Points used: ${data.loyaltyRedeemed}` : ''
                          }`
                        : '';
                alert(
                    `Order #${data.orderId} placed successfully!\nTotal: KSh ${data.totalAmount}\nPayment: ${method}${ptsLine}\n\nThank you for ordering!`
                );
                if (getAppPage() !== 'track-order') {
                    window.location.href = 'track-order.html';
                }
            }, 400);
        }

        async function refreshLoyaltyNav() {
            const el = document.getElementById('loyaltyNav');
            if (!el || !userData) return;
            try {
                const r = await fetch(`${API_BASE}/api/loyalty/${userData.id}`, {
                    headers: apiFetchHeaders(false),
                });
                const d = await r.json();
                if (d.success) {
                    userData.loyaltyPoints = d.loyaltyPoints;
                    sessionStorage.setItem('user', JSON.stringify(userData));
                    el.textContent = `⭐ ${d.loyaltyPoints} pts`;
                }
            } catch (e) {
                const pts = userData.loyaltyPoints ?? 0;
                el.textContent = `⭐ ${pts} pts`;
            }
        }

        async function loadReviewStatsLine() {
            const line = document.getElementById('reviewStatsLine');
            if (!line) return;
            try {
                const r = await fetch(`${API_BASE}/api/reviews/stats`, { headers: apiFetchHeaders(false) });
                const d = await r.json();
                if (d.success && d.count > 0 && d.averageStars != null) {
                    line.textContent = `Community rating: ★ ${Number(d.averageStars).toFixed(1)} (${d.count} reviews)`;
                } else {
                    line.textContent = 'Be the first to leave a review after your delivery!';
                }
            } catch {
                line.textContent = '';
            }
        }

        async function loadLeaderboard() {
            const grid = document.getElementById('leaderboardGrid');
            const myReward = document.getElementById('leaderboardMyReward');
            if (!grid || !myReward || !userData) return;
            try {
                const r = await fetch(
                    `${API_BASE}/api/leaderboard/customers?currentUserId=${encodeURIComponent(userData.id)}`,
                    { headers: apiFetchHeaders(false) }
                );
                const d = await r.json();
                if (!d.success || !Array.isArray(d.winners) || d.winners.length === 0) {
                    grid.innerHTML =
                        '<p style="grid-column:1/-1;color:#888;">No leaderboard data yet. Place orders to get ranked.</p>';
                    myReward.textContent = '';
                    return;
                }

                myReward.textContent = d.currentUserReward
                    ? `🎉 You are rank #${d.currentUserReward.rank}: free food voucher KSh ${d.currentUserReward.freeFoodVoucherKes} + free delivery.`
                    : 'Keep ordering to enter the top 3 rewards list.';

                grid.innerHTML = d.winners
                    .map((w) => {
                        const medal = w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : '🥉';
                        const avg = Number(w.avgRating || 0).toFixed(1);
                        return `
                        <div class="leaderboard-card">
                            <div class="leaderboard-rank">${medal} #${w.rank}</div>
                            <div style="margin-top:4px;font-weight:600;">${escapeHtml(w.name || 'Client')}</div>
                            <div style="margin-top:4px;color:#667;">Orders: ${Number(w.ordersCount || 0)}</div>
                            <div style="color:#667;">Spent: KSh ${Number(w.totalSpent || 0).toFixed(2)}</div>
                            <div style="color:#667;">Avg rating: ★ ${avg}</div>
                            <div class="leaderboard-perk">Reward: Free food voucher KSh ${Number(
                                w.perks?.freeFoodVoucherKes || 0
                            )} + free delivery</div>
                        </div>`;
                    })
                    .join('');
            } catch {
                grid.innerHTML =
                    '<p style="grid-column:1/-1;color:#c62828;">Could not load leaderboard right now.</p>';
                myReward.textContent = '';
            }
        }

        async function loadRecommendations() {
            const sec = document.getElementById('recoSection');
            const grid = document.getElementById('recoGrid');
            if (!sec || !grid || !userData) return;
            try {
                const r = await fetch(`${API_BASE}/api/ai/recommendations/${userData.id}`, {
                    headers: apiFetchHeaders(false),
                });
                const d = await r.json();
                if (!d.success || !d.recommendations?.length) {
                    sec.style.display = 'none';
                    return;
                }
                sec.style.display = 'block';
                grid.innerHTML = d.recommendations
                    .map((it) => {
                        const safeName = String(it.name || '').replace(/</g, '');
                        const safeReason = String(it.reason || 'Recommended').replace(/</g, '');
                        const priceNum = Number(it.price);
                        const safePrice = Number.isFinite(priceNum) ? priceNum : 0;
                        const rawId = Number(it.id);
                        const safeId = Number.isFinite(rawId) ? rawId : '';
                        return `
                    <div class="reco-card">
                        <strong>${safeName}</strong>
                        <div style="color:#667eea;font-weight:600;margin-top:4px;">KSh ${safePrice.toFixed(2)}</div>
                        <div class="why">${safeReason}</div>
                        <button type="button" class="add-to-cart reco-add-btn" style="margin-top:8px;width:100%;" data-food-id="${safeId}" data-food-name="${safeName}" data-food-price="${safePrice}">+ Add</button>
                    </div>`;
                    })
                    .join('');
                grid.querySelectorAll('.reco-add-btn').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const name = btn.dataset.foodName || 'Item';
                        const price = Number(btn.dataset.foodPrice);
                        let id = Number(btn.dataset.foodId);
                        if (!Number.isFinite(id) || id <= 0) {
                            const match = menuItems.find(
                                (m) => String(m.name || '').toLowerCase() === String(name).toLowerCase()
                            );
                            id = Number(match?.id);
                        }
                        if (!Number.isFinite(id) || id <= 0) {
                            showToast('Could not add this item right now. Refresh and try again.', 'error');
                            return;
                        }
                        addToCart(id, name, Number.isFinite(price) ? price : 0);
                    });
                });
            } catch {
                sec.style.display = 'none';
            }
        }

        async function loadPendingReviews() {
            const box = document.getElementById('pendingReviewsList');
            if (!box || !userData) return;
            try {
                const r = await fetch(`${API_BASE}/api/reviews/pending/${userData.id}`, {
                    headers: apiFetchHeaders(false),
                });
                const d = await r.json();
                if (!d.success || !d.pending?.length) {
                    box.innerHTML = '<p style="color:#888;font-size:0.9rem;">No deliveries waiting for a review. Order something delicious!</p>';
                    return;
                }
                box.innerHTML = d.pending
                    .map((o) => {
                        const oid = Number(o.order_id);
                        const amt = parseFloat(o.total_amount).toFixed(2);
                        const st = String(o.status || '').replace(/</g, '');
                        return `
                    <button type="button" class="pending-review"
                        data-order-id="${oid}"
                        data-amount="${amt}"
                        aria-label="Rate order ${oid}">
                        <span><strong>Order #${oid}</strong> · KSh ${amt} · ${new Date(o.created_at).toLocaleDateString()} <span style="color:#888;font-size:0.85rem;">(${st})</span></span>
                        <span class="rate-chevron" aria-hidden="true">Rate →</span>
                    </button>`;
                    })
                    .join('');
                box.querySelectorAll('.pending-review').forEach((row) => {
                    row.addEventListener('click', () => {
                        openReviewModal(Number(row.dataset.orderId), row.dataset.amount || '0.00');
                    });
                    row.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openReviewModal(Number(row.dataset.orderId), row.dataset.amount || '0.00');
                        }
                    });
                });
            } catch {
                box.innerHTML = '';
            }
        }

        function openReviewModal(orderId, amountStr) {
            reviewOrderId = orderId;
            reviewStars = 0;
            document.getElementById('reviewModalOrder').textContent = `Order #${orderId} · KSh ${amountStr}`;
            document.getElementById('reviewComment').value = '';
            renderStarRow(0);
            document.getElementById('reviewModal').classList.add('open');
        }

        function closeReviewModal() {
            document.getElementById('reviewModal').classList.remove('open');
            reviewOrderId = null;
        }

        function renderStarRow(n) {
            reviewStars = n;
            const row = document.getElementById('starRow');
            row.innerHTML = [1, 2, 3, 4, 5]
                .map(
                    (i) =>
                        `<span data-s="${i}" style="cursor:pointer;color:${i <= n ? '#ffc107' : '#ddd'}">★</span>`
                )
                .join('');
            row.querySelectorAll('span').forEach((s) => {
                s.onclick = () => renderStarRow(+s.dataset.s);
            });
        }

        async function submitReview() {
            if (!reviewOrderId || reviewStars < 1) {
                showToast('Tap the stars to rate 1–5', 'error');
                return;
            }
            try {
                const res = await fetch(`${API_BASE}/api/reviews`, {
                    method: 'POST',
                    headers: apiFetchHeaders(true),
                    body: JSON.stringify({
                        userId: userData.id,
                        orderId: reviewOrderId,
                        stars: reviewStars,
                        comment: document.getElementById('reviewComment').value,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    showToast(data.message || 'Could not save review', 'error');
                    return;
                }
                showToast('Thanks for your review!', 'success');
                closeReviewModal();
                loadPendingReviews();
                loadReviewStatsLine();
            } catch (e) {
                showToast(e.message || 'Error', 'error');
            }
        }

        function toggleChat() {
            document.getElementById('chatPanel').classList.toggle('open');
        }

        const ABOUT_VIDEOS = [
            {
                title: 'How Customers Use the System',
                embedUrl: 'https://player.vimeo.com/video/76979871',
            },
            {
                title: 'Admin & Order Workflow',
                embedUrl: 'https://player.vimeo.com/video/22439234',
            },
            {
                title: 'How the Organization Operates',
                embedUrl: 'https://player.vimeo.com/video/32708463',
            },
        ];

        function renderAboutVideos() {
            const grid = document.getElementById('aboutVideoGrid');
            if (!grid) return;
            grid.innerHTML = ABOUT_VIDEOS.map((v) => `
                <div class="about-video-card">
                    <div class="about-video-title">${escapeHtml(v.title)}</div>
                    <iframe
                        src="${v.embedUrl}"
                        title="${escapeHtml(v.title)}"
                        loading="lazy"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen>
                    </iframe>
                </div>
            `).join('');
        }

        function openAboutModal() {
            renderAboutVideos();
            document.getElementById('aboutModal').classList.add('open');
        }

        function closeAboutModal() {
            document.getElementById('aboutModal').classList.remove('open');
        }

        async function sendChat() {
            const input = document.getElementById('chatInput');
            const msg = (input.value || '').trim();
            if (!msg) return;
            input.value = '';
            const box = document.getElementById('chatMessages');
            box.innerHTML += `<div class="chat-bubble user">${escapeHtml(msg)}</div>`;
            box.scrollTop = box.scrollHeight;
            chatHistory.push({ role: 'user', content: msg });
            try {
                const res = await fetch(`${API_BASE}/api/ai/chat`, {
                    method: 'POST',
                    headers: apiFetchHeaders(true),
                    body: JSON.stringify({ message: msg, history: chatHistory.slice(-8) }),
                });
                const data = await res.json().catch(() => ({}));
                const reply = data.reply || 'Sorry, something went wrong.';
                chatHistory.push({ role: 'assistant', content: reply });
                box.innerHTML += `<div class="chat-bubble bot">${escapeHtml(reply)}</div>`;
                box.scrollTop = box.scrollHeight;
            } catch (e) {
                box.innerHTML += `<div class="chat-bubble bot">Network error.</div>`;
            }
        }

        function escapeHtml(s) {
            const d = document.createElement('div');
            d.textContent = s;
            return d.innerHTML;
        }

        function formatDeliveryCountdown(totalSec) {
            if (totalSec <= 0) {
                return 'Estimated delivery time reached — your order should arrive any moment.';
            }
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            if (h > 0) return `About ${h}h ${m}m left until estimated delivery.`;
            if (m > 0) return `About ${m}m ${s}s left until estimated delivery.`;
            return `About ${s}s left until estimated delivery.`;
        }

        function stopOrderTrackPolling() {
            if (orderTrackPollTimer) {
                clearInterval(orderTrackPollTimer);
                orderTrackPollTimer = null;
            }
        }

        function stopOrderTrackCountdown() {
            if (orderTrackCountdownTimer) {
                clearInterval(orderTrackCountdownTimer);
                orderTrackCountdownTimer = null;
            }
        }

        function updateTrackCountdownEl() {
            const el = document.getElementById('trackCountdown');
            if (!el) return;
            if (trackCountdownIsTerminal) {
                el.textContent = trackTerminalMessage;
                return;
            }
            if (trackEtaDeadlineMs == null || Number.isNaN(trackEtaDeadlineMs)) {
                el.textContent = '';
                return;
            }
            const sec = Math.max(0, Math.floor((trackEtaDeadlineMs - Date.now()) / 1000));
            el.textContent = formatDeliveryCountdown(sec);
        }

        function startOrderTrackCountdown() {
            stopOrderTrackCountdown();
            orderTrackCountdownTimer = setInterval(updateTrackCountdownEl, 1000);
            updateTrackCountdownEl();
        }

        function renderOrderTrackDetail(data) {
            const detail = document.getElementById('trackOrderDetail');
            if (!detail) return;

            const timelineHtml = (data.timeline || [])
                .map((step) => {
                    let cls = 'track-step';
                    if (step.done) cls += ' done';
                    if (step.active) cls += ' active';
                    return `<span class="${cls}">${escapeHtml(step.label)}</span>`;
                })
                .join('');

            trackTerminalMessage =
                data.status === 'delivered'
                    ? 'Delivered — enjoy your meal!'
                    : data.status === 'cancelled'
                      ? 'This order was cancelled.'
                      : '';
            trackCountdownIsTerminal =
                data.status === 'delivered' || data.status === 'cancelled';

            const liveBlock =
                data.showLive && data.liveVideoUrl
                    ? `<div class="track-live-header">
                            <span class="track-live-badge" aria-live="polite"><span class="track-live-dot" aria-hidden="true"></span> Live</span>
                            <span class="track-live-sub">Kitchen prep stream — washing, cooking, plating</span>
                        </div>
                        <div class="track-live-wrap">
                            <video id="trackPrepVideo" autoplay muted loop playsinline controls></video>
                            <p class="track-live-caption">You’re watching live prep for this order. Video hides when the order moves to <strong>Transit</strong> or <strong>Delivered</strong>.</p>
                        </div>`
                    : `<p class="track-no-live">${
                          data.status === 'preparing'
                              ? 'Live prep feed is not available right now.'
                              : 'The <strong>Live</strong> kitchen view appears only while Admin has set this order to <strong>Preparing</strong>.'
                      }</p>`;

            detail.innerHTML = `
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:6px;">
                    <span class="track-status-chip">Order #${data.orderId}</span>
                    <span class="track-status-chip">${escapeHtml(data.status)}</span>
                </div>
                <div class="track-timeline" role="list">${timelineHtml}</div>
                <div class="track-countdown" id="trackCountdown"></div>
                ${liveBlock}
            `;

            if (trackCountdownIsTerminal) {
                trackEtaDeadlineMs = null;
                const el = document.getElementById('trackCountdown');
                if (el) el.textContent = trackTerminalMessage;
            } else {
                trackEtaDeadlineMs = new Date(data.estimatedDeliveryAt).getTime();
                startOrderTrackCountdown();
            }

            const vid = document.getElementById('trackPrepVideo');
            if (vid) {
                if (data.showLive && data.liveVideoUrl) {
                    vid.src = data.liveVideoUrl;
                    vid.play().catch(() => {});
                } else {
                    vid.removeAttribute('src');
                    vid.load();
                }
            }
        }

        async function refreshOrderTrackDetail(orderId) {
            const detail = document.getElementById('trackOrderDetail');
            if (!detail || !orderId || !userData) return;
            try {
                stopOrderTrackCountdown();
                const r = await fetch(
                    `${API_BASE}/api/orders/track?orderId=${encodeURIComponent(orderId)}&userId=${encodeURIComponent(userData.id)}`,
                    { headers: apiFetchHeaders(false) }
                );
                const data = await parseJsonResponse(r);
                if (!data.success) throw new Error(data.message || 'Track failed');
                renderOrderTrackDetail(data);
            } catch (e) {
                detail.innerHTML = `<p class="track-empty">${escapeHtml(e.message || 'Could not refresh tracking.')}</p>`;
            }
        }

        async function loadOrderTracking() {
            const panel = document.getElementById('trackOrdersPanel');
            if (!panel || !userData) return;
            stopOrderTrackPolling();
            stopOrderTrackCountdown();
            try {
                const r = await fetch(`${API_BASE}/api/orders/user/${encodeURIComponent(userData.id)}`, {
                    headers: apiFetchHeaders(false),
                });
                const d = await parseJsonResponse(r);
                if (!d.success || !Array.isArray(d.orders)) {
                    panel.innerHTML = '<p class="track-empty">Could not load orders.</p>';
                    return;
                }
                const active = d.orders.filter(
                    (o) => !['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase())
                );
                if (active.length === 0) {
                    panel.innerHTML =
                        '<p class="track-empty">No active orders. When you place an order, tracking and countdown appear here.</p>';
                    return;
                }

                let sel = sessionStorage.getItem('lastPlacedOrderId');
                if (!active.some((o) => String(o.order_id) === String(sel))) {
                    sel = String(active[0].order_id);
                }

                const pickOpts = active
                    .map(
                        (o) =>
                            `<option value="${Number(o.order_id)}" ${String(o.order_id) === String(sel) ? 'selected' : ''}>#${Number(o.order_id)} · ${escapeHtml(String(o.status || ''))} · KSh ${parseFloat(o.total_amount).toFixed(2)}</option>`
                    )
                    .join('');

                const picker =
                    active.length > 1
                        ? `<div class="track-order-row"><label for="trackOrderPick">Track order</label><select id="trackOrderPick">${pickOpts}</select></div>`
                        : '';

                panel.innerHTML = `${picker}<div id="trackOrderDetail"></div>`;

                const pickEl = document.getElementById('trackOrderPick');
                if (pickEl) {
                    pickEl.addEventListener('change', () => {
                        sessionStorage.setItem('lastPlacedOrderId', pickEl.value);
                        refreshOrderTrackDetail(pickEl.value);
                    });
                }

                await refreshOrderTrackDetail(sel);
                orderTrackPollTimer = setInterval(() => {
                    const pick = document.getElementById('trackOrderPick');
                    const id =
                        (pick && pick.value) ||
                        sessionStorage.getItem('lastPlacedOrderId') ||
                        sel;
                    if (id) refreshOrderTrackDetail(id);
                }, 5000);
            } catch {
                panel.innerHTML = '<p class="track-empty">Could not load tracking.</p>';
            }
        }

        // Check authentication
        function checkAuth() {
            const user = sessionStorage.getItem('user');
            if (!user) {
                window.location.href = 'login.html';
                return false;
            }
            userData = JSON.parse(user);
            return true;
        }

        function getAppPage() {
            return document.body.dataset.page || 'home';
        }

        async function loadPartials() {
            const navHost = document.getElementById('app-nav');
            if (navHost && !navHost.innerHTML.trim()) {
                try {
                    const res = await fetch('partials/nav.html', { cache: 'no-store' });
                    if (res.ok) navHost.innerHTML = await res.text();
                } catch (_) {}
            }
            const modalsHost = document.getElementById('app-modals');
            if (modalsHost && !modalsHost.innerHTML.trim()) {
                try {
                    const res = await fetch('partials/modals.html', { cache: 'no-store' });
                    if (res.ok) modalsHost.innerHTML = await res.text();
                } catch (_) {}
            }
        }

        const PAGE_INIT = {
            home: async () => {
                loadReviewStatsLine();
                loadRecommendations();
                loadPendingReviews();
                await loadMenuItems({ silent: true, keepCategory: true });
            },
            menu: async () => {
                await loadMenuItems({ silent: false, keepCategory: false });
                setupCategoryButtons();
                startMenuSync();
            },
            profile: async () => {},
            leaderboard: async () => {
                loadLeaderboard();
            },
            'track-order': async () => {
                loadOrderTracking();
            },
            about: async () => {
                renderAboutVideos();
            },
        };

        // Initialize page
        async function init() {
            if (!checkAuth()) return;
            await refreshLoyaltyNav();
            displayUserInfo();
            updateCartDisplay();
            const pageInit = PAGE_INIT[getAppPage()];
            if (pageInit) await pageInit();
        }

        // Display user info
        function displayUserInfo() {
            const userNameEl = document.getElementById('userName');
            if (userNameEl) userNameEl.textContent = userData.name;

            const profileName = document.getElementById('profileDisplayName');
            if (profileName) profileName.textContent = userData.name;

            const profileEmail = document.getElementById('profileDisplayEmail');
            if (profileEmail) profileEmail.textContent = userData.email || '';

            const profileAvatar = document.getElementById('profileAvatar');
            if (profileAvatar && userData.name) {
                profileAvatar.textContent = userData.name.trim().charAt(0).toUpperCase();
            }

            const adminLink = document.getElementById('adminLink');
            if (adminLink && userData.isAdmin) {
                adminLink.style.display = 'block';
            }

            const userInfo = document.getElementById('userInfo');
            if (!userInfo) return;
            userInfo.innerHTML = `
                <div class="info-item">
                    <label>Full Name</label>
                    <div class="value">${userData.name}</div>
                </div>
                <div class="info-item">
                    <label>Email</label>
                    <div class="value">${userData.email}</div>
                </div>
                <div class="info-item">
                    <label>Phone</label>
                    <div class="value">${userData.phone}</div>
                </div>
                <div class="info-item">
                    <label>Address</label>
                    <div class="value">${userData.address}</div>
                </div>
                <div class="info-item">
                    <label>Loyalty points</label>
                    <div class="value">⭐ ${userData.loyaltyPoints ?? 0} pts</div>
                </div>
                ${userData.isAdmin ? '<div class="info-item"><label>Role</label><div class="value">👑 Administrator</div></div>' : ''}
            `;
        }

        // Load menu items from server
        async function loadMenuItems(options = {}) {
            const { silent = false, keepCategory = true } = options;
            const loadingEl = document.getElementById('loading');
            const menuGrid = document.getElementById('menuGrid');
            if (!menuGrid) return;
            try {
                if (!silent && loadingEl) {
                    loadingEl.style.display = 'block';
                    menuGrid.innerHTML = '';
                }
                
                const response = await fetch(`${API_BASE}/api/menu-items`, {
                    cache: 'no-store',
                    headers: apiFetchHeaders(false),
                });
                let data = null;
                try {
                    data = await parseJsonResponse(response);
                } catch {
                    data = null;
                }
                
                if (data.success) {
                    const nextItems = dedupeMenuItemsByName(data.items || []);
                    const changed = JSON.stringify(nextItems) !== JSON.stringify(menuItems);
                    menuItems = nextItems;
                    setupCategories();
                    if (keepCategory) {
                        filterByCategory(currentCategory);
                    } else {
                        displayMenuItems(menuItems);
                    }
                    if (silent && changed) {
                        showToast('Menu updated from admin changes', 'success');
                    }
                } else {
                    throw new Error((data && data.message) || 'Menu API error');
                }
            } catch (error) {
                console.error('Error loading menu:', error);
                const fallbackItems = dedupeMenuItemsByName(getLocalDemoMenuItems());
                menuItems = fallbackItems;
                setupCategories();
                if (keepCategory) {
                    filterByCategory(currentCategory);
                } else {
                    displayMenuItems(menuItems);
                }
                if (!silent) {
                    showToast('Database is offline. Showing demo menu items.', 'warning');
                }
            } finally {
                if (!silent && loadingEl) {
                    loadingEl.style.display = 'none';
                }
            }
        }

        function startMenuSync() {
            if (menuSyncTimer) clearInterval(menuSyncTimer);
            // Poll so frontend reflects admin add/delete without manual refresh.
            menuSyncTimer = setInterval(() => loadMenuItems({ silent: true, keepCategory: true }), 10000);
        }

        // Setup category buttons from actual data
        function setupCategories() {
            const fromItems = [...new Set(menuItems.map(item => item.category))].filter(
                c => String(c).toLowerCase() !== 'all'
            );
            const categories = ['all', ...fromItems];
            const nav = document.getElementById('categoryNav');
            if (!nav) return;
            nav.innerHTML = '';
            
            categories.forEach(category => {
                const btn = document.createElement('button');
                btn.className = `category-btn ${category === 'all' ? 'active' : ''}`;
                btn.textContent = category === 'all' ? 'All' : category;
                btn.setAttribute('onclick', `filterByCategory('${category}')`);
                nav.appendChild(btn);
            });
        }

        // Setup category button event listeners
        function setupCategoryButtons() {
            // This will be populated after loading menu items
        }

        // Filter menu by category
        function filterByCategory(category) {
            currentCategory = category;
            
            // Update active button
            document.querySelectorAll('.category-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.textContent === category || 
                    (category === 'all' && btn.textContent === 'All')) {
                    btn.classList.add('active');
                }
            });
            
            // Filter and display items
            const filtered = category === 'all' 
                ? menuItems 
                : menuItems.filter(item => item.category === category);
            
            displayMenuItems(filtered);
        }

        /** Whole KSh amounts without “.00”; otherwise two decimals */
        function formatMenuKshAmount(value) {
            const x = parseFloat(value);
            if (!Number.isFinite(x)) return '';
            if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
            return x.toFixed(2);
        }

        function getCompareAtFromMenuItem(item) {
            if (!item || typeof item !== 'object') return undefined;
            const found = Object.keys(item).find((k) => String(k).toLowerCase() === 'compare_at_price');
            if (found !== undefined) return item[found];
            return item.compareAtPrice;
        }

        function fallbackImageForMenuItem(item) {
            const name = String(item?.name || '').toLowerCase();
            const category = String(item?.category || '').toLowerCase();
            const itemId = Number(item?.id) || 0;
            const byName = {
                'nyama choma': 'https://images.unsplash.com/photo-1529692236671-f1de5e376f1b?w=900',
                'pilau beef': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=900',
                'fish fillet': 'https://images.unsplash.com/photo-1544943910-4c1dc44aab44?w=900',
                'chicken biryani': 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=900',
                'beef stew & rice': 'https://images.unsplash.com/photo-1604908554027-123b9944a5b1?w=900',
                'chapati & beans': 'https://images.unsplash.com/photo-1617093727343-374698b1b08d?w=900',
                'ugali & tilapia': 'https://images.unsplash.com/photo-1599021456807-25db0f974333?w=900',
                mandazi: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=900',
                samosa: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=900',
                'chips masala': 'https://images.unsplash.com/photo-1576107232684-1279f390859f?w=900',
                bhajia: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=900',
                'hot tea': 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=900',
                'fresh juice': 'https://images.unsplash.com/photo-1546173159-315724a31696?w=900',
                'soda 500ml': 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?w=900',
                'mineral water': 'https://images.unsplash.com/photo-1564419320408-38e24e0385d1?w=900',
                'chocolate cake': 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=900',
                'ice cream sundae': 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=900',
                'fruit salad': 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?w=900',
                'pancake stack': 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=900',
                'spanish omelette': 'https://images.unsplash.com/photo-1612240498936-65f5101365d2?w=900',
                'sausage & eggs': 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=900',
                coleslaw: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900',
                kachumbari: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900',
                'kenyan cane 250ml': 'https://images.unsplash.com/photo-1582819509237-d04f8d3b4fd0?w=900',
                'johnnie walker red label': 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900',
                'smirnoff vodka': 'https://images.unsplash.com/photo-1607622750671-6cd9a99f0fdd?w=900',
                'tusker lager': 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900',
                'captain morgan rum': 'https://images.unsplash.com/photo-1536935338788-846bb9981813?w=900',
                'gilbeys gin': 'https://images.unsplash.com/photo-1595977437232-9f4f4a6f13be?w=900',
            };
            if (byName[name]) return byName[name];
            const pick = (arr) => arr[Math.abs(itemId || name.length) % arr.length];
            if (category.includes('drink')) {
                return pick([
                    'https://images.unsplash.com/photo-1497534446932-c925b458314e?w=900',
                    'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=900',
                    'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=900',
                ]);
            }
            if (category.includes('dessert')) {
                return pick([
                    'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=900',
                    'https://images.unsplash.com/photo-1464305795204-6f5bbfc7fb81?w=900',
                    'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900',
                ]);
            }
            if (category.includes('snack')) {
                return pick([
                    'https://images.unsplash.com/photo-1513639776629-7b61b0ac49cb?w=900',
                    'https://images.unsplash.com/photo-1505253716362-afaea1d3d1af?w=900',
                    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=900',
                ]);
            }
            return pick([
                'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=900',
                'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?w=900',
                'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=900',
            ]);
        }

        function moneyToCents(v) {
            if (v == null || v === '') return null;
            const n = parseFloat(String(v).replace(/\s/g, '').replace(/,/g, ''));
            if (!Number.isFinite(n)) return null;
            return Math.round(n * 100);
        }

        function dedupeMenuItemsByName(items) {
            if (!Array.isArray(items)) return [];
            const seen = new Set();
            const out = [];
            for (const it of items) {
                const key = String(it?.name || '')
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .trim();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(it);
            }
            return out;
        }

        // Display menu items in grid
        function displayMenuItems(items) {
            const grid = document.getElementById('menuGrid');
            if (!grid) return;
            const itemCount = document.getElementById('itemCount');
            if (itemCount) itemCount.textContent = `${items.length} items available`;
            
            if (items.length === 0) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1/-1;">
                        <img src="https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=200" alt="No items">
                        <h3>No items in this category</h3>
                        <p>Try selecting another category</p>
                    </div>
                `;
                return;
            }
            
            grid.innerHTML = items.map(item => {
                const rawMedia = item.image_url || item.image;
                const fallbackImg = fallbackImageForMenuItem(item);
                const mediaUrl = rawMedia ? resolveMenuMediaUrl(rawMedia) : fallbackImg;
                const showVideo = rawMedia && isVideoMediaUrl(mediaUrl);
                const nameEscaped = item.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const mediaHtml = showVideo
                    ? `<video class="menu-image" src="${mediaUrl}" controls muted playsinline preload="metadata" title="${nameEscaped}"></video>`
                    : `<img src="${mediaUrl}" alt="${nameEscaped}" class="menu-image" onerror="this.src='${fallbackImg}'">`;
                return `
                <div class="menu-card">
                    ${mediaHtml}
                    <div class="menu-info">
                        <div class="menu-header">
                            <span class="menu-name">${item.name}</span>
                            <span class="menu-category">${item.category || 'Uncategorized'}</span>
                        </div>
                        <div class="menu-description">${item.description || 'Delicious food made with love'}</div>
                        <div class="menu-footer">
                            <div>${(() => {
                                const saleCents = moneyToCents(item.price);
                                const wasCents = moneyToCents(getCompareAtFromMenuItem(item));
                                const showDeal =
                                    wasCents != null &&
                                    saleCents != null &&
                                    wasCents > saleCents;
                                if (showDeal) {
                                    const sale = saleCents / 100;
                                    const was = wasCents / 100;
                                    return `<div><span class="menu-deal-badge">Discount</span><div class="menu-price-stack"><span class="menu-price-was">Was KSh ${formatMenuKshAmount(was)}</span><span class="menu-price-now">Now KSh ${formatMenuKshAmount(sale)}</span></div></div>`;
                                }
                                return `<span class="menu-price">KSh ${formatMenuKshAmount(item.price)}</span>`;
                            })()}</div>
                            <button type="button" class="add-to-cart" onclick="event.stopPropagation(); addToCart(${item.id}, '${nameEscaped}', ${parseFloat(item.price)})">
                                <span>+</span> Add
                            </button>
                        </div>
                    </div>
                </div>
            `;
            }).join('');
        }

        // Add item to cart (paid menu line — not merged with loyalty reward lines for the same dish)
        function addToCart(id, name, price) {
            const existingItem = cart.find((item) => item.id === id && !item.loyaltyRedeem);

            if (existingItem) {
                existingItem.quantity += 1;
            } else {
                cart.push({
                    id: id,
                    name: name,
                    price: price,
                    quantity: 1,
                });
            }

            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartDisplay();
            showToast(`${name} added to cart! 🎉`);
        }

        // Update cart display
        function updateCartDisplay() {
            // Update cart count
            const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
            document.getElementById('cartCount').textContent = totalItems;

            // Update cart items
            const cartContainer = document.getElementById('cartItems');
            
            if (cart.length === 0) {
                cartContainer.innerHTML = `
                    <div class="empty-state">
                        <img src="https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=200" alt="Empty cart">
                        <p>Your cart is empty</p>
                        <p style="font-size: 0.9rem; color: #999;">Add some delicious items!</p>
                    </div>
                `;
            } else {
                cartContainer.innerHTML = cart
                    .map((item) => {
                        const isL = !!item.loyaltyRedeem;
                        const priceLine = isL
                            ? `⭐ ${item.loyaltyPointsPerUnit || 0} pts × ${item.quantity}`
                            : `KSh ${item.price} × ${item.quantity}`;
                        return `
                    <div class="cart-item">
                        <div class="cart-item-info">
                            <div class="cart-item-name">${item.name}${isL ? ' <span style="font-size:0.75rem;color:#5c4d9e;">(reward)</span>' : ''}</div>
                            <div class="cart-item-price">${priceLine}</div>
                        </div>
                        <div class="cart-item-actions">
                            <button onclick="updateQuantity(${item.id}, ${item.quantity - 1}, ${isL})">−</button>
                            <span>${item.quantity}</span>
                            <button onclick="updateQuantity(${item.id}, ${item.quantity + 1}, ${isL})">+</button>
                        </div>
                    </div>`;
                    })
                    .join('');
            }

            refreshCartTotals();
        }

        // Update item quantity (loyalty reward lines are separate from paid lines for the same food id)
        function updateQuantity(id, newQuantity, isLoyaltyReward) {
            const isLoyalty = !!isLoyaltyReward;
            const idx = cart.findIndex(
                (item) => item.id === id && !!item.loyaltyRedeem === isLoyalty
            );
            if (idx === -1) return;
            if (newQuantity < 1) {
                cart.splice(idx, 1);
            } else {
                const item = cart[idx];
                if (isLoyalty) {
                    const bal = Number(userData?.loyaltyPoints ?? 0);
                    const ppu = Number(item.loyaltyPointsPerUnit) || 0;
                    const others = cartLoyaltyPointsTotal() - ppu * item.quantity;
                    if (others + ppu * newQuantity > bal) {
                        showToast('Not enough points for that quantity', 'error');
                        return;
                    }
                }
                item.quantity = newQuantity;
            }

            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartDisplay();
        }

        // Toggle cart panel
        function toggleCart() {
            document.getElementById('cartPanel').classList.toggle('open');
            document.getElementById('overlay').classList.toggle('show');
        }

        // Show toast notification
        function showToast(message, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.style.background = type === 'success' 
                ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                : 'linear-gradient(135deg, #ff4757 0%, #ff6b81 100%)';
            
            toast.classList.add('show');
            
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        // Checkout function - shows payment modal
        function checkout() {
            if (cart.length === 0) {
                showToast('Your cart is empty!', 'error');
                return;
            }

            refreshCartTotals();
            const cashSub = cartSubtotalAmount();
            const ptsRedeem = cartLoyaltyPointsTotal();
            const balPts = Number(userData?.loyaltyPoints ?? 0);
            if (ptsRedeem > balPts) {
                showToast('Not enough points for the rewards in your cart. Remove some or earn more points.', 'error');
                return;
            }
            const isLoyaltyOnly = cashSub <= 0 && ptsRedeem > 0;

            // Populate order summary
            const orderSummary = document.getElementById('orderSummary');
            orderSummary.innerHTML = `
                <h3>Order Summary</h3>
                ${cart
                    .map((item) => {
                        const lineCash = (item.price * item.quantity).toFixed(2);
                        const tag = item.loyaltyRedeem
                            ? ` <span style="color:#5c4d9e;">(reward)</span>`
                            : '';
                        return `
                    <div class="order-summary-item">
                        <span>${item.name}${tag} × ${item.quantity}</span>
                        <span>${
                            item.loyaltyRedeem
                                ? `${(item.loyaltyPointsPerUnit || 0) * item.quantity} pts`
                                : `KSh ${lineCash}`
                        }</span>
                    </div>`;
                    })
                    .join('')}
                <div class="order-summary-item" style="border-top:1px solid #eee;padding-top:8px;margin-top:8px;">
                    <span>Subtotal (cash items)</span>
                    <span>KSh ${cashSub.toFixed(2)}</span>
                </div>
                ${
                    ptsRedeem > 0
                        ? `
                <div class="order-summary-item" style="color:#5c4d9e;">
                    <span>Loyalty rewards</span>
                    <span>${ptsRedeem} pts</span>
                </div>`
                        : ''
                }
                <div class="order-summary-total">
                    <span>${isLoyaltyOnly ? 'M-Pesa amount:' : 'Amount to pay (M-Pesa):'}</span>
                    <span>KSh ${cashSub.toFixed(2)}</span>
                </div>
            `;

            resetPaymentModal();
            paymentTotalKes = isLoyaltyOnly ? 0 : Math.max(1, Math.round(cashSub));
            setPaymentModalLoyaltyOnlyMode(isLoyaltyOnly);
            const cbtn = document.getElementById('confirmPaymentBtn');
            if (cbtn) cbtn.textContent = isLoyaltyOnly ? 'Confirm order' : 'Pay with M-Pesa';

            const phoneEl = document.getElementById('mpesaPhone');
            if (phoneEl && userData?.phone) {
                phoneEl.value = String(userData.phone).replace(/\s/g, '');
            }

            // Show payment modal
            document.getElementById('paymentModal').classList.add('show');
        }

        function stopMpesaPolling() {
            if (mpesaPollTimer) {
                clearInterval(mpesaPollTimer);
                mpesaPollTimer = null;
            }
        }

        function setMpesaStatus(visible, className, text) {
            const el = document.getElementById('mpesaPaymentStatus');
            if (!el) return;
            el.style.display = visible ? 'block' : 'none';
            el.className = 'payment-status' + (className ? ' ' + className : '');
            el.textContent = text || '';
        }

        // Reset payment modal to initial state
        function resetPaymentModal() {
            stopMpesaPolling();
            setMpesaStatus(false, '', '');
            const confirmBtn = document.getElementById('confirmPaymentBtn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Pay with M-Pesa';
            }
        }

        // Close payment modal
        function closePaymentModal() {
            stopMpesaPolling();
            setPaymentModalLoyaltyOnlyMode(false);
            document.getElementById('paymentModal').classList.remove('show');
            setTimeout(() => {
                resetPaymentModal();
            }, 300);
        }

        async function placeOrderAfterPayment(paymentMethodLabel) {
            const response = await fetch(`${API_BASE}/api/orders`, {
                method: 'POST',
                headers: apiFetchHeaders(true),
                body: JSON.stringify({
                    userId: userData.id,
                    items: cart.map((it) => ({
                        id: it.id,
                        name: it.name,
                        price: it.price,
                        quantity: it.quantity,
                        loyaltyRedeem: !!it.loyaltyRedeem,
                    })),
                    deliveryAddress: userData.address,
                    paymentMethod: paymentMethodLabel,
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || 'Could not place order');
            }
            if (!data.success) {
                throw new Error(data.message || 'Order failed');
            }
            return data;
        }

        async function pollMpesaStatus(checkoutRequestId) {
            const res = await fetch(`${API_BASE}/api/payment/mpesa/status/${encodeURIComponent(checkoutRequestId)}`, {
                headers: apiFetchHeaders(false),
            });
            const data = await parseJsonResponse(res);
            if (!data.success) {
                throw new Error(data.message || 'Status check failed');
            }
            return data;
        }

        // STK push via Daraja, then place order when payment completes
        async function confirmPayment() {
            if (cart.length === 0) {
                showToast('Your cart is empty!', 'error');
                closePaymentModal();
                return;
            }

            const loyaltyOnly = document.getElementById('paymentModal').dataset.loyaltyOnly === '1';
            const confirmBtnEarly = document.getElementById('confirmPaymentBtn');
            if (loyaltyOnly) {
                stopMpesaPolling();
                try {
                    if (confirmBtnEarly) {
                        confirmBtnEarly.disabled = true;
                        confirmBtnEarly.textContent = 'Placing order…';
                    }
                    const data = await placeOrderAfterPayment('Loyalty points');
                    onOrderPlacedSuccess(data, 'Loyalty points');
                } catch (error) {
                    console.error('❌ Loyalty checkout:', error);
                    showToast(error.message || 'Could not place order', 'error');
                    if (confirmBtnEarly) {
                        confirmBtnEarly.disabled = false;
                        confirmBtnEarly.textContent = 'Confirm order';
                    }
                }
                return;
            }

            const phoneEl = document.getElementById('mpesaPhone');
            const phoneNumber = phoneEl ? phoneEl.value.trim() : '';
            if (!phoneNumber) {
                showToast('Enter the M-Pesa phone number', 'error');
                return;
            }

            const confirmBtn = document.getElementById('confirmPaymentBtn');
            stopMpesaPolling();
            setMpesaStatus(true, 'waiting', 'Contacting M-Pesa…');

            try {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Sending prompt…';

                const stkRes = await fetch(`${API_BASE}/api/payment/mpesa/stk-push`, {
                    method: 'POST',
                    headers: apiFetchHeaders(true),
                    body: JSON.stringify({
                        phoneNumber,
                        amount: paymentTotalKes,
                        accountReference: `FD${userData.id}-${Date.now()}`,
                        transactionDesc: 'Food delivery',
                    }),
                });

                let stkData = {};
                try {
                    stkData = await parseJsonResponse(stkRes);
                } catch (e) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Pay with M-Pesa';
                    setMpesaStatus(true, 'error', e.message || 'Bad response from server');
                    showToast(e.message || 'Payment failed to start', 'error');
                    return;
                }

                if (stkRes.status === 503 && stkData.code === 'MPESA_NOT_CONFIGURED') {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Pay with M-Pesa';
                    setMpesaStatus(true, 'error', stkData.message || 'M-Pesa not configured on server.');
                    showToast('Add Daraja credentials to backend/.env or set MPESA_USE_SIMULATION=true', 'error');
                    return;
                }

                if (!stkRes.ok || !stkData.success) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Pay with M-Pesa';
                    setMpesaStatus(true, 'error', stkData.message || 'Could not start M-Pesa payment.');
                    showToast(stkData.message || 'Payment failed to start', 'error');
                    return;
                }

                const checkoutRequestId = stkData.checkoutRequestId;
                setMpesaStatus(
                    true,
                    'waiting',
                    stkData.mode === 'simulation'
                        ? 'Simulation: fake STK — success in a few seconds…'
                        : 'Check your phone — enter your M-Pesa PIN to approve payment.'
                );
                confirmBtn.textContent = 'Waiting for phone…';

                mpesaPollDeadline = Date.now() + 120000;

                async function mpesaPollTick() {
                    if (Date.now() > mpesaPollDeadline) {
                        stopMpesaPolling();
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = 'Pay with M-Pesa';
                        setMpesaStatus(true, 'error', 'Timed out waiting for M-Pesa. Try again.');
                        showToast('Payment timed out', 'error');
                        return;
                    }

                    try {
                        const st = await pollMpesaStatus(checkoutRequestId);
                        if (st.status === 'completed') {
                            stopMpesaPolling();
                            setMpesaStatus(true, 'success', 'Paid! Placing your order…');
                            const receipt = st.mpesaReceipt ? ` Receipt ${st.mpesaReceipt}` : '';
                            const method = stkData.mode === 'simulation'
                                ? 'M-Pesa STK (simulation)'
                                : `M-Pesa STK${receipt}`;

                            const data = await placeOrderAfterPayment(method);
                            onOrderPlacedSuccess(data, method);
                        } else if (st.status === 'failed') {
                            stopMpesaPolling();
                            confirmBtn.disabled = false;
                            confirmBtn.textContent = 'Pay with M-Pesa';
                            setMpesaStatus(true, 'error', st.message || 'Payment was not completed.');
                            showToast('Payment cancelled or failed', 'error');
                        }
                    } catch (e) {
                        console.error('Poll error:', e);
                    }
                }

                mpesaPollTick();
                mpesaPollTimer = setInterval(mpesaPollTick, 2000);
            } catch (error) {
                console.error('❌ Checkout error:', error);
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Pay with M-Pesa';
                setMpesaStatus(true, 'error', error.message || 'Network error.');
                showToast('Network error. Is the server running?', 'error');
            }
        }

        // Logout function
        function logout() {
            sessionStorage.removeItem('user');
            localStorage.removeItem('cart');
            window.location.href = 'index.html';
        }

        function applyTheme(theme) {
            const isDark = theme === 'dark';
            document.body.classList.toggle('dark-mode', isDark);
            const t = document.getElementById('themeToggle');
            if (t) t.textContent = isDark ? '☀ Light' : '🌙 Dark';
        }

        function setupThemeToggle() {
            const t = document.getElementById('themeToggle');
            if (!t) return;
            const stored = localStorage.getItem('themeMode');
            applyTheme(stored === 'dark' ? 'dark' : 'light');
            t.addEventListener('click', () => {
                const next = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
                localStorage.setItem('themeMode', next);
                applyTheme(next);
            });
        }

        function setupNavActiveState() {
            const current = getAppPage();
            document.querySelectorAll('.nav-links a[data-page]').forEach((a) => {
                a.classList.toggle('active', a.dataset.page === current);
            });
        }

        // Setup payment button event listeners
        function setupPaymentButtons() {
            const confirmBtn = document.getElementById('confirmPaymentBtn');
            
            if (confirmBtn) {
                confirmBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Pay with M-Pesa clicked');
                    confirmPayment();
                });
            }
        }

        // Initialize when page loads
        document.addEventListener('DOMContentLoaded', async function() {
            await loadPartials();
            setupThemeToggle();
            setupNavActiveState();
            setupPaymentButtons();
            const loyaltyNav = document.getElementById('loyaltyNav');
            if (loyaltyNav) {
                loyaltyNav.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    openLoyaltyRewardsModal();
                });
                loyaltyNav.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        openLoyaltyRewardsModal();
                    }
                });
            }
            const chatFab = document.getElementById('chatFab');
            const chatSend = document.getElementById('chatSend');
            const chatInput = document.getElementById('chatInput');
            if (chatFab) chatFab.addEventListener('click', toggleChat);
            if (chatSend) chatSend.addEventListener('click', () => sendChat());
            if (chatInput) {
                chatInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') sendChat();
                });
            }
            await init().catch((e) => console.error(e));
            // Refresh quickly when user returns to tab.
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) return;
                if (document.getElementById('menuGrid')) {
                    loadMenuItems({ silent: true, keepCategory: true });
                }
                if (userData) {
                    const detail = document.getElementById('trackOrderDetail');
                    if (detail) {
                        const pick = document.getElementById('trackOrderPick');
                        const tid =
                            (pick && pick.value) || sessionStorage.getItem('lastPlacedOrderId');
                        if (tid) refreshOrderTrackDetail(tid);
                    } else {
                        loadOrderTracking();
                    }
                }
            });
            if (document.getElementById('menuGrid')) {
                window.addEventListener('storage', (event) => {
                    if (event.key === 'menuLastUpdatedAt') {
                        loadMenuItems({ silent: true, keepCategory: true });
                    }
                });
                try {
                    const menuCh = new BroadcastChannel('food-delivery-menu');
                    menuCh.addEventListener('message', () => {
                        loadMenuItems({ silent: true, keepCategory: true });
                    });
                } catch (_) {}
            }
        });