# SESU Lagersystem — Projektbeskrivelse

## Hvad er dette?

Lagerstyringssystem til SESU (bordben, understel m.m.). Single-page vanilla JS app på GitHub Pages med to Google Apps Script backends.

Live URL: https://nickguidesyou-jpg.github.io/lager/

---

## KRITISK REGEL — MÅ ALDRIG BRYDES

**POST til Shipmondo `/shipments` endpoint er FORBUDT.**
`dry_run: true` virker ikke — det opretter rigtige forsendelser der koster penge og ikke kan annulleres via API. Tidligere fejl kostede ~630 kr. for 12 utilsigtede forsendelser.
Brug **KUN GET-endpoints** på Shipmondo. `createShipment` i Code.js eksisterer men må aldrig kaldes fra frontend.

---

## Filstruktur

```
/Users/nickolaiammentorp/lager/          ← git-repo (GitHub Pages)
  index.html                              ← al frontend (HTML + CSS + ~7000 linjer JS)
  gas/ship/Code.js                        ← ship Apps Script (Shipmondo + sesu.dk + Claude AI)
  manifest.json, sw.js, appsscript.json

/Users/nickolaiammentorp/lager-script/   ← separat clasp-projekt
  Code.js                                 ← lager Apps Script (Google Sheets CRUD)
```

---

## Deployment

### GitHub Pages (frontend)
```bash
git -C /Users/nickolaiammentorp/lager add index.html && git commit -m "..." && git push origin main
```

### Ship Apps Script (Shipmondo/sesu/Claude)
```bash
cd /Users/nickolaiammentorp/lager && clasp push
clasp deploy -i AKfycbwtLFUm0lMDMg8arsAtYPR8O_rz7iTN78-c2ubCkcGLnnYGmPhtxXox1JIDWLkLkMNSjQ -d "beskrivelse"
```
Deploy-URL i frontend (index.html linje ~3187): `SHIP_API`

### Lager Apps Script (Google Sheets)
```bash
cd /Users/nickolaiammentorp/lager-script && clasp push
clasp deploy -i AKfycbwdbhEo-na7UVPQ4raRAz22NhVxFzE8YvdyK1u06iTTKd4PDbdlQLU1jgHjhubgIUYZjw -d "beskrivelse"
```
Deploy-URL i frontend (index.html linje ~2105): `API`

---

## Arkitektur

### Frontend → Backend kommunikation
```javascript
// Til lager-script (Sheets CRUD):
await jsonp({ action: 'saveItem', ...item })

// Til ship-script (Shipmondo, sesu.dk, Claude):
await jsonpShip({ action: 'getSesuPrices' })
```
Begge er `fetch POST` med `Content-Type: text/plain` (undgår CORS-preflight). Hedder `jsonp` af historiske årsager — er ikke JSONP.

### Autentificering
- Bruger SHA-256-hash af password, sammenlignet med `LAGER_HASH` i Script Properties
- Server returnerer statisk `LAGER_TOKEN` (gemt i sessionStorage)
- TOTP 2FA via Google Authenticator (valgfrit)
- Device trust: 24-timers cookie der springer TOTP over på kendte enheder

### Data
- Varer, Rum, Historik, Skabeloner, Leverandoerer, Indkoebsordrer gemmes i Google Sheets
- Salgsordrer gemmes **kun** i localStorage (AES-GCM krypteret med token som nøgle)
- sesu.dk priser caches i Apps Script CacheService (6 timer, cache-nøgle: `sesu_prices_v9`)

---

## Vare-objekt (items)

```javascript
{
  id, name, cat, room, shelf, qty, minQty, sku, note,
  created, leadDays, supplier, costPrice, moq,
  reserved, bundle_json, imageUrl,
  damaged_qty,   // antal beskadigede enheder
  location,      // fritekst placering, fx "Rum A, Hylde 2"
  sale_price     // din egen salgspris (ikke sesu.dk's)
}
```

---

## Vigtige funktioner i index.html

| Funktion | Beskrivelse |
|---|---|
| `renderItems()` | Genrenderer hele varetabellen |
| `renderAll()` | Kalder alle render-funktioner |
| `findSesuPrice(item)` | Matcher en vare til sesu.dk pris (name-matching + SKU) |
| `matchForReport(item)` | Strengere matching til partner-rapport |
| `normName(s)` | Normaliserer varenavn til matching |
| `wordScore(a, b)` | Jaccard-lighed mellem to navne (tærskel: 0.28) |
| `calcABC()` | ABC-analyse baseret på historik (from_qty/to_qty) |
| `daekningsdage(id)` | Dage til nul baseret på historik-forbrug |
| `generatePartnerReport()` | Genererer HTML-rapport med password-gate |
| `openBarcodeScanner(cb)` | Åbner kamera til stregkodescanning |
| `openReorderModal(id)` | AI-genereret genbestillingsmail |
| `loadSesuPrices(forceRefresh)` | Henter sesu.dk priser (med force-refresh) |

---

## sesu.dk pris-matching

Matching sker i to trin:
1. SKU-opslag (eksakt match)
2. Name-matching via `normName` + `wordScore` (Jaccard ≥ 0.28)

**Farve-tokens** skal alle matche (ikke bare ét): `REPORT_COLOR_TOKENS` inkluderer `rose`, `brush`, `gunmetal`, `messing`, `bronze`, `velvet`, `steel` m.fl.

Outofstock-detektion: CSS-klasse på listingside + JSON-LD availability + second-pass verifikation på produktside.

**Kendt uløst bug:** V Stænger Hairpin 71cm MESSING og Skrå Trapez-bordben 71cm MESSING vises stadig som "udsolgt på sesu.dk" selvom de ikke er det. URLs: `sesu.dk/messing-v-hairpin-bordben-71cm-mat/` og `sesu.dk/messing-skraa-trapez-71cm/`

---

## Rapport-adgangskode

Partner-rapport adgangskode: `dpt68uwe!`
SHA-256 hash (hardcodet i index.html, ingen klartekst i source): `88423afe4fea6e2f0567bfc1a41cb61850d87015692590a621f6645d3a739a39`

---

## Implementerede funktioner (alle live)

- Varestyring (CRUD, kategorier, rum, min-beholdning)
- Stregkodescanning via kamera (`BarcodeDetector` + fallback)
- Skadede varer (`damaged_qty`) med badge og oversigt
- Lagerplacering (`location`) med autocomplete
- Salgspris (`sale_price`) og avanceberegning (grøn/gul/rød %)
- ABC-analyse kort i overblik
- Lageromsætningshastighed (dage til nul, fremhæver <14 dage)
- Automatiske genbestillingsemails (AI-udkast via Claude + send via MailApp)
- Omsætningshistorik (månedsoversigt + top 5)
- sesu.dk prissammenligning (scraping via Apps Script)
- Partner-rapport (PDF-venlig, password-gate, KPI-kort, Top 5-sektioner)
- Indkøbsordrer (PO-flow med modtagelse og pluk)
- Forsendelser via Shipmondo (KUN visning — ingen oprettelse)
- TOTP 2FA med Google Authenticator
- AI-lageranalyse via Claude (genbestillingsforslag m.m.)
- PWA (offline-shell via service worker)

---

## Kendte begrænsninger

- Salgsordrer overlever ikke hvis `LAGER_TOKEN` roteres (AES-nøgle afledt af token)
- ABC-analyse og aktivitetsfeed kræver at Historik-fanen er besøgt mindst én gang
- sesu.dk-scraping kan fejle hvis siden ændrer struktur
- `Math.random()` bruges til TOTP-secret generering (ikke kryptografisk sikker)
- Ingen multi-user support — ét delt token
