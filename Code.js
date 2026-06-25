var SHIPMONDO_USER = '270c71ce-28a2-47ff-bc06-b73a972d5cc0';
var SHIPMONDO_KEY  = '6bb70c43-5957-43ec-9264-ccaaec14351f';
var BASE_URL = 'https://app.shipmondo.com/api/public/v3/';

function getProps() {
  return PropertiesService.getScriptProperties();
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
    } else {
      result = { error: 'Ukendt POST handling' };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyLogin(p) {
  var storedHash = getProps().getProperty('LAGER_HASH');
  var token      = getProps().getProperty('LAGER_TOKEN');
  if (!storedHash || !token) return { error: 'Server ikke konfigureret — sæt LAGER_HASH og LAGER_TOKEN i Script Properties' };
  if (p.hash === storedHash) {
    return { token: token };
  }
  return { error: 'Forkert kode' };
}

function shipmondoRequest(method, endpoint, payload) {
  var auth = Utilities.base64Encode(SHIPMONDO_USER + ':' + SHIPMONDO_KEY);
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
  var bal = shipmondoRequest('GET', 'account_balance');
  if (bal && bal.balance !== undefined) {
    return { balance: bal.balance, currency: bal.currency || 'DKK' };
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
