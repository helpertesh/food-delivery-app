/**
 * Safaricom Daraja — OAuth + Lipa na M-Pesa Online (STK Push).
 * Credentials via environment variables (see .env.example).
 */

function mpesaTimestamp() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || '00';
    return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

function getBaseUrl() {
    const env = (process.env.MPESA_ENV || 'sandbox').toLowerCase();
    return env === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
}

function isConfigured() {
    return Boolean(
        process.env.MPESA_CONSUMER_KEY &&
            process.env.MPESA_CONSUMER_SECRET &&
            process.env.MPESA_SHORTCODE &&
            process.env.MPESA_PASSKEY &&
            process.env.MPESA_CALLBACK_URL
    );
}

function useSimulation() {
    return (process.env.MPESA_USE_SIMULATION || '').toLowerCase() === 'true';
}

async function getAccessToken() {
    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;
    const auth = Buffer.from(`${key}:${secret}`).toString('base64');
    const url = `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
        const msg = data.error_description || data.errorMessage || JSON.stringify(data);
        throw new Error(`Daraja OAuth failed: ${msg}`);
    }
    return data.access_token;
}

function formatPhone254(phoneNumber) {
    let d = String(phoneNumber).replace(/\D/g, '');
    if (d.startsWith('0')) d = '254' + d.slice(1);
    else if (d.startsWith('7')) d = '254' + d;
    else if (!d.startsWith('254')) d = '254' + d;
    return d;
}

/**
 * @param {object} opts
 * @param {string} opts.phoneNumber - 07..., 2547..., etc.
 * @param {number} opts.amount - KES (integer)
 * @param {string} opts.accountReference - short ref (e.g. order id or "FoodApp")
 * @param {string} opts.transactionDesc
 */
async function initiateStkPush({ phoneNumber, amount, accountReference, transactionDesc }) {
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    const transactionType =
        process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline';
    const partyB = process.env.MPESA_PARTY_B || shortcode;

    const timestamp = mpesaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const phone254 = formatPhone254(phoneNumber);
    const amt = Math.max(1, Math.round(Number(amount)));

    const token = await getAccessToken();
    const body = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: String(amt),
        PartyA: phone254,
        PartyB: partyB,
        PhoneNumber: phone254,
        CallBackURL: callbackUrl,
        AccountReference: String(accountReference || 'FoodDelivery').slice(0, 12),
        TransactionDesc: String(transactionDesc || 'Food order').slice(0, 13),
    };

    const res = await fetch(`${getBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.errorMessage || data.requestId || 'STK request failed');
    }

    const respCode = data.ResponseCode ?? data.responseCode;
    if (respCode != null && String(respCode) !== '0') {
        const desc = data.ResponseDescription ?? data.responseDescription ?? data.errorMessage ?? 'Unknown';
        throw new Error(`M-Pesa declined STK: ${respCode} — ${desc}`);
    }

    const checkoutRequestId = data.CheckoutRequestID ?? data.checkoutRequestID;
    if (!checkoutRequestId) {
        throw new Error('M-Pesa did not return CheckoutRequestID');
    }

    return {
        checkoutRequestId,
        merchantRequestId: data.MerchantRequestID ?? data.merchantRequestID,
        customerMessage: data.CustomerMessage ?? data.customerMessage,
        phone254,
        amount: amt,
    };
}

function parseStkCallback(body) {
    const cb = body?.Body?.stkCallback;
    if (!cb) return null;
    const meta = cb.CallbackMetadata?.Item;
    let amount;
    let mpesaReceipt;
    if (Array.isArray(meta)) {
        for (const item of meta) {
            if (item.Name === 'Amount') amount = item.Value;
            if (item.Name === 'MpesaReceiptNumber') mpesaReceipt = item.Value;
        }
    }
    return {
        checkoutRequestId: cb.CheckoutRequestID,
        merchantRequestId: cb.MerchantRequestID,
        resultCode: cb.ResultCode,
        resultDesc: cb.ResultDesc,
        amount,
        mpesaReceipt,
    };
}

module.exports = {
    isConfigured,
    useSimulation,
    formatPhone254,
    initiateStkPush,
    parseStkCallback,
};
