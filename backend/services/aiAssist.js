/**
 * Optional AI: Gemini / Anthropic / OpenAI. Falls back to demo text if no keys.
 */

async function callGemini(systemPrompt, userText) {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: systemPrompt + '\n\nUser:\n' + userText }],
                },
            ],
        }),
    });
    const data = await res.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!res.ok || !text) {
        console.warn('Gemini error:', data?.error || res.status);
        return null;
    }
    return String(text).trim();
}

async function chatReply(userMessage, history) {
    const sys =
        'You are a short, friendly assistant for a Kenyan food delivery web app. ' +
        'Keep answers under 120 words. Mention M-Pesa payments and local context when relevant.';
    const block = [history.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n'), userMessage].join('\n\n');
    const gem = await callGemini(sys, block);
    if (gem) return gem;

    const q = String(userMessage).toLowerCase();
    if (/hello|hi\b|hey/.test(q)) {
        return 'Hi! I can help you browse the menu, loyalty points, or M-Pesa checkout. What would you like?';
    }
    if (/point|loyalty|redeem/.test(q)) {
        return 'You earn loyalty points when you order. Tap the ⭐ points badge in the header to pick dishes to redeem for points (added free in the cart; points are deducted at checkout).';
    }
    if (/deal|discount|sale|cheap|price/.test(q)) {
        return 'Look for items on the menu with a “Was / Now” sale price — admins set those in the food list. Add anything you like to the cart from the menu!';
    }
    if (/pay|mpesa|stk|payment/.test(q)) {
        return 'At checkout, choose Pay with M-Pesa and enter the Safaricom number that receives STK prompts. Approve the amount on your phone when the popup appears.';
    }
    return 'Thanks for your message! Try ordering from the menu, or ask about loyalty points or M-Pesa checkout.';
}

/**
 * @param {{ id: number; name: string; category?: string }[]} menuItems
 * @param {number[]} pastFoodIds
 */
async function recommendMeals(menuItems, pastFoodIds) {
    const key = process.env.GEMINI_API_KEY?.trim();
    const pool = menuItems.filter((m) => !pastFoodIds.includes(m.id));
    const pickRandom = (arr, n) => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a.slice(0, n);
    };

    if (key && pool.length > 0) {
        const menuShort = pool.slice(0, 25).map((m) => ({ id: m.id, name: m.name, cat: m.category || '' }));
        const prompt =
            'Pick exactly 3 different meal ids from this JSON as JSON array of objects {id, reason} ' +
            'where reason is one short phrase (max 12 words) why it fits based on past orders. ' +
            'Only use ids from the list. Output JSON array only, no markdown.\n' +
            JSON.stringify({ pastOrderedFoodIds: pastFoodIds, candidates: menuShort });
        const raw = await callGemini(
            'You are a food recommendation engine. Reply with JSON only.',
            prompt
        );
        if (raw) {
            try {
                const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
                const arr = JSON.parse(cleaned);
                if (Array.isArray(arr) && arr.length > 0) {
                    return arr
                        .map((x) => {
                            const item = menuItems.find((m) => m.id === x.id);
                            if (!item) return null;
                            return {
                                ...item,
                                reason: x.reason || 'Recommended for you',
                            };
                        })
                        .filter(Boolean)
                        .slice(0, 3);
                }
            } catch {
                /* fall through */
            }
        }
    }

    const picks = pickRandom(pool.length >= 3 ? pool : menuItems, 3);
    const reasons = [
        'Popular with nearby orders',
        'Pairs well with your usual picks',
        'Great value tonight',
    ];
    return picks.map((item, i) => ({
        ...item,
        reason: reasons[i % reasons.length],
    }));
}

module.exports = { chatReply, recommendMeals };
