var BASE_URL = 'https://app.shipmondo.com/api/public/v3/';

function getProps() {
  return PropertiesService.getScriptProperties();
}

// Kør denne funktion én gang manuelt i Apps Script-editoren for at sætte credentials
// Sæt SHIPMONDO_USER og SHIPMONDO_KEY manuelt i Script Properties (Project Settings → Script Properties)
function initShipmondoCreds() {
  Logger.log('Sæt SHIPMONDO_USER og SHIPMONDO_KEY direkte i Script Properties — ikke her.');
}


var TOKEN_VALIDITY_MS = 12 * 60 * 60 * 1000; // 12 timer

function validToken(p) {
  var props    = getProps();
  var expected = props.getProperty('LAGER_TOKEN');
  if (!expected || p.token !== expected) return false;
  var expiry = parseInt(props.getProperty('TOKEN_EXPIRY') || '0', 10);
  if (expiry > 0 && Date.now() > expiry) return false;
  return true;
}

function tokenExpired(p) {
  var props    = getProps();
  var expected = props.getProperty('LAGER_TOKEN');
  if (!expected || p.token !== expected) return false;
  var expiry = parseInt(props.getProperty('TOKEN_EXPIRY') || '0', 10);
  return expiry > 0 && Date.now() > expiry;
}

function refreshExpiry(props) {
  props.setProperty('TOKEN_EXPIRY', String(Date.now() + TOKEN_VALIDITY_MS));
}

function sendLockoutAlert(type) {
  try {
    var email = Session.getEffectiveUser().getEmail();
    if (!email) return;
    MailApp.sendEmail(email,
      '[SESU Lager] Login låst — ' + type,
      'For mange ' + type + '-forsøg på SESU Lagersystem.\n' +
      'Låst i ' + (type === 'TOTP' ? '5' : '15') + ' minutter.\n\n' +
      'Tidspunkt: ' + new Date().toLocaleString('da-DK')
    );
  } catch(e) {}
}

function doGet(e) {
  var p  = e.parameter;
  var cb = p.callback ? (p.callback.replace(/[^\w.]/g,'').substring(0,50) || 'callback') : null;
  var result;
  try {
    var action = p.action;
    if (action === 'verifyLogin') {
      result = verifyLogin(p);
    } else if (action === 'verifyStep2') {
      result = verifyStep2(p);
    } else if (action === 'setupTOTP') {
      result = setupTOTP(p);
    } else if (action === 'confirmTOTPSetup') {
      result = confirmTOTPSetup(p);
    } else if (action === 'disableTOTP') {
      result = disableTOTP(p);
    } else if (tokenExpired(p)) {
      result = { error: 'TOKEN_EXPIRED' };
    } else if (!validToken(p)) {
      result = { error: 'Ikke autoriseret' };
    } else if (action === 'getShipments')         result = getShipments(p);
    else if (action === 'getProducts')     result = getProducts(p);
    else if (action === 'getPricingStats')   result = getPricingStats();
    else if (action === 'getSesuPrices')    result = getSesuPrices(p.forceRefresh);
    else if (action === 'getPrinters')     result = getPrinters();
    else if (action === 'getLabel')        result = getLabel(p.id);
    else if (action === 'createShipment')  result = createShipment(p);
    else if (action === 'getBalance')      result = getBalance();
    else if (action === 'getMonthlyStats')   result = getMonthlyStats();
    else if (action === 'getMonthlyHistory') result = getMonthlyHistory();
    else if (action === 'sendReorderEmail')  result = sendReorderEmail(p);
    else result = { error: 'Ukendt handling: ' + action };
  } catch (err) {
    result = { error: err.message };
  }
  var json = JSON.stringify(result);
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch(err) { p = {}; }
  var result;
  try {
    var action = p.action;
    if (action === 'verifyLogin') {
      result = verifyLogin(p);
    } else if (action === 'verifyStep2') {
      result = verifyStep2(p);
    } else if (action === 'setupTOTP') {
      result = setupTOTP(p);
    } else if (action === 'confirmTOTPSetup') {
      result = confirmTOTPSetup(p);
    } else if (action === 'disableTOTP') {
      result = disableTOTP(p);
    } else if (action === 'serverLogout') {
      // Ugyldiggør token øjeblikkeligt — ingen auth krævet (token kan allerede være væk)
      var props = getProps();
      props.setProperty('TOKEN_EXPIRY', '1');
      props.deleteProperty('DEVICE_TRUST_SECRET');
      props.deleteProperty('DEVICE_TRUST_EXPIRES');
      result = { ok: true };
    } else if (action === 'verifyDeviceTrust') {
      result = verifyDeviceTrust(p);
    } else if (action === 'setAnthropicKey') {
      if (tokenExpired(p))  { result = { error: 'TOKEN_EXPIRED' }; }
      else if (!validToken(p)) { result = { error: 'Ikke autoriseret' }; }
      else if (!p.key || !p.key.startsWith('sk-ant-')) { result = { error: 'Ugyldig nøgle' }; }
      else { getProps().setProperty('ANTHROPIC_KEY', p.key); result = { ok: true }; }
    } else if (tokenExpired(p)) {
      result = { error: 'TOKEN_EXPIRED' };
    } else if (!validToken(p)) {
      result = { error: 'Ikke autoriseret' };
    } else if (action === 'getShipments')       result = getShipments(p);
    else if (action === 'getProducts')           result = getProducts(p);
    else if (action === 'getPricingStats')        result = getPricingStats();
    else if (action === 'getSesuPrices')         result = getSesuPrices(p.forceRefresh);
    else if (action === 'getPrinters')           result = getPrinters();
    else if (action === 'getLabel')              result = getLabel(p.id);
    else if (action === 'debugLabel')            result = debugLabel(p.id);
    else if (action === 'getBalance')            result = getBalance();
    else if (action === 'getMonthlyStats')       result = getMonthlyStats();
    else if (action === 'getMonthlyHistory')     result = getMonthlyHistory();
    else if (action === 'createShipment')        result = createShipment(p);
    else if (action === 'sendReorderEmail')      result = sendReorderEmail(p);
    else if (action === 'claudeProxy')           result = claudeProxy(p);
    else result = { error: 'Ukendt handling: ' + action };
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function claudeProxy(data) {
  var key = getProps().getProperty('ANTHROPIC_KEY');
  if (!key) return { error: 'ANTHROPIC_KEY ikke sat i Script Properties' };
  var body = {
    model: data.model || 'claude-sonnet-4-6',
    max_tokens: Math.min(parseInt(data.max_tokens) || 2000, 4000),
    messages: data.messages,
    system: data.system || ''
  };
  if (data.tools) body.tools = data.tools;
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText());
}

var LOGIN_MAX_ATTEMPTS = 8;
var LOGIN_LOCKOUT_MS   = 15 * 60 * 1000;
var TOTP_MAX_ATTEMPTS  = 5;
var TOTP_LOCKOUT_MS    = 5  * 60 * 1000;
var BASE32_CHARS       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── TOTP ──
function base32ToBytes(s) {
  s = s.toUpperCase().replace(/[\s=]/g, '');
  var bits = 0, buf = 0, out = [];
  for (var i = 0; i < s.length; i++) {
    var v = BASE32_CHARS.indexOf(s[i]);
    if (v < 0) continue;
    buf = (buf << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((buf >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return out;
}

function hotp(secret, counter) {
  var key = base32ToBytes(secret).map(function(b){ return b > 127 ? b - 256 : b; });
  var msg = [0, 0, 0, 0,
    (counter >>> 24) & 0xff, (counter >>> 16) & 0xff,
    (counter >>> 8)  & 0xff,  counter & 0xff
  ].map(function(b){ return b > 127 ? b - 256 : b; });
  var hmac = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, msg, key);
  var offset = hmac[19] & 0x0f;
  var code = (((hmac[offset] & 0xff) & 0x7f) << 24) |
             ((hmac[offset + 1] & 0xff) << 16) |
             ((hmac[offset + 2] & 0xff) << 8) |
              (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function checkTOTP(secret, userCode) {
  var t = Math.floor(new Date().getTime() / 30000);
  var code = String(userCode).replace(/\s/g, '').padStart(6, '0');
  for (var d = -1; d <= 1; d++) {
    if (hotp(secret, t + d) === code) return true;
  }
  return false;
}

function generateTOTPSecret() {
  // Utilities.getUuid() bruger Java SecureRandom — kryptografisk sikker, i modsætning til Math.random()
  var raw  = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  var s = '';
  for (var i = 0; i < 32; i++) s += BASE32_CHARS[hash[i] & 0x1f];
  return s;
}

function verifyLogin(p) {
  var props      = getProps();
  var storedHash = props.getProperty('LAGER_HASH');
  var token      = props.getProperty('LAGER_TOKEN');
  if (!storedHash || !token) return { error: 'Server ikke konfigureret — sæt LAGER_HASH og LAGER_TOKEN i Script Properties' };

  var attempts  = parseInt(props.getProperty('LOGIN_ATTEMPTS') || '0', 10);
  var lockUntil = parseInt(props.getProperty('LOGIN_LOCK_UNTIL') || '0', 10);
  var now       = Date.now();

  if (now < lockUntil) {
    var minsLeft = Math.ceil((lockUntil - now) / 60000);
    return { error: 'For mange forsøg — prøv igen om ' + minsLeft + ' min.' };
  }

  if (p.hash === storedHash) {
    props.setProperty('LOGIN_ATTEMPTS',   '0');
    props.setProperty('LOGIN_LOCK_UNTIL', '0');
    var totpSecret = props.getProperty('TOTP_SECRET');
    if (totpSecret) return { step2: true };
    refreshExpiry(props); // Forny 12-timers session
    return { token: token };
  }

  attempts++;
  props.setProperty('LOGIN_ATTEMPTS', String(attempts));
  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    props.setProperty('LOGIN_LOCK_UNTIL', String(now + LOGIN_LOCKOUT_MS));
    props.setProperty('LOGIN_ATTEMPTS',   '0');
    sendLockoutAlert('adgangskode');
    return { error: 'For mange forsøg — låst i 15 min.' };
  }
  var left = LOGIN_MAX_ATTEMPTS - attempts;
  return { error: 'Forkert kode — ' + left + ' forsøg tilbage' };
}

function verifyStep2(p) {
  var props      = getProps();
  var storedHash = props.getProperty('LAGER_HASH');
  var token      = props.getProperty('LAGER_TOKEN');
  var totpSecret = props.getProperty('TOTP_SECRET');
  if (!storedHash || !token || !totpSecret) return { error: 'Ikke konfigureret' };
  if (p.hash !== storedHash) return { error: 'Ugyldig session — log ind igen' };

  var attempts  = parseInt(props.getProperty('TOTP_ATTEMPTS') || '0', 10);
  var lockUntil = parseInt(props.getProperty('TOTP_LOCK_UNTIL') || '0', 10);
  var now       = Date.now();
  if (now < lockUntil) {
    return { error: 'For mange forsøg — vent ' + Math.ceil((lockUntil - now) / 60000) + ' min.' };
  }

  if (!checkTOTP(totpSecret, p.code)) {
    attempts++;
    props.setProperty('TOTP_ATTEMPTS', String(attempts));
    if (attempts >= TOTP_MAX_ATTEMPTS) {
      props.setProperty('TOTP_LOCK_UNTIL', String(now + TOTP_LOCKOUT_MS));
      props.setProperty('TOTP_ATTEMPTS', '0');
      sendLockoutAlert('TOTP');
      return { error: 'For mange forsøg — låst i 5 min.' };
    }
    return { error: 'Forkert kode — ' + (TOTP_MAX_ATTEMPTS - attempts) + ' forsøg tilbage' };
  }

  props.setProperty('TOTP_ATTEMPTS',   '0');
  props.setProperty('TOTP_LOCK_UNTIL', '0');
  refreshExpiry(props); // Forny 12-timers session

  // Udsted device-trust hemmelighed (separat fra session-token)
  var deviceSecret = Utilities.getUuid().replace(/-/g, '');
  props.setProperty('DEVICE_TRUST_SECRET',  deviceSecret);
  props.setProperty('DEVICE_TRUST_EXPIRES', String(now + 24 * 60 * 60 * 1000));
  return { token: token, deviceSecret: deviceSecret };
}

function verifyDeviceTrust(p) {
  var props   = getProps();
  var stored  = props.getProperty('DEVICE_TRUST_SECRET');
  var expires = parseInt(props.getProperty('DEVICE_TRUST_EXPIRES') || '0', 10);
  if (!stored || !p.deviceSecret || p.deviceSecret !== stored) return { error: 'Ugyldig enhed' };
  if (Date.now() > expires) return { error: 'TOKEN_EXPIRED' };
  refreshExpiry(props); // Forny session
  return { token: props.getProperty('LAGER_TOKEN') };
}

function setupTOTP(p) {
  var props      = getProps();
  var storedHash = props.getProperty('LAGER_HASH');
  if (!storedHash || p.hash !== storedHash) return { error: 'Forkert adgangskode' };
  if (props.getProperty('TOTP_SECRET'))    return { error: '2FA er allerede aktiveret' };
  var secret = generateTOTPSecret();
  props.setProperty('TOTP_PENDING', secret); // Gemmes som pending — aktiveres først ved confirmTOTPSetup
  return { secret: secret };
}

function confirmTOTPSetup(p) {
  var props      = getProps();
  var storedHash = props.getProperty('LAGER_HASH');
  if (!storedHash || p.hash !== storedHash) return { error: 'Forkert adgangskode' };
  var pending = props.getProperty('TOTP_PENDING');
  if (!pending) return { error: 'Ingen ventende TOTP-opsætning' };
  if (!checkTOTP(pending, p.code)) {
    props.deleteProperty('TOTP_PENDING'); // Fjern pending hvis bekræftelse fejler
    return { error: 'Forkert kode — prøv igen fra start' };
  }
  // Bekræftelse lykkedes — promovér pending → aktiv
  props.setProperty('TOTP_SECRET', pending);
  props.deleteProperty('TOTP_PENDING');
  return { ok: true };
}

function disableTOTP(p) {
  var props      = getProps();
  var storedHash = props.getProperty('LAGER_HASH');
  var secret     = props.getProperty('TOTP_SECRET');
  if (!storedHash || p.hash !== storedHash) return { error: 'Forkert adgangskode' };
  if (!secret) return { error: '2FA er ikke aktiveret' };
  if (!checkTOTP(secret, p.code)) return { error: 'Forkert Google Authenticator-kode' };
  props.deleteProperty('TOTP_SECRET');
  return { ok: true };
}

function shipmondoRequest(method, endpoint, payload) {
  var props = getProps();
  var user = props.getProperty('SHIPMONDO_USER');
  var key  = props.getProperty('SHIPMONDO_KEY');
  if (!user || !key) throw new Error('SHIPMONDO_USER og SHIPMONDO_KEY mangler i Script Properties');
  var auth = Utilities.base64Encode(user + ':' + key);
  var options = {
    method: method,
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(BASE_URL + endpoint, options);
  var txt = res.getContentText();
  try {
    return JSON.parse(txt);
  } catch (err) {
    return { error: txt };
  }
}

function getMonthlyStats() {
  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth();
  var all   = [];
  var page  = 1;
  var stop  = false;

  while (!stop) {
    var data = shipmondoRequest('GET', 'shipments?per_page=100&page=' + page);
    if (!Array.isArray(data) || data.length === 0) break;
    for (var i = 0; i < data.length; i++) {
      var s = data[i];
      var d = new Date(s.created_at);
      if (d.getFullYear() === year && d.getMonth() === month) {
        all.push(s);
      } else if (d < new Date(year, month, 1)) {
        stop = true;
        break;
      }
    }
    if (data.length < 100) break;
    page++;
  }

  var total = all.length;
  var sum   = 0;
  var count = 0;
  for (var j = 0; j < all.length; j++) {
    var price = parseFloat(String(all[j].price));
    if (!isNaN(price) && price > 0) {
      sum += price;
      count++;
    }
  }
  var avg = count > 0 ? sum / count : 0;

  return {
    month_count: total,
    month_total: Math.round(sum * 100) / 100,
    month_avg:   Math.round(avg * 100) / 100,
    currency:    'DKK',
    month:       month + 1,
    year:        year
  };
}

function padZ(n) { return n < 10 ? '0' + n : '' + n; }

function getMonthlyHistory() {
  var now = new Date();
  var sixAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  var firstDay = sixAgo.getFullYear() + '-' + padZ(sixAgo.getMonth() + 1) + '-01';
  var lastDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  var lastDay = now.getFullYear() + '-' + padZ(now.getMonth() + 1) + '-' + padZ(lastDate.getDate());

  var all = [];
  var page = 1;
  while (true) {
    var data = shipmondoRequest('GET', 'shipments?per_page=100&page=' + page + '&created_at_min=' + firstDay + '&created_at_max=' + lastDay);
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
  }

  var groups = {};
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    var d = new Date(s.created_at);
    var key = d.getFullYear() + '-' + padZ(d.getMonth() + 1);
    if (!groups[key]) groups[key] = { year: d.getFullYear(), month: d.getMonth() + 1, ships: [] };
    groups[key].ships.push(s);
  }

  var months = [];
  for (var m = 5; m >= 0; m--) {
    var date = new Date(now.getFullYear(), now.getMonth() - m, 1);
    var key = date.getFullYear() + '-' + padZ(date.getMonth() + 1);
    var group = groups[key] || { year: date.getFullYear(), month: date.getMonth() + 1, ships: [] };
    var prices = group.ships.map(function(s) { return parseFloat(s.price || 0); }).filter(function(p) { return p > 0; });
    var sum = prices.reduce(function(a, b) { return a + b; }, 0);
    months.push({
      year: group.year, month: group.month,
      count: group.ships.length,
      total: Math.round(sum * 100) / 100,
      avg: prices.length ? Math.round((sum / prices.length) * 100) / 100 : 0
    });
  }
  return { months: months };
}

function getBalance() {
  var bal = shipmondoRequest('GET', 'account/balance');
  if (bal && bal.amount !== undefined) {
    return { balance: bal.amount, currency: bal.currency_code || 'DKK' };
  }
  return { balance: null, currency: 'DKK' };
}

function getShipments(p) {
  var qs = 'per_page=25&page=' + (p.page || 1);
  if (p.q) qs += '&q=' + encodeURIComponent(p.q);
  var data = shipmondoRequest('GET', 'shipments?' + qs);
  return { shipments: Array.isArray(data) ? data : [] };
}

function getProducts(p) {
  return shipmondoRequest('GET', 'products?country_code=' + (p.country || 'DK'));
}


function getSesuPrices(forceRefresh) {
  var cache = CacheService.getScriptCache();
  var KEY = 'sesu_prices_v9';
  if (!forceRefresh) {
    var cached = cache.get(KEY);
    if (cached) return JSON.parse(cached);
  }

  var products = {};

  for (var page = 1; page <= 12; page++) {
    var pageUrl = 'https://sesu.dk/shop/page/' + page + '/';
    var res = UrlFetchApp.fetch(pageUrl, { muteHttpExceptions: true });
    var html = res.getContentText();
    if (res.getResponseCode() !== 200 || html.indexOf('sku&quot;') === -1) break;

    var chunks = html.split('<li class="product');
    for (var i = 1; i < chunks.length; i++) {
      var chunk = chunks[i];
      // CSS class-based detection (before first >)
      var classEnd = chunk.indexOf('>');
      var liClass = classEnd > 0 ? chunk.substring(0, classEnd) : '';
      var outofstock = liClass.indexOf('outofstock') !== -1;
      // JSON-LD availability overrides CSS class — more reliable for variable products
      var mInStock  = chunk.match(/&quot;availability&quot;:&quot;[^&]*InStock/i);
      var mOutStock = chunk.match(/&quot;availability&quot;:&quot;[^&]*OutOfStock/i);
      if (mInStock)  outofstock = false;
      else if (mOutStock) outofstock = true;

      var mSku   = chunk.match(/&quot;sku&quot;:&quot;([^&]*)&quot;/);
      var mPrice = chunk.match(/&quot;price&quot;:([0-9.]+)/);
      var mName  = chunk.match(/&quot;item_name&quot;:&quot;([^&]*)&quot;/);
      // Product permalink: exclude shop, category, tag, page paths
      var mUrl = chunk.match(/href="(https:\/\/sesu\.dk\/(?!shop\/|product-category\/|produktkategori\/|tag\/|page\/)[^"?#]{5,}\/?)"/);
      if (!mSku) continue;
      var sku   = mSku[1].trim();
      var price = mPrice ? parseFloat(mPrice[1]) : null;
      var name  = mName ? mName[1] : '';
      var url   = mUrl ? mUrl[1] : '';
      var mImg = chunk.match(/src="(https?:\/\/[^"]*sesu\.dk\/wp-content\/uploads\/[^"?]+\.(?:jpg|jpeg|png|webp))"/i);
      if (!mImg) mImg = chunk.match(/data-src="(https?:\/\/[^"]*sesu\.dk\/wp-content\/uploads\/[^"?]+\.(?:jpg|jpeg|png|webp))"/i);
      var image = mImg ? mImg[1] : '';
      if (sku && (price !== null || outofstock)) {
        products[sku] = { price: price, name: name, url: url, image: image, outofstock: outofstock };
      }
    }

    // Fallback: any sku+price not caught above
    var fallbacks = html.match(/sku&quot;:&quot;([^&]*)&quot;,&quot;price&quot;:([0-9.]+)/g) || [];
    for (var j = 0; j < fallbacks.length; j++) {
      var m = fallbacks[j].match(/sku&quot;:&quot;([^&]*)&quot;,&quot;price&quot;:([0-9.]+)/);
      if (m && m[1] && !products[m[1].trim()]) {
        products[m[1].trim()] = { price: parseFloat(m[2]), name: '', url: '' };
      }
    }
  }

  // Second pass: verify outofstock products via their individual product pages
  // (shop listing may show outofstock for variable products even when a variant is in stock)
  var toVerify = [];
  for (var sku in products) {
    if (products[sku].outofstock && products[sku].url) toVerify.push(sku);
  }
  if (toVerify.length > 0) {
    var reqs = toVerify.map(function(sku) {
      return { url: products[sku].url, muteHttpExceptions: true };
    });
    var responses = UrlFetchApp.fetchAll(reqs);
    for (var ri = 0; ri < responses.length; ri++) {
      var sku2 = toVerify[ri];
      var resp2 = responses[ri];
      if (resp2.getResponseCode() !== 200) continue;
      var body = resp2.getContentText();
      // Multiple WooCommerce in-stock signals
      var isInStock = body.indexOf('schema.org/InStock') !== -1   // JSON-LD http or https
                   || body.indexOf('"InStock"') !== -1             // JSON-LD shorthand
                   || body.indexOf('single_add_to_cart_button') !== -1  // add-to-cart present
                   || body.indexOf('class="stock in-stock"') !== -1;    // WC stock span
      var isOutOfStock = body.indexOf('schema.org/OutOfStock') !== -1
                      || body.indexOf('"OutOfStock"') !== -1
                      || body.indexOf('class="stock out-of-stock"') !== -1;
      if (isInStock && !isOutOfStock) products[sku2].outofstock = false;
    }
  }

  cache.put(KEY, JSON.stringify(products), 21600);
  return products;
}

function getPricingStats() {
  var now = new Date();
  var from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  var fromStr = from.getFullYear() + '-' + padZ(from.getMonth() + 1) + '-01';

  var all = [];
  var page = 1;
  while (true) {
    var data = shipmondoRequest('GET', 'shipments?per_page=100&page=' + page + '&created_at_min=' + fromStr);
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
  }

  var stats = {};
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    var code = s.product_code || 'UNKNOWN';
    var price = parseFloat(s.price);
    if (isNaN(price) || price <= 0) continue;
    if (!stats[code]) stats[code] = { prices: [], carrier: s.carrier_code || '' };
    stats[code].prices.push(price);
  }

  var result = {};
  for (var code in stats) {
    var prices = stats[code].prices;
    prices.sort(function(a, b) { return a - b; });
    var sum = prices.reduce(function(a, b) { return a + b; }, 0);
    result[code] = {
      avg:    Math.round((sum / prices.length) * 100) / 100,
      min:    Math.round(prices[0] * 100) / 100,
      max:    Math.round(prices[prices.length - 1] * 100) / 100,
      count:  prices.length,
      carrier: stats[code].carrier
    };
  }
  return result;
}

function getPrinters() {
  return shipmondoRequest('GET', 'printers');
}

function fetchLabelB64(url) {
  var props = getProps();
  var user = props.getProperty('SHIPMONDO_USER');
  var key  = props.getProperty('SHIPMONDO_KEY');
  var auth = Utilities.base64Encode(user + ':' + key);
  var res = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Basic ' + auth },
    muteHttpExceptions: true,
    followRedirects: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  }
  var bytes = res.getContent();
  if (!bytes || bytes.length === 0) throw new Error('Tom PDF-respons fra Shipmondo');
  return Utilities.base64Encode(bytes);
}

function getLabel(id) {
  // Shipmondo returnerer label som base64 direkte i /labels endpoint
  try {
    var labelData = shipmondoRequest('GET', 'shipments/' + id + '/labels');
    if (Array.isArray(labelData) && labelData.length) {
      var lbl = labelData[0];
      // base64 direkte i svaret (primær sti)
      if (lbl.base64) return { label_b64: lbl.base64, id: id };
      // URL som fallback
      var url = lbl.label_url || lbl.pdf_uri || lbl.url || null;
      if (url) {
        var b64 = fetchLabelB64(url);
        return { label_b64: b64, label_url: url, id: id };
      }
    }
    return { id: id, error: 'Ingen label fra Shipmondo — forsendelsen er muligvis ikke bekræftet endnu' };
  } catch(e) {
    return { id: id, error: 'Fejl ved hentning af label: ' + e.message };
  }
}

function debugLabel(id) {
  var ship = shipmondoRequest('GET', 'shipments/' + id);
  var labelsEndpoint = null;
  try { labelsEndpoint = shipmondoRequest('GET', 'shipments/' + id + '/labels'); } catch(e) { labelsEndpoint = 'FEJL: ' + e.message; }
  return {
    top_keys:       Object.keys(ship || {}),
    label_url:      ship.label_url || null,
    pdf_uri:        ship.pdf_uri   || null,
    labels_field:   ship.labels    || null,
    packages_field: ship.packages  ? ship.packages.map(function(p){ return { id:p.id, label:p.label, label_url:p.label_url }; }) : null,
    labels_endpoint: labelsEndpoint
  };
}

function sendReorderEmail(p) {
  if (!p.to) return { error: 'Ingen modtager-email' };
  MailApp.sendEmail({
    to: p.to,
    subject: p.subject || 'Genbestilling',
    body: p.body || ''
  });
  return { ok: true };
}

function createShipment(p) {
  var payload = {
    own_agreement: false,
    label_format: p.label_format || 'a4_pdf',
    product_code: p.product_code,
    service_codes: p.service_codes || '',
    reference: p.reference || '',
    automatic_select_service_point: true,
    parties: [
      {
        type: 'sender',
        name: p.sender_name,
        address1: p.sender_address,
        postal_code: p.sender_zip,
        city: p.sender_city,
        country_code: 'DK',
        email: p.sender_email || '',
        phone: p.sender_phone || ''
      },
      {
        type: 'receiver',
        name: p.receiver_name,
        address1: p.receiver_address,
        postal_code: p.receiver_zip,
        city: p.receiver_city,
        country_code: p.receiver_country || 'DK',
        email: p.receiver_email || '',
        phone: p.receiver_phone || ''
      }
    ],
    parcels: [{ weight: parseInt(p.weight_grams) || 1000 }]
  };
  if (p.printer_host && p.printer_name) {
    payload.print = true;
    payload.print_at = {
      host_name: p.printer_host,
      printer_name: p.printer_name,
      label_format: p.printer_format || 'zpl'
    };
  }
  return shipmondoRequest('POST', 'shipments', payload);
}
