var BASE_URL = 'https://app.shipmondo.com/api/public/v3/';

function getProps() {
  return PropertiesService.getScriptProperties();
}

// Kør denne funktion én gang manuelt i Apps Script-editoren for at sætte credentials
// Sæt SHIPMONDO_USER og SHIPMONDO_KEY manuelt i Script Properties (Project Settings → Script Properties)
function initShipmondoCreds() {
  Logger.log('Sæt SHIPMONDO_USER og SHIPMONDO_KEY direkte i Script Properties — ikke her.');
}

function validToken(p) {
  var expected = getProps().getProperty('LAGER_TOKEN');
  if (!expected) return false;
  return p.token === expected;
}

function doGet(e) {
  var p  = e.parameter;
  var cb = p.callback;
  var result;
  try {
    var action = p.action;
    if (action === 'verifyLogin') {
      result = verifyLogin(p);
    } else if (!validToken(p)) {
      result = { error: 'Ikke autoriseret' };
    } else if (action === 'getShipments')         result = getShipments(p);
    else if (action === 'getProducts')     result = getProducts(p);
    else if (action === 'getPricingStats')   result = getPricingStats();
    else if (action === 'getSesuPrices')    result = getSesuPrices();
    else if (action === 'getPrinters')     result = getPrinters();
    else if (action === 'getLabel')        result = getLabel(p.id);
    else if (action === 'createShipment')  result = createShipment(p);
    else if (action === 'getBalance')      result = getBalance();
    else if (action === 'getMonthlyStats')   result = getMonthlyStats();
    else if (action === 'getMonthlyHistory') result = getMonthlyHistory();
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
  var data = JSON.parse(e.postData.contents);
  var result;
  try {
    if (!validToken(data)) {
      result = { error: 'Ikke autoriseret' };
    } else if (data.action === 'createShipment') {
      result = createShipment(data);
    } else if (data.action === 'claudeProxy') {
      result = claudeProxy(data);
    } else {
      result = { error: 'Ukendt POST handling' };
    }
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
var LOGIN_LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutter

function verifyLogin(p) {
  var props      = getProps();
  var storedHash = props.getProperty('LAGER_HASH');
  var token      = props.getProperty('LAGER_TOKEN');
  if (!storedHash || !token) return { error: 'Server ikke konfigureret — sæt LAGER_HASH og LAGER_TOKEN i Script Properties' };

  // Brute-force check
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
    return { token: token };
  }

  attempts++;
  props.setProperty('LOGIN_ATTEMPTS', String(attempts));
  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    props.setProperty('LOGIN_LOCK_UNTIL', String(now + LOGIN_LOCKOUT_MS));
    props.setProperty('LOGIN_ATTEMPTS',   '0');
    return { error: 'For mange forsøg — låst i 15 min.' };
  }
  var left = LOGIN_MAX_ATTEMPTS - attempts;
  return { error: 'Forkert kode — ' + left + ' forsøg tilbage' };
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


function getSesuPrices() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('sesu_prices_v4');
  if (cached) return JSON.parse(cached);

  var products = {};

  for (var page = 1; page <= 12; page++) {
    var pageUrl = 'https://sesu.dk/shop/page/' + page + '/';
    var res = UrlFetchApp.fetch(pageUrl, { muteHttpExceptions: true });
    var html = res.getContentText();
    if (res.getResponseCode() !== 200 || html.indexOf('sku&quot;') === -1) break;

    // Split by product <li> so each chunk contains one product's href + GTM data
    var chunks = html.split('<li class="product');
    for (var i = 1; i < chunks.length; i++) {
      var chunk = chunks[i];
      var mSku   = chunk.match(/&quot;sku&quot;:&quot;([^&]*)&quot;/);
      var mPrice = chunk.match(/&quot;price&quot;:([0-9.]+)/);
      var mName  = chunk.match(/&quot;item_name&quot;:&quot;([^&]*)&quot;/);
      var mUrl   = chunk.match(/href="(https:\/\/sesu\.dk\/[^"]+)"/);
      if (!mSku || !mPrice) continue;
      var sku   = mSku[1].trim();
      var price = parseFloat(mPrice[1]);
      var name  = mName ? mName[1] : '';
      var url   = mUrl ? mUrl[1] : '';
      if (sku && !isNaN(price)) {
        products[sku] = { price: price, name: name, url: url };
      }
    }

    // Fallback: any sku+price not caught above (no <li class="product" split available)
    var fallbacks = html.match(/sku&quot;:&quot;([^&]*)&quot;,&quot;price&quot;:([0-9.]+)/g) || [];
    for (var j = 0; j < fallbacks.length; j++) {
      var m = fallbacks[j].match(/sku&quot;:&quot;([^&]*)&quot;,&quot;price&quot;:([0-9.]+)/);
      if (m && m[1] && !products[m[1].trim()]) {
        products[m[1].trim()] = { price: parseFloat(m[2]), name: '', url: '' };
      }
    }
  }

  cache.put('sesu_prices_v4', JSON.stringify(products), 21600);
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

function getLabel(id) {
  var data = shipmondoRequest('GET', 'shipments/' + id);
  return { label_url: data.label_url || data.pdf_uri || null, id: id, error: data.error || null };
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
