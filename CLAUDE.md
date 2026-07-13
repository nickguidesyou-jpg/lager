# SESU Lagersystem — Projektbeskrivelse

## Hvad er dette?

Lagerstyringssystem til SESU (bordben, understel m.m.). Single-page vanilla JS app på GitHub Pages med to Google Apps Script backends.

Live URL: https://nickguidesyou-jpg.github.io/lager/

---

## KRITISK REGEL — MÅ ALDRIG BRYDES

**Claude må ALDRIG selv kalde/teste Shipmondo `/shipments` POST (`createShipment`).**
`dry_run: true` virker ikke — det opretter rigtige forsendelser der koster penge og ikke kan annulleres via API. Tidligere fejl kostede ~630 kr. for 12 utilsigtede forsendelser.
`createShipment` er en **bevidst brugerfunktion** ("+ Ny forsendelse"-knappen) som brugeren selv udløser — den må gerne eksistere og vedligeholdes, men Claude må aldrig kalde endpointet programmatisk, i tests eller via curl. Alle andre Shipmondo-kald skal være GET.

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
- Device trust: 24-timers device-secret der springer TOTP over — op til 5 enheder samtidig (`DEVICE_TRUST_LIST` i Script Properties)

### Data
- Varer, Rum, Historik, Skabeloner, Leverandoerer, Indkoebsordrer, Salgsordrer gemmes i Google Sheets
- Salgsordrer migreres automatisk fra det gamle AES-krypterede localStorage-format ved første indlæsning
- sesu.dk priser caches i Apps Script CacheService (6 timer, cache-nøgle: `sesu_prices_v10`)
- Prisalarm: frontend gemmer snapshot af matchede sesu-priser i localStorage og viser ændringer (pris/lagerstatus) som kort i Oversigt

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

Matching sker i tre trin:
1. SKU-opslag (eksakt match)
2. Manuel pin (`SESU_PINS` i index.html): drilske varer koblet direkte til deres sesu-sku via normName-tokens. Mangler den pinnede sku i scrapet, vises varen som "ikke til salg" i stedet for at navnematche en forkert variant. Pinnet pt.: Skrå Trapez Messing 71cm → 12047, V-hairpin Messing 71cm → 12645
3. Name-matching via `normName` + `wordScore` (Jaccard ≥ 0.28)

**Farve-tokens** skal alle matche (ikke bare ét): `REPORT_COLOR_TOKENS` inkluderer `rose`, `brush`, `gunmetal`, `messing`, `bronze`, `velvet`, `steel` m.fl.

Outofstock-detektion: CSS-klasse på listingside + JSON-LD availability + second-pass verifikation på produktside.

**Vigtigt ved scraping-parsing:** sku i sesu.dk's datalag kan være både citeret streng (`&quot;sku&quot;:&quot;909&quot;`) og rent tal (`&quot;sku&quot;:12047`) — regexen skal håndtere begge. Produktpermalink identificeres via `class="woocommerce-LoopProduct-link"` (kategorilinks i samme chunk har `rel="tag"`).

**Scrape-robusthed:** Hver listingside prøves op til 2 gange og springes over ved vedvarende fejl (aldrig `break` — en transient fejl på én side må ikke amputere resultatet). Resultater med <10 produkter forkastes uden caching (returnerer `{error}`). Frontend gemmer seneste succesfulde datasæt i localStorage (`lager_sesu_lastgood`, 48t) som fallback ved fejlet scrape — prisalarm kører kun mod friske data.

---

## Rapport-adgangskode

Adgangskoden opbevares **ikke** i klartekst i repoet. Den tidligere klartekst-kode lå her og
skal derfor betragtes som kompromitteret — **rotér den** (vælg ny kode, opdater SHA-256-hashen i
index.html, og fjern den gamle klartekst fra git-historikken med `git filter-repo`).
SHA-256 hash af den nuværende kode (hardcodet i index.html): `be15d78982949aa09f32681b5a8de0ec00f907943dd23e0a3183a8173ce73959`

> Bemærk: rapport-gaten er klientside-only (alle data ligger i det genererede dokument). En kode
> beskytter kun mod tilfældige kig, ikke mod nogen der åbner kildekoden. Del aldrig rapporten med
> nogen der ikke må se alle tal.

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
- Samlet genbestilling: "⚡ Opret alle (+ send mails)" laver én PO pr. leverandør og mailer dem
- Forsendelser via Shipmondo (visning + manuel oprettelse via "Ny forsendelse" — se kritisk regel)
- Salgsordrer i Google Sheets med automatisk lagertræk når status sættes til "afsendt" (deducted-flag forhindrer dobbelt-træk)
- Salgsordre → forsendelse: "📦 Forsendelse"-knap pre-udfylder "Ny forsendelse" med kundedata; ved oprettelse kobles pakkeindhold fra ordrelinjer, ordren sættes til afsendt og lagertræk køres (`linkShipmentToSO`)
- AI-salgsordre: "✦ Udfyld med AI" i salgsordre-modalen udtrækker kunde/adresse/varelinjer fra en indsat ordremail (varelinjer matches lokalt via `wordScore`, ukendte varer rapporteres)
- Følgeseddel-print pr. salgsordre ("🖨 Følgeseddel" — print-side uden priser, med afsender/modtager/linjer/note)
- Avance-dashboard i Oversigt: denne + forrige måneds omsætning/kostpris/bruttoavance fra afsendte salgsordrer
- Enhedsnavn i historik: felt i Historik-fanen (localStorage `lager_device_name`) — sendes automatisk med alle `logMovement`-kald (device-kolonne i Historik-arket)
- Cmd+K/Ctrl+K kommandopalette: søg på tværs af varer, salgsordrer, indkøbsordrer, forsendelser og faner + handlinger (ny ordre/vare/forsendelse, genbestil alt, rapporter m.m.)
- Kundekartotek: autocomplete på kundenavn i salgsordre-modalen; tomme adressefelter udfyldes fra kundens seneste ordre (`fillCustomerFromHistory`)
- SO-tabel: søgefelt + statusfilter-chips; klik på status-badge åbner menu (`openSOStatusMenu`/`setSOStatus` — "afsendt" kører guarded lagertræk)
- Plukliste: "✓ Færdigplukket"-knap sætter ordren til pakket
- "Bestil snart"-kortet har "⚡ Opret PO"-knapper pr. leverandør (`createDynPO` — fylder op til dynamisk punkt, moq-afrundet)
- Vare-modal viser seneste 5 bevægelser (`renderItemMovements`) udover lagerprognosen
- Leverandør-scorecard: "Ø faktisk: Xd · lovet Yd" beregnet fra modtagne PO'er (oprettet → modtaget)
- Lagerværdi over tid: Lagervaerdi-ark med snapshots (automatisk ved ugentlig backup + manuel 📸-knap); SVG-graf i Oversigt (`getLagervaerdi`/`snapshotLagervaerdi`)
- Stikords-søgning overalt (`wordMatch`): alle søgeord skal matche, men i vilkårlig rækkefølge — gælder varer, Cmd+K, salgsordrer, historik, pakkeindhold og PO-varesøgning
- Kunde-side: klik på kundenavn i SO-tabellen → modal med ordrehistorik, totalomsætning og stamdata (`openCustomerModal`)
- Batch-plukning: "📋 Saml plukliste" aggregerer alle ny/pluk-ordrers linjer pr. vare med ordre-referencer, grupperet efter rum; footer-knap markerer alle som pakket
- Faktura-print pr. salgsordre ("🧾 Faktura"-knap i redigeringsmodalen — priser, subtotal ekskl. moms, moms 25%, total)
- Scan-modtagelse: "📷 Scan modtagelse" i Indkøbsordrer — scan stregkode → matcher åben PO-linje → modtag med lager+historik+PO-status (auto-lukker PO når alt er modtaget)
- Sæsonoverblik i Rapporter: 12 måneders udgående enheder som søjlediagram + top 5 varer (henter fuld historik, limit 10000)
- Systemstatus (via Cmd+K): API-svartider, seneste backup/lagerværdi-snapshot, betroede enheder (`getSystemStatus` i lager-script, `getTrustInfo` i ship-script)
- Offline-kø: fejlede skrive-kald (netværksfejl) køes i localStorage og synkes automatisk når forbindelsen er tilbage; ⏳-badge i topbaren viser antal ventende
- Returflow: markeres en forsendelse "Returneret" tilbydes at lægge pakkeindholdet tilbage på lager (guard: localStorage-flag + historik-note "Retur fra forsendelse X")
- Dynamisk genbestillingspunkt: "⏳ Bestil snart"-kort i Oversigt (forbrug/dag × leveringstid × 1.2) + ✦ Auto-knap ved min-beholdning i vare-modalen
- Historik hentes automatisk i baggrunden efter login (ABC/dødt lager/advarsler virker uden at besøge Historik-fanen)
- Dødt lager-kort i Oversigt (varer uden afgang i 90+ dage, med bundet værdi)
- sesu.dk prisalarm (kort i Oversigt ved pris-/lagerændringer på matchede varer)
- Konkurrent-prisovervågning: `getCompetitorPrices` i ship-scriptet scraper konkurrent-webshops (kun GET, 6t cache). To WooCommerce-parsere — `parseWooDataLayer` (JSON-datalag i `<li class="product">`, fx planke-bord.dk) og `parseWooMart` (WoodMart-tema uden datalag, fx likehome.dk). Nye konkurrenter tilføjes i `COMPETITORS`-arrayet (id, name, parser, urls). Frontend: `loadCompetitorPrices`/`findCompetitorMatches` (farve- og kategori-bevidst matching via `wordScore`+`colorsCompatible` — konkurrenter der kun fører sort matcher ikke hvide/messing-varer), `renderCompetitorCard` (Konkurrentpriser-kort i Oversigt: din pris vs. billigste konkurrent + snapshot-baseret pris/lager-ændringsalarm i `lager_competitor_snapshot`/`lager_competitor_changes`)
- Ugentlig backup: `weeklyBackup()` i lager-script dumper alle ark som JSON til Drive-mappen "Lager Backups" (12 nyeste beholdes). **Kræver engangs-opsætning:** kør `setupBackupTrigger()` manuelt i Apps Script-editoren og godkend Drive-adgang
- TOTP 2FA med Google Authenticator
- AI-lageranalyse via Claude (genbestillingsforslag m.m.)
- PWA (offline-shell via service worker)

---

## Kendte begrænsninger

- sesu.dk-scraping kan fejle hvis siden ændrer struktur
- Ingen multi-user support — ét delt token
- Backup-trigger skal aktiveres manuelt én gang (se ovenfor) før den kører automatisk
- Automatisk "leveret"-status fra Shipmondo er IKKE mulig via API'et: GET /shipments eksponerer ingen tracking-/leveringsstatus (verificeret i deres OpenAPI-spec juli 2026; `delivery_details` er kun ønsket leveringsdato). Ville kræve webhooks konfigureret i Shipmondo-admin
