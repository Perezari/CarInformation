// ─── Recent searches (localStorage) ──────────────────────────
const HISTORY_KEY = 'car_search_history';
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function addToHistory(plate, label, logoUrl, snapshot) {
  let h = getHistory().filter(x => x.plate !== plate);
  h.unshift({ plate, label, logo: logoUrl || '', snapshot: snapshot || null });
  if (h.length > 5) h = h.slice(0,5);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  renderHistory();
}
function removeFromHistory(plate) {
  const h = getHistory().filter(x => x.plate !== plate);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  renderHistory();
}
function updateHistorySnapshot(plate, partial) {
  const h = getHistory();
  const idx = h.findIndex(x => x.plate === plate);
  if (idx < 0) return;
  h[idx].snapshot = { ...(h[idx].snapshot || {}), ...partial };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}
function renderHistory() {
  const h = getHistory();
  const wrap = document.getElementById('recentWrap');
  const chips = document.getElementById('recentChips');
  if (!h.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  chips.innerHTML = h.map(x => `
    <span class="recent-chip" onclick="loadFromHistory('${x.plate}')">
      ${x.logo
        ? `<img src="${x.logo}" class="chip-logo" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<i class=\\'fa-solid fa-car chip-car-icon\\'></i>')">`
        : `<i class="fa-solid fa-car chip-car-icon"></i>`}
      <span style="margin: 0 2px;">${x.label}</span>
      <span class="rm" onclick="event.stopPropagation();removeFromHistory('${x.plate}')">✕</span>
    </span>`).join('');
}
// ─── OTP Plate Input ─────────────────────────────────────────
const OTP_MIN = 7, OTP_MAX = 8;
let otpLen = 7; // default 7 cells, expands to 8

function buildOtpCells(count) {
  const box = document.getElementById('plateBoxes');
  box.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const cell = document.createElement('div');
    cell.className = 'otp-cell';
    cell.dataset.idx = i;
    box.appendChild(cell);
  }
}

function otpCells() { return document.querySelectorAll('#plateBoxes .otp-cell'); }

function syncOtpBoxes() {
  const raw = (document.getElementById('plateInput').value || '').replace(/\D/g,'');

  // Expand to 8 when 8th digit is entered, shrink to 7 only when fully cleared
  const needed = raw.length === 8 ? 8 : (raw.length === 0 ? 7 : otpLen);
  if (needed !== otpLen) {
    otpLen = needed;
    buildOtpCells(otpLen);
    // re-attach click listener
    document.getElementById('plateBoxes').addEventListener('click', focusPlateInput);
  }

  otpCells().forEach((cell, i) => {
    const ch = raw[i] || '';
    const hadValue = cell.textContent !== '';
    cell.textContent = ch;
    cell.classList.toggle('filled', !!ch);
    if (ch && !hadValue) {
      cell.classList.remove('pop');
      void cell.offsetWidth;
      cell.classList.add('pop');
    }
  });
  updateActiveCell(raw.length);
}

function updateActiveCell(len) {
  otpCells().forEach(c => c.classList.remove('active'));
  const cells = otpCells();
  const idx = Math.min(len, cells.length - 1);
  if (document.getElementById('plateInput') === document.activeElement) {
    cells[idx]?.classList.add('active');
  }
}

function focusPlateInput() { document.getElementById('plateInput').focus(); }
function otpFocus() { updateActiveCell((document.getElementById('plateInput').value||'').replace(/\D/g,'').length); }
function otpBlur()  { otpCells().forEach(c => c.classList.remove('active')); }

// Init default cells
buildOtpCells(otpLen);
document.getElementById('plateBoxes').addEventListener('click', focusPlateInput);

function loadFromHistory(plate) {
  document.getElementById('plateInput').value = plate;
  syncOtpBoxes();
  fetchCar();
}

// ─── Days countdown ───────────────────────────────────────────
function renderCountdown(dateStr) {
  const el = document.getElementById('dCountdown');
  if (!dateStr || !el) return;
  const d = new Date(dateStr), now = new Date();
  const diff = Math.round((d - now) / (1000*60*60*24));
  let cls, txt;
  if (diff < 0)       { cls='countdown-exp';  txt=`פג לפני ${Math.abs(diff)} ימים ⚠️`; }
  else if (diff < 60) { cls='countdown-warn'; txt=`${diff} ימים נותרו ⚠️`; }
  else                { cls='countdown-ok';   txt=`${diff} ימים נותרו ✓`; }
  el.innerHTML = `<span class="countdown-badge ${cls}">${txt}</span>`;
}

// ─── Copy plate ───────────────────────────────────────────────
function copyPlate() {
  const txt = document.getElementById('plateTxt').textContent;
  navigator.clipboard.writeText(txt).then(() => {
    const btn = event.currentTarget;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> הועתק!';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color=''; btn.style.borderColor=''; }, 1800);
  });
}

// ─── Vehicle History + Mileage ───────────────────────────────
// Real response structure (from Network tab):
// { Results: [{ Data: { mispar_manoa, kilometer_test_aharon, shinui_mivne_ind,
//   gapam_ind, shnui_zeva_ind, shinui_zmig_ind, rishum_rishon_dt,
//   mkoriut_nm, mispar_rechev }, Description, UrlName }], TotalResults }

const DG_ENDPOINT  = 'https://www.gov.il/he/api/DataGovProxy/GetDGResults';
const DG_TEMPLATE  = '76a0abf9-d45a-4040-924b-e2f5cefe2ae4';  // היסטוריית טסטים
const DG_TEMPLATE_OWNERSHIP = '146b975c-70b5-4fc3-995e-d4db2e7e2ca7'; // היסטוריית בעלויות
const LOCAL_PROXY  = '/gov-proxy';
const CORS_PROXY   = 'https://corsproxy.io/?';

const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

async function govFetch(payload) {
  if (IS_LOCAL) {
    const res = await fetch(LOCAL_PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  for (const proxyFn of CORS_PROXIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(proxyFn(DG_ENDPOINT), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const d = await res.json();
      if (d?.Results || d?.results || d?.TotalResults !== undefined) return d;
    } catch (_) {
      clearTimeout(timer);
      continue;
    }
  }
  throw new Error('all proxies failed');
}

const CKAN_HISTORY   = '56063a99-8a3e-4ff4-912e-5966c0279bad'; // היסטוריית טסטים + קילומטרז'

async function fetchTestHistory(plate) {
  const kmBody = document.getElementById('kmBody');
  kmBody.innerHTML = `<div class="km-loading"><span class="spin"><i class="fa-solid fa-circle-notch"></i></span> שולף נסועה ומידע היסטורי...</div>`;

  try {
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_HISTORY}&q=${plate}`;
    const res = await fetch(url);
    const d   = await res.json();
    if (!d.success) throw new Error('failed');
    const raw = d.result?.records?.find(r => String(r.mispar_rechev) === String(plate));
    if (!raw) throw new Error('not found');
    renderVehicleHistory([raw], plate);
    updateHealthFromHistory(raw);
    // Enrich base car data with km for timeline
    if (tlData.base) { tlData.base.c = { ...tlData.base.c, kilometer_test_aharon: raw.kilometer_test_aharon }; tryRenderTimeline(); }
  } catch (e) {
    kmBody.innerHTML = `<div class="km-no-data"><i class="fa-solid fa-database" style="color:var(--text-muted);font-size:1.3rem;display:block;margin-bottom:10px"></i>לא ניתן לשלוף נתוני נסועה כרגע.</div>`;
  }
}

function renderVehicleHistory(records, plate) {
  const kmBody = document.getElementById('kmBody');
  const r = records[0];

  // Real field names from gov.il response:
  // kilometer_test_aharon, mispar_manoa, rishum_rishon_dt, mkoriut_nm,
  // shnui_zeva_ind, shinui_zmig_ind, shinui_mivne_ind, gapam_ind
  const mileage     = r.kilometer_test_aharon ?? r.nsoah ?? r.km ?? null;
  if (mileage != null) updateHistorySnapshot(plate, { mileage: Number(mileage) });
  const engine      = r.mispar_manoa ?? null;
  const regDate     = r.rishum_rishon_dt ?? r.tariph_rischum ?? null;

  // Render mileage trajectory chart (actual vs expected)
  renderMileageTrajectory(mileage, regDate || tlData.base?.c?.moed_aliya_lakvish);

  // Update avg km/year insight chip
  const avg = avgKmPerYear(mileage, regDate || tlData.base?.c?.moed_aliya_lakvish);
  const cat = categorizeKmPerYear(avg);
  const avgChip = document.getElementById('chipAvgKm');
  if (avg && cat) {
    setHtml('qAvgKm', `${avg.toLocaleString('he-IL')} ק"מ <span class="km-cat-badge km-cat-${cat.cls}">${cat.label}</span>`);
    if (avgChip) avgChip.className = 'stat-chip ' + cat.cls;
    updateHistorySnapshot(plate, { avgKm: avg });
    tryRenderFuelCost(avg);
  } else {
    set('qAvgKm', '—');
    if (avgChip) avgChip.className = 'stat-chip';
  }
  const ownership   = r.mkoriut_nm ?? r.mekoriyut ?? null;
  const colorChange = r.shnui_zeva_ind  ?? r.shinuy_tzeva ?? null;
  const tireChange  = r.shinui_zmig_ind ?? r.shinuy_bemidot_tzmig ?? null;
  const structChange= r.shinui_mivne_ind ?? r.shinuy_mivne ?? null;
  const lpgAdded    = r.gapam_ind ?? r.hutaf_gpm ?? null;

  // Format helpers
  const fNum  = v => (v !== null && v !== undefined) ? Number(v).toLocaleString('he-IL') : '—';
  const fBool = v => v == null ? '—' : (Number(v) === 1
    ? `<span class="km-result-fail"><i class="fa-solid fa-circle-xmark"></i> כן</span>`
    : `<span class="km-result-ok"><i class="fa-solid fa-circle-check"></i> לא</span>`);

  // ── Big mileage hero ──
  const heroMileage = mileage && Number(mileage) > 0
    ? `<div style="display:flex; align-items:baseline; gap:8px; margin-bottom:20px; padding-bottom:18px; border-bottom:1px solid var(--border);">
         <span style="font-size:0.72rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.08em; align-self:center; flex-shrink:0;">נסועה בטסט אחרון</span>
         <span style="font-size:2.2rem; font-weight:900; color:var(--accent); direction:ltr; margin-right:auto;">${Number(mileage).toLocaleString('he-IL')}</span>
         <span style="font-size:0.9rem; color:var(--text-muted); font-weight:600;">ק"מ</span>
       </div>`
    : '';

  // ── Details grid ──
  const rows = [
    engine      !== null ? ['מספר מנוע',          `<span style="direction:ltr; display:inline-block; font-family:monospace; font-size:0.85rem;">${engine}</span>`] : null,
    regDate     !== null ? ['תאריך רישום',          fDate(regDate)] : null,
    ownership   !== null ? ['מקוריות / בעלות',      ownership] : null,
    colorChange !== null ? ['שינוי צבע',            fBool(colorChange)] : null,
    tireChange  !== null ? ['שינוי מידות צמיג',     fBool(tireChange)] : null,
    structChange!== null ? ['שינוי מבנה',           fBool(structChange)] : null,
    lpgAdded    !== null ? ['הוסף גפ"מ',            fBool(lpgAdded)] : null,
  ].filter(Boolean);

  const detailRows = rows.map(([label, val]) => `
    <div class="data-row">
      <span class="data-label">${label}</span>
      <span class="data-value">${val}</span>
    </div>`).join('');

  kmBody.innerHTML = heroMileage + (rows.length
    ? `<div style="margin-top:4px;">${detailRows}</div>`
    : '<div class="km-no-data" style="padding:8px 0;">לא נמצאו פרטים נוספים</div>');

  // Debug: show raw keys if nothing mapped
  if (!mileage && !engine && rows.length === 0) {
    const rawKeys = Object.keys(r).slice(0, 12).map(k => `${k}: ${r[k]}`).join('<br>');
    kmBody.innerHTML += `<details style="margin-top:12px; font-size:0.75rem; color:var(--text-muted)">
      <summary>שדות גולמיים (debug)</summary>
      <div style="margin-top:8px; line-height:1.8; direction:ltr;">${rawKeys}</div>
    </details>`;
  }
}

// ─── Ownership history ────────────────────────────────────────
const CKAN_OWNERSHIP = 'bb2355dc-9ec7-4f06-9c3f-3344672171da'; // היסטוריית בעלויות

async function fetchOwnershipHistory(plate) {
  const el = document.getElementById('ownershipBody');
  el.innerHTML = `<div class="km-loading"><span class="spin"><i class="fa-solid fa-circle-notch"></i></span> שולף היסטוריית בעלויות...</div>`;

  try {
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_OWNERSHIP}&q=${plate}&limit=50`;
    const res = await fetch(url);
    const d   = await res.json();
    if (!d.success) throw new Error('failed');
    const records = d.result?.records?.filter(r => String(r.mispar_rechev) === String(plate));
    if (!records?.length) throw new Error('not found');
    const total = records.length;
    renderOwnershipHistory(records, total, plate);
    updateHealthFromOwnership(total);
    tlData.owners = records; tryRenderTimeline();
  } catch (e) {
    el.innerHTML = `<div class="km-no-data"><i class="fa-solid fa-users-slash" style="color:var(--text-muted);font-size:1.3rem;display:block;margin-bottom:10px"></i>לא נמצאו נתוני בעלויות.</div>`;
  }
}

function renderOwnershipHistory(records, total, plate) {
  const el = document.getElementById('ownershipBody');
  updateHistorySnapshot(plate, { owners: total });

  // CKAN structure: flat records with {mispar_rechev, baalut, baalut_dt, _id}
  // baalut_dt is numeric: 202211 = 11/2022
  const ownerCount = total;
  const ownerColor = ownerCount <= 1 ? 'var(--green)' : ownerCount <= 3 ? 'var(--accent)' : 'var(--red)';
  const ownerLabel = ownerCount === 1 ? 'יד ראשונה 🏆' : `עבר ${ownerCount} ידיים`;

  let html = `
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px; padding-bottom:18px; border-bottom:1px solid var(--border);">
      <div style="text-align:center; flex-shrink:0;">
        <div style="font-size:2.8rem; font-weight:900; color:${ownerColor}; line-height:1;">${ownerCount}</div>
        <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.08em; margin-top:2px;">ידיים</div>
      </div>
      <div>
        <div style="font-size:1rem; font-weight:800; color:var(--text);">${ownerLabel}</div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">לפי רישומי משרד התחבורה</div>
      </div>
    </div>`;

  const rows = records.map((r, i) => {
    const baalut = r.baalut ?? '—';
    const rawDt  = String(r.baalut_dt ?? '');
    const date   = rawDt.length >= 6
      ? `${rawDt.slice(4,6)}/${rawDt.slice(0,4)}`
      : (rawDt || '—');
    return `
      <div class="data-row">
        <span class="data-label" style="display:flex;align-items:center;gap:7px;">
          <span style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;flex-shrink:0;">${i+1}</span>
          ${baalut}
        </span>
        <span class="data-value" style="color:var(--text-dim);">${date}</span>
      </div>`;
  }).join('');

  html += `<div>${rows}</div>`;
  el.innerHTML = html;
}

// ─── Recalls (open / not performed) ──────────────────────────
const CKAN_RECALL = '36bf1404-0be4-49d2-82dc-2f1ead4a8b93';

async function fetchRecalls(plate) {
  const el = document.getElementById('recallBody');
  el.innerHTML = `<div class="km-loading"><span class="spin"><i class="fa-solid fa-circle-notch"></i></span> בודק ריקולים פתוחים...</div>`;

  try {
    // Server-side exact match by plate number (more reliable than full-text q=)
    const filters = encodeURIComponent(JSON.stringify({ MISPAR_RECHEV: Number(plate) }));
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_RECALL}&filters=${filters}&limit=200`;
    const res = await fetch(url);
    const d   = await res.json();
    if (!d.success) throw new Error('failed');

    let records = d.result?.records ?? [];
    records.sort((a, b) => (b.TAARICH_PTICHA || '').localeCompare(a.TAARICH_PTICHA || ''));

    renderRecalls(records);
    updateHealthFromRecalls(records.length);
    updateHistorySnapshot(plate, { recalls: records.length });
    tlData.recalls = records; tryRenderTimeline();
  } catch (e) {
    el.innerHTML = `<div class="km-no-data">לא ניתן לשלוף נתוני ריקול כרגע.</div>`;
    updateHealthFromRecalls(0);
  }
}

function renderRecalls(records) {
  const el = document.getElementById('recallBody');

  if (!records.length) {
    el.innerHTML = `<div class="km-no-data" style="color:var(--green)">
      <i class="fa-solid fa-circle-check" style="font-size:1.4rem;display:block;margin-bottom:10px"></i>
      לא נמצאו ריקולים פתוחים לרכב זה ✓</div>`;
    return;
  }

  const rows = records.map(r => {
    const type     = r.SUG_RECALL    || 'קריאת שירות';
    const category = r.SUG_TAKALA    || '';
    const desc     = r.TEUR_TAKALA   || '';
    const date     = r.TAARICH_PTICHA ? fDate(r.TAARICH_PTICHA) : '';
    const recallId = r.RECALL_ID     || '';

    return `<div style="padding:14px 0; border-bottom:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
        <span style="font-size:0.88rem;font-weight:700;color:var(--red);">${type}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          ${date ? `<span style="font-size:0.72rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:6px;padding:2px 8px;color:var(--red);white-space:nowrap;">${date}</span>` : ''}
          ${recallId ? `<span style="font-size:0.72rem;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:6px;padding:2px 8px;color:var(--text-muted);">#${recallId}</span>` : ''}
        </div>
      </div>
      ${category ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;font-weight:600;">${category}</div>` : ''}
      ${desc     ? `<div style="font-size:0.82rem;color:var(--text-dim);line-height:1.6;">${desc}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="margin-bottom:16px;padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;display:flex;align-items:center;gap:10px;">
      <i class="fa-solid fa-circle-exclamation" style="color:var(--red);font-size:1.1rem;flex-shrink:0;"></i>
      <span style="font-size:0.88rem;font-weight:700;color:var(--red);">⚠️ נמצאו ${records.length} ריקולים שלא בוצעו לרכב זה</span>
    </div>
    <div>${rows}</div>`;
}

// ─── Importer price + estimated current value ────────────────
const CKAN_IMPORTER = '39f455bf-6db0-4926-859d-017f34eacbcb';

// Israeli used-car depreciation curve, calibrated against the gov.il
// "מחירון משרד התחבורה" calculator on real cars:
//   CX-5 2022 (4 yrs): gov.il ₪124k vs ours ₪124k → 71% retention
//   CX-5 2014 (12 yrs): gov.il ₪47k vs ours ₪47k → 28% retention
// Depreciation gets steeper from year 6 onwards (model becomes "old").
function estimateCurrentValue(originalPrice, year, kmTotal, ownerCount) {
  if (!originalPrice || !year) return null;
  const age = new Date().getFullYear() - Number(year);
  if (age < 0) return null;

  let value = Number(originalPrice);
  for (let i = 1; i <= age; i++) {
    let rate;
    if (i === 1)      rate = 0.110;  // year 1 initial drop
    else if (i <= 5)  rate = 0.073;  // years 2-5 — calibrated against gov.il
    else if (i <= 10) rate = 0.105;  // years 6-10 — aging model
    else              rate = 0.140;  // years 11+ — accelerating end-of-life
    value *= (1 - rate);
  }

  // Mileage adjustment vs Israeli avg of 15k/yr
  if (kmTotal && age > 0) {
    const avgKm = Number(kmTotal) / age;
    if      (avgKm > 20000) value *= 0.92;
    else if (avgKm > 15000) value *= 0.96;
    else if (avgKm < 8000)  value *= 1.03;
  }
  // Ownership adjustment
  if (ownerCount > 4)       value *= 0.92;
  else if (ownerCount >= 2) value *= 0.97;

  const mid = Math.round(value / 100) * 100;
  return {
    mid,
    low:  Math.round(mid * 0.93 / 100) * 100,
    high: Math.round(mid * 1.07 / 100) * 100,
  };
}

async function fetchImporterPrice(tozeret_cd, degem_cd, year) {
  const sec = document.getElementById('priceSection');
  if (sec) sec.style.display = 'none';
  if (!tozeret_cd || !degem_cd) return;
  try {
    const filters = encodeURIComponent(JSON.stringify({
      tozeret_cd: Number(tozeret_cd),
      degem_cd:   Number(degem_cd),
      ...(year ? { shnat_yitzur: Number(year) } : {}),
    }));
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_IMPORTER}&filters=${filters}&limit=5`;
    const res = await fetch(url);
    const d   = await res.json();
    if (!d.success) return;
    const recs = d.result?.records || [];
    const exact = recs.find(r => String(r.shnat_yitzur) === String(year)) || recs[0];
    if (exact) renderImporterPrice(exact);
  } catch (_) {}
}

function renderImporterPrice(rec) {
  const sec  = document.getElementById('priceSection');
  const body = document.getElementById('priceBody');
  if (!sec || !body) return;

  const price    = Number(rec.mehir);
  const importer = (rec.shem_yevuan || '').trim();
  if (!price && !importer) return;

  // Pull current car details for the depreciation calc
  const plate = document.getElementById('stolenRaw')?.value;
  const snap  = getHistory().find(x => x.plate === plate)?.snapshot || {};
  const km    = snap.mileage || null;
  const owners = snap.owners || null;
  const year  = rec.shnat_yitzur || snap.year || null;
  const est   = price ? estimateCurrentValue(price, year, km, owners) : null;

  let html = '';
  if (price && importer) {
    html += `
      <div class="price-grid">
        <div class="price-cell">
          <div class="price-cell-val">₪${price.toLocaleString('he-IL')}</div>
          <div class="price-cell-lbl">מחיר חדש מקורי</div>
        </div>
        <div class="price-cell">
          <div class="price-cell-val price-importer">${importer}</div>
          <div class="price-cell-lbl">יבואן רשמי</div>
        </div>
      </div>`;
  } else if (price) {
    html += `
      <div class="price-cell" style="text-align:center; padding-bottom:14px; border-bottom:1px solid var(--border); margin-bottom:14px;">
        <div class="price-cell-val">₪${price.toLocaleString('he-IL')}</div>
        <div class="price-cell-lbl">מחיר חדש מקורי</div>
      </div>`;
  } else if (importer) {
    html += `
      <div class="price-cell" style="text-align:center; padding-bottom:14px; border-bottom:1px solid var(--border); margin-bottom:14px;">
        <div class="price-cell-val price-importer">${importer}</div>
        <div class="price-cell-lbl">יבואן רשמי</div>
      </div>`;
  }

  if (est && price) {
    const dropPct = Math.round((1 - est.mid / price) * 100);
    html += `
      <div class="price-est">
        <div class="price-est-row">
          <span class="price-est-lbl">ערך משוער היום</span>
          <span class="price-est-val">~₪${est.mid.toLocaleString('he-IL')}</span>
        </div>
        <div class="price-est-range">טווח: ₪${est.low.toLocaleString('he-IL')} – ₪${est.high.toLocaleString('he-IL')}</div>
        <div class="price-est-drop">ירידה של ${dropPct}% מהמחיר המקורי</div>
      </div>`;
  }

  html += `
    <div class="price-note">
      <i class="fa-solid fa-circle-info"></i>
      ההערכה מבוססת על עקומת ירידת ערך ממוצעת + תיקונים לפי ק"מ ובעלים. אינה תחליף לחוו"ד שמאי.
    </div>`;

  body.innerHTML = html;
  sec.style.display = 'block';
}

// ─── Population comparison: same year + model ────────────────
const ISRAELI_AVG_KM_PER_YEAR = 15000;

// Map Hebrew color names from gov.il registry to display swatches
const HEB_COLOR_HEX = {
  'לבן':       '#f5f5f5',
  'שנהב לבן':  '#f5efd7',
  'שמנת':      '#fff8dc',
  "בז'":       '#d4b996',
  'בז':        '#d4b996',
  'שחור':      '#1a1a1a',
  'כסף':       '#c0c0c0',
  'כסוף':      '#c0c0c0',
  'כסוף כהה':  '#9a9a9a',
  'אפור':      '#808080',
  'אפור כהה':  '#5a5a5a',
  'אפור בהיר': '#b8b8b8',
  'כחול':      '#1e3a8a',
  'כחול כהה':  '#0c1f5c',
  'כחול בהיר': '#3b82f6',
  'תכלת':      '#7dd3fc',
  'אדום':      '#dc2626',
  'אדום כהה':  '#991b1b',
  'בורדו':     '#7f1d1d',
  'ירוק':      '#16a34a',
  'ירוק כהה':  '#166534',
  'זית':       '#7c8a3b',
  'צהוב':      '#facc15',
  'זהב':       '#d4af37',
  'חום':       '#7c2d12',
  'חום כהה':   '#451a03',
  'ברונזה':    '#a16207',
  'כתום':      '#ea580c',
  'תפוז':      '#fb923c',
  'ורוד':      '#ec4899',
  'סגול':      '#9333ea',
};
function colorNameToHex(name) {
  if (!name) return null;
  const n = name.trim();
  if (HEB_COLOR_HEX[n]) return HEB_COLOR_HEX[n];
  // longest-prefix fallback for compounds like "כחול מטאלי"
  let best = null;
  for (const key of Object.keys(HEB_COLOR_HEX)) {
    if (n.includes(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? HEB_COLOR_HEX[best] : null;
}

async function fetchModelPopulation(tozeret_cd, degem_cd, year) {
  const sec = document.getElementById('popSection');
  if (sec) sec.style.display = 'none';
  if (!tozeret_cd || !degem_cd || !year) return;

  try {
    const filters = encodeURIComponent(JSON.stringify({
      tozeret_cd: Number(tozeret_cd),
      degem_cd:   Number(degem_cd),
      shnat_yitzur: Number(year),
    }));
    const base = `https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&filters=${filters}`;

    // Fetch full population (CKAN returns up to limit per request; paginate if needed)
    const PAGE = 10000;
    let offset = 0, total = 0, records = [];
    while (true) {
      const res = await fetch(`${base}&limit=${PAGE}&offset=${offset}`);
      const d   = await res.json();
      if (!d.success) break;
      total = d.result?.total || 0;
      const page = d.result?.records || [];
      records = records.concat(page);
      offset += page.length;
      if (page.length < PAGE || offset >= total) break;
    }
    if (total < 5) return; // not enough to be meaningful
    renderModelPopulation(records, total);
  } catch (_) {}
}

function renderModelPopulation(records, total) {
  const sec  = document.getElementById('popSection');
  const body = document.getElementById('popBody');
  if (!sec || !body) return;

  // Aggregate colors / trims / ownership
  const tally = (key) => {
    const map = new Map();
    for (const r of records) {
      const v = (r[key] || '').toString().trim();
      if (!v) continue;
      map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  const sample  = records.length;
  const colors  = tally('tzeva_rechev').slice(0, 5);
  const trims   = tally('ramat_gimur').slice(0, 5);
  const owners  = tally('baalut').slice(0, 4);

  // Highlight the user's car attributes
  const userColor = document.getElementById('qColor')?.textContent?.trim();
  const userTrim  = document.getElementById('carTrim')?.textContent?.trim();

  const bar = ([label, n], userVal, swatchHex) => {
    const pct = Math.round(n / sample * 100);
    const isUser = userVal && label === userVal;
    // Dot lives in its own grid cell so dots line up vertically across rows;
    // for rows without a swatch (trims/owners) we render a transparent placeholder.
    const dotStyle = swatchHex
      ? `background:${swatchHex}`
      : 'background:transparent;border-color:transparent';
    return `
      <div class="pop-bar ${isUser ? 'pop-bar-user' : ''} ${swatchHex ? '' : 'pop-bar-no-dot'}">
        <span class="pop-color-dot" style="${dotStyle}"></span>
        <div class="pop-bar-label">${label}${isUser ? ' <i class="fa-solid fa-circle-user" title="הרכב שלך"></i>' : ''}</div>
        <div class="pop-bar-track"><div class="pop-bar-fill" style="width:${pct}%"></div></div>
        <div class="pop-bar-pct">${pct}%</div>
      </div>`;
  };

  body.innerHTML = `
    <div class="pop-summary">
      <div class="pop-count">${total.toLocaleString('he-IL')}</div>
      <div class="pop-count-lbl">רכבים מאותו דגם ושנת ייצור פעילים כיום במאגר</div>
    </div>
    ${colors.length ? `
      <div class="pop-block">
        <div class="pop-block-title">צבעים נפוצים</div>
        <div class="pop-bars">${colors.map(c => bar(c, userColor, colorNameToHex(c[0]))).join('')}</div>
      </div>` : ''}
    ${trims.length > 1 ? `
      <div class="pop-block">
        <div class="pop-block-title">רמות גימור נפוצות</div>
        <div class="pop-bars">${trims.map(t => bar(t, userTrim)).join('')}</div>
      </div>` : ''}
    ${owners.length ? `
      <div class="pop-block">
        <div class="pop-block-title">סוגי בעלות</div>
        <div class="pop-bars">${owners.map(o => bar(o, '')).join('')}</div>
      </div>` : ''}
    <div class="pop-note"><i class="fa-solid fa-circle-info"></i> מבוסס על כל הרכבים הפעילים כיום ברישום (לא כולל רכבים שהורדו מהכביש)</div>
  `;
  sec.style.display = 'block';
}

// ─── Mileage trajectory chart (actual vs expected) ───────────
function renderMileageTrajectory(actualKm, regDateStr) {
  const wrap = document.getElementById('mileageTrajectory');
  if (!wrap) return;
  const km   = Number(actualKm);
  const reg  = new Date(regDateStr);
  if (!km || isNaN(reg)) { wrap.innerHTML = ''; return; }

  const yearsOnRoad = (Date.now() - reg) / (365.25 * 24 * 3600 * 1000);
  if (yearsOnRoad < 0.3) { wrap.innerHTML = ''; return; }

  const expected = Math.round(yearsOnRoad * ISRAELI_AVG_KM_PER_YEAR);
  const pct = Math.round((km - expected) / expected * 100);
  const verdictCls = pct > 10 ? 'red' : pct < -10 ? 'green' : 'accent';
  const verdictTxt = pct > 10
    ? `${pct}% מעל הממוצע — נסועה גבוהה`
    : pct < -10
      ? `${Math.abs(pct)}% מתחת לממוצע — נסועה נמוכה`
      : `קרוב לממוצע (${pct >= 0 ? '+' : ''}${pct}%)`;

  // Two horizontal bars on a shared scale (max value = 100%)
  const max = Math.max(km, expected);
  const expWidth = (expected / max) * 100;
  const actWidth = (km       / max) * 100;
  const yearsTxt = yearsOnRoad < 1
    ? `${Math.round(yearsOnRoad * 12)} חודשים`
    : `${yearsOnRoad.toFixed(1)} שנים`;

  wrap.innerHTML = `
    <div class="mile-traj-card">
      <div class="mile-traj-head">
        <div class="mile-traj-title"><i class="fa-solid fa-route"></i> מסלול נסועה לעומת הממוצע</div>
        <div class="mile-traj-verdict mile-${verdictCls}">${verdictTxt}</div>
      </div>
      <div class="mile-bars">
        <div class="mile-bar-row">
          <div class="mile-bar-label">ממוצע צפוי</div>
          <div class="mile-bar-track">
            <div class="mile-bar-fill mile-bar-exp" style="width:${expWidth.toFixed(1)}%"></div>
          </div>
          <div class="mile-bar-val">${expected.toLocaleString('he-IL')} ק"מ</div>
        </div>
        <div class="mile-bar-row">
          <div class="mile-bar-label">בפועל</div>
          <div class="mile-bar-track">
            <div class="mile-bar-fill mile-bar-act" style="width:${actWidth.toFixed(1)}%"></div>
          </div>
          <div class="mile-bar-val">${km.toLocaleString('he-IL')} ק"מ</div>
        </div>
      </div>
      <div class="mile-traj-foot">
        <i class="fa-solid fa-circle-info"></i>
        בהנחת ${ISRAELI_AVG_KM_PER_YEAR.toLocaleString('he-IL')} ק"מ/שנה לאורך ${yearsTxt} על הכביש
      </div>
    </div>`;
}

// ─── Vehicle specs (environment + safety + tech + comfort) ───
const CKAN_VEHICLE_SPECS = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';

// Cached so renderVehicleHistory can compute fuel cost when km arrives later
let _currentSpecs = null;

// Israeli fuel prices (NIS/L, 2024 approximate — update annually)
const FUEL_PRICE_NIS = { petrol: 7.5, diesel: 7.0 };

function estimateAnnualFuelCost(specs, avgKmPerYear) {
  if (!specs || !avgKmPerYear) return null;
  const co2 = Number(specs.CO2_WLTP || specs.kamut_CO2);
  if (!co2 || co2 <= 0) return null;
  const fuelType = (specs.delek_nm || '').toString();
  if (/חשמל/.test(fuelType)) return null; // EVs don't burn fuel
  const isDiesel = /דיזל|סולר/.test(fuelType);
  // Approximate: petrol L/100km ≈ CO2 / 23.2, diesel ≈ CO2 / 26.5
  const lPer100 = isDiesel ? co2 / 26.5 : co2 / 23.2;
  const price = isDiesel ? FUEL_PRICE_NIS.diesel : FUEL_PRICE_NIS.petrol;
  return Math.round((avgKmPerYear / 100) * lPer100 * price);
}

function tryRenderFuelCost(avgKm) {
  if (!_currentSpecs) return;
  const km = avgKm || (() => {
    const plate = document.getElementById('stolenRaw')?.value;
    return getHistory().find(x => x.plate === plate)?.snapshot?.avgKm;
  })();
  const cost = estimateAnnualFuelCost(_currentSpecs, km);
  const row = document.getElementById('rowFuelCost');
  if (cost && row) {
    row.querySelector('.data-value').textContent = `₪${cost.toLocaleString('he-IL')}`;
    row.style.display = '';
  } else if (row) {
    row.style.display = 'none';
  }
}

async function fetchVehicleSpecs(tozeret_cd, degem_cd, year) {
  _currentSpecs = null;
  const envSection     = document.getElementById('envSection');
  const safetySection  = document.getElementById('safetySection');
  const comfortSection = document.getElementById('comfortSection');
  const techExtras     = document.getElementById('techExtraRows');
  if (envSection)     envSection.style.display     = 'none';
  if (safetySection)  safetySection.style.display  = 'none';
  if (comfortSection) comfortSection.style.display = 'none';
  if (techExtras)     techExtras.innerHTML         = '';
  if (!tozeret_cd || !degem_cd) return;

  try {
    const q = `${tozeret_cd} ${degem_cd} ${year || ''}`.trim();
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_VEHICLE_SPECS}&q=${encodeURIComponent(q)}&limit=20`;
    const res = await fetch(url);
    const d   = await res.json();
    if (!d.success) return;

    const records = d.result?.records || [];
    const exact = records.find(r =>
      String(r.tozeret_cd) === String(tozeret_cd) &&
      String(r.degem_cd)   === String(degem_cd) &&
      (!year || String(r.shnat_yitzur) === String(year))
    );
    const loose = records.find(r =>
      String(r.tozeret_cd) === String(tozeret_cd) &&
      String(r.degem_cd)   === String(degem_cd)
    );
    const match = exact || loose;
    if (match) renderVehicleSpecs(match);
  } catch (_) {}
}

function buildScale(min, max, current, lowIsGood) {
  const total = max - min + 1;
  const idx = Math.max(0, Math.min(total - 1, Math.round(Number(current)) - min));
  const arrowPos = ((idx + 0.5) / total) * 100;

  // Pollution: green on left (1) → red on right (15)
  // Safety:    red on left (0)   → green on right (8)
  const greenToRed = ['#0d7c3e','#2c8c47','#4a9d52','#69ad5e','#88be69','#a7ce75','#c5d97a','#dde080','#f0d566','#f4b94e','#ed9a3d','#e57b32','#dc5c2a','#cf3a25','#b51d20'];
  const redToGreen = ['#b51d20','#cf3a25','#ed9a3d','#f4b94e','#dde080','#88be69','#4a9d52','#2c8c47','#0d7c3e'];
  const palette = lowIsGood ? greenToRed : redToGreen;

  let cells = '';
  for (let i = 0; i < total; i++) {
    const color = palette[Math.round(i * (palette.length - 1) / Math.max(1, total - 1))];
    cells += `<div class="scale-cell" style="background:${color}">${min + i}</div>`;
  }
  return `
    <div class="scale-row">
      <div class="scale-arrow" style="left:${arrowPos}%"><i class="fa-solid fa-caret-down"></i></div>
      <div class="scale-cells">${cells}</div>
    </div>`;
}

function renderVehicleSpecs(s) {
  _currentSpecs = s;

  // ── Environment section (with emissions B) ──
  const envSection = document.getElementById('envSection');
  const envBody    = document.getElementById('envBody');
  if (envSection && envBody) {
    let html = '';
    if (s.madad_yarok != null) {
      html += `<div class="data-row"><span class="data-label">מדד ירוק</span><span class="data-value">${s.madad_yarok}</span></div>`;
    }
    if (s.kvutzat_zihum != null) {
      html += `
        <div class="data-row"><span class="data-label">קבוצת זיהום</span><span class="data-value">קבוצה ${s.kvutzat_zihum} מתוך 15</span></div>
        ${buildScale(1, 15, s.kvutzat_zihum, true)}`;
    }
    const tkina = (s.sug_tkina_nm || '').trim();
    if (tkina) {
      html += `<div class="data-row"><span class="data-label">סוג תקינה</span><span class="data-value">${tkina}</span></div>`;
    }
    const mamir = (s.sug_mamir_nm || '').trim();
    if (mamir && !/לא ידוע/.test(mamir)) {
      html += `<div class="data-row"><span class="data-label">סוג ממיר</span><span class="data-value">${mamir}</span></div>`;
    }
    // Emissions (B)
    const co2 = s.CO2_WLTP || s.kamut_CO2;
    if (co2 != null) {
      html += `<div class="data-row"><span class="data-label">פליטות CO₂</span><span class="data-value">${co2} גרם/ק"מ</span></div>`;
    }
    if (s.NOX_WLTP != null) {
      html += `<div class="data-row"><span class="data-label">פליטות NOₓ</span><span class="data-value">${s.NOX_WLTP} מ"ג/ק"מ</span></div>`;
    }
    if (s.PM_WLTP != null) {
      html += `<div class="data-row"><span class="data-label">פליטות חלקיקים PM</span><span class="data-value">${s.PM_WLTP} מ"ג/ק"מ</span></div>`;
    }
    if (html) {
      envBody.innerHTML = html;
      envSection.style.display = 'block';
    }
  }

  // ── Safety section ──
  const safetySection = document.getElementById('safetySection');
  const safetyBody    = document.getElementById('safetyBody');
  if (safetySection && safetyBody) {
    let html = '';
    if (s.ramat_eivzur_betihuty != null) {
      html += `<div class="data-row"><span class="data-label">רמת אבזור בטיחותי</span><span class="data-value">${s.ramat_eivzur_betihuty} מתוך 8</span></div>`;
      html += buildScale(0, 8, s.ramat_eivzur_betihuty, false);
    }

    const features = [
      ['zihuy_holchey_regel_ind',           'זיהוי הולכי רגל'],
      ['zihuy_tamrurey_tnua_ind',           'זיהוי תמרורי תנועה'],
      ['zihuy_rechev_do_galgali',           'זיהוי רכב דו-גלגלי'],
      ['bakarat_stiya_menativ_ind',         'בקרת סטייה מנתיב'],
      ['matzlemat_reverse_ind',             'מצלמת רוורס'],
      ['teura_automatit_benesiya_kadima_ind', 'תאורה אוטומטית קדמית'],
      ['shlita_automatit_beorot_gvohim_ind',  'שליטה באורות גבוהים'],
      ['nitur_merhak_milfanim_ind',         'ניטור מרחק מלפנים'],
      ['zihuy_beshetah_nistar_ind',         'זיהוי שטח מת'],
      ['bakarat_shyut_adaptivit_ind',       'בקרת שיוט אדפטיבית'],
      ['maarechet_ezer_labalam_ind',        'מערכת עזר לבלם'],
      ['blima_otomatit_nesia_leahor',       'בלימה אוטומטית בנסיעה לאחור'],
    ];
    const presentFeatures = features.filter(([k]) => s[k] != null);
    if (presentFeatures.length) {
      html += `<div class="safety-features">${presentFeatures.map(([k, label]) => {
        const has = Number(s[k]) === 1;
        const cls = has ? 'feat-yes' : 'feat-no';
        const icon = has ? 'fa-circle-check' : 'fa-circle-xmark';
        return `<div class="safety-feature ${cls}"><i class="fa-solid ${icon}"></i><span>${label}</span></div>`;
      }).join('')}</div>`;
    }

    if (html) {
      safetyBody.innerHTML = html;
      safetySection.style.display = 'block';
    }
  }

  // ── Technical extras (A) + Towing (C) + Fuel cost (F) ──
  const techExtras = document.getElementById('techExtraRows');
  if (techExtras) {
    const rows = [];
    const fmtNum  = v => (v != null && v !== '' && Number(v) !== 0) ? Number(v).toLocaleString('he-IL') : null;
    const yesNo   = v => Number(v) === 1 ? 'כן' : (v != null ? 'לא' : null);

    if (fmtNum(s.nefah_manoa))         rows.push(['נפח מנוע',         `${fmtNum(s.nefah_manoa)} סמ"ק`]);
    if (fmtNum(s.koah_sus))            rows.push(['כוח סוס',          `${fmtNum(s.koah_sus)} כ"ס`]);
    if (s.automatic_ind != null)       rows.push(['תיבת הילוכים',     Number(s.automatic_ind) === 1 ? 'אוטומטית' : 'ידנית']);
    const drive = (s.technologiat_hanaa_nm || '').trim();
    if (drive && !/לא ידוע/.test(drive) && drive !== 'הנעה רגילה')
                                       rows.push(['טכנולוגיית הנעה', drive]);
    const merkav = (s.merkav || '').trim();
    if (merkav && !/לא ידוע/.test(merkav)) rows.push(['מבנה',          merkav]);
    if (fmtNum(s.mispar_dlatot))       rows.push(['מספר דלתות',       fmtNum(s.mispar_dlatot)]);
    if (fmtNum(s.mispar_moshavim))     rows.push(['מספר מושבים',      fmtNum(s.mispar_moshavim)]);
    if (fmtNum(s.mispar_kariot_avir))  rows.push(['כריות אוויר',      fmtNum(s.mispar_kariot_avir)]);
    if (fmtNum(s.mishkal_kolel))       rows.push(['משקל כולל',        `${fmtNum(s.mishkal_kolel)} ק"ג`]);
    // Towing (C)
    if (fmtNum(s.kosher_grira_im_blamim))
                                       rows.push(['כושר גרירה (עם בלמים)',  `${fmtNum(s.kosher_grira_im_blamim)} ק"ג`]);
    if (fmtNum(s.kosher_grira_bli_blamim))
                                       rows.push(['כושר גרירה (ללא בלמים)', `${fmtNum(s.kosher_grira_bli_blamim)} ק"ג`]);

    let html = rows.map(([l, v]) =>
      `<div class="data-row"><span class="data-label">${l}</span><span class="data-value">${v}</span></div>`
    ).join('');
    // Fuel cost row (F) — rendered with placeholder; updated when avgKm is known
    html += `<div class="data-row" id="rowFuelCost" style="display:none">
      <span class="data-label">צריכת דלק שנתית משוערת</span>
      <span class="data-value">—</span>
    </div>`;
    techExtras.innerHTML = html;

    // Try computing fuel cost now (avgKm may already be in snapshot from prior session)
    tryRenderFuelCost();
  }

  // ── Comfort & equipment (E) ──
  const comfortSection = document.getElementById('comfortSection');
  const comfortBody    = document.getElementById('comfortBody');
  if (comfortSection && comfortBody) {
    const items = [
      ['mazgan_ind',                          'מזגן'],
      ['abs_ind',                             'מערכת ABS'],
      ['hege_koah_ind',                       'היגוי כוח'],
      ['bakarat_yatzivut_ind',                'בקרת יציבות'],
      ['galgaley_sagsoget_kala_ind',          'גלגלי סגסוגת'],
      ['halon_bagg_ind',                      'גג נפתח'],
      ['argaz_ind',                           'וו גרירה'],
      ['hayshaney_lahatz_avir_batzmigim_ind', 'חיישני לחץ אוויר בצמיגים'],
      ['hayshaney_hagorot_ind',               'חיישני חגורות בטיחות'],
      ['alco_lock',                           'נעילת אלכוהול'],
    ];
    const rows = items.filter(([k]) => s[k] != null);
    // Power windows: count > 0 means yes
    if (s.mispar_halonot_hashmal != null) {
      rows.push(['_powerWindows', `חלונות חשמל${Number(s.mispar_halonot_hashmal) > 0 ? ` (${s.mispar_halonot_hashmal})` : ''}`, Number(s.mispar_halonot_hashmal) > 0 ? 1 : 0]);
    }
    if (rows.length) {
      const html = rows.map(item => {
        const [k, label, presetVal] = item;
        const val = presetVal != null ? presetVal : s[k];
        const has = Number(val) === 1;
        const cls  = has ? 'feat-yes' : 'feat-no';
        const icon = has ? 'fa-circle-check' : 'fa-circle-xmark';
        return `<div class="safety-feature ${cls}"><i class="fa-solid ${icon}"></i><span>${label}</span></div>`;
      }).join('');
      comfortBody.innerHTML = `<div class="safety-features">${html}</div>`;
      comfortSection.style.display = 'block';
    }
  }
}

// ─── Off-road check ───────────────────────────────────────────
async function fetchOffRoad(plate, standalone = false) {
  const banner = document.getElementById('offRoadBanner');
  const details = document.getElementById('offRoadDetails');
  banner.style.display = 'none';

  try {
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=851ecab1-0622-4dbe-a6c7-f950cf82abf9&q=${plate}`;
    const res = await fetch(url);
    const d = await res.json();

    if (!d.success) return;
    const match = d.result?.records?.find(r => String(r.mispar_rechev) === String(plate));
    if (!match) return;

    const make  = match.tozeret_nm || '';
    const model = match.degem_nm   || '';
    details.textContent = (make || model ? `${make} ${model}`.trim() + ' — ' : '') + 'מופיע במאגר כלי רכב שירדו מהכביש (ביטול סופי)';
    banner.style.display = 'flex';

    // If main lookup failed, show banner standalone above search
    if (standalone) {
      banner.style.marginTop = '0';
      document.getElementById('resultCard').style.display = 'none';
      document.querySelector('.search-wrap').after(banner);
    }
  } catch (_) {}
}

function openRecallSite() {
  const plate = document.getElementById('stolenRaw')?.value || '';
  const btn = document.getElementById('recallBtnTxt');
  navigator.clipboard.writeText(plate).then(() => {
    if (btn) { btn.textContent = 'מספר הועתק — הדבק בחיפוש'; }
    setTimeout(() => { if (btn) btn.textContent = 'מלא ב-gov.il'; }, 2500);
  }).catch(() => {});
  window.open('https://data.gov.il/he/datasets/ministry_of_transport/hagbalat_recall/36bf1404-0be4-49d2-82dc-2f1ead4a8b93', '_blank');
}

// ─── Stolen car check ────────────────────────────────────────
function openStolenCheck() {
  const plate = document.getElementById('stolenRaw')?.value || '';
  const btn = event.currentTarget;

  navigator.clipboard.writeText(plate).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> מספר הועתק — הדבק בדף';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2500);
  }).catch(() => {});

  window.open('https://www.gov.il/apps/police/stolencar', '_blank');
}

// ─── Public vehicles (taxis / buses / share-taxis) ──────────
const CKAN_PUBLIC_VEHICLES = 'cf29862d-ca25-4691-84f6-1be60dcb4a1e';

// Map sug_rechev_cd → emoji + short label for the prominent badge
function publicVehicleType(cd, nm) {
  const code = Number(cd);
  if (code === 121)                  return { icon: '🚖', label: 'מונית' };
  if (code === 124)                  return { icon: '🚖', label: 'מונית נגישה' };
  if (code === 150)                  return { icon: '🚐', label: 'מונית-זוטובוס' };
  if ([622,623,624].includes(code))  return { icon: '🚐', label: nm || 'אוטובוס זעיר' };
  if (code === 650)                  return { icon: '🚌', label: 'טיולית' };
  if (code >= 611 && code <= 630)    return { icon: '🚌', label: nm || 'אוטובוס' };
  return { icon: '🚗', label: nm || 'רכב ציבורי' };
}

async function fetchPublicVehicle(plate) {
  try {
    const filters = encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plate) }));
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_PUBLIC_VEHICLES}&filters=${filters}&limit=1`;
    const res = await fetch(url);
    const d   = await res.json();
    if (d.success && d.result?.records?.length) return d.result.records[0];
  } catch (_) {}
  return null;
}

// ─── Utilities ───────────────────────────────────────────────
function fDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function fPlate(p) {
  p = String(p).replace(/\D/g,'');
  if (p.length === 7) return p.replace(/(\d{2})(\d{3})(\d{2})/,'$1-$2-$3');
  if (p.length === 8) return p.replace(/(\d{3})(\d{2})(\d{3})/,'$1-$2-$3');
  return p;
}
function set(id, v, fallback='—') {
  const el = document.getElementById(id);
  if (el) el.textContent = v || fallback;
}
function setHtml(id, v) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = v;
}
function statusMsg(html) { document.getElementById('statusMsg').innerHTML = html; }

// ─── License expiry color ─────────────────────────────────────
function licenseChip(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr), now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'red';
  if (diff < 60) return 'red';
  if (diff < 180) return 'accent';
  return 'green';
}

// ─── Computed insights ────────────────────────────────────────

// Annual license fee estimate by pollution group (NIS, 2024 approximate values
// from the Ministry of Transportation table for private vehicles).
// Real numbers may vary slightly; this is a buyer's-eye estimate.
const LICENSE_FEE_BY_POLLUTION = {
  1:  643, 2:  838, 3: 1031, 4: 1225, 5: 1418,
  6: 1612, 7: 1805, 8: 1999, 9: 2193, 10: 2386,
  11: 2580, 12: 2773, 13: 2967, 14: 3160, 15: 3354,
};

function parsePollutionGroup(s) {
  if (s == null) return null;
  const m = String(s).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function estimateLicenseFee(pollutionRaw, year) {
  const group = parsePollutionGroup(pollutionRaw);
  if (!group) return null;
  let fee = LICENSE_FEE_BY_POLLUTION[Math.min(15, Math.max(1, group))];
  if (!fee) return null;
  // Age discount: 10%/year starting at year 8, capped at 50%
  const carYear = parseInt(year, 10);
  if (carYear) {
    const age = new Date().getFullYear() - carYear;
    const discount = Math.min(0.5, Math.max(0, (age - 7) * 0.1));
    fee = Math.round(fee * (1 - discount));
  }
  return fee;
}

function avgKmPerYear(totalKm, regDateStr) {
  const km = Number(totalKm);
  if (!km || !regDateStr) return null;
  const regDate = new Date(regDateStr);
  if (isNaN(regDate)) return null;
  const years = (Date.now() - regDate) / (1000 * 60 * 60 * 24 * 365.25);
  if (years < 0.5) return null;
  return Math.round(km / years);
}

function categorizeKmPerYear(avg) {
  if (avg == null) return null;
  if (avg > 15000) return { label: 'גבוה',  cls: 'red' };
  if (avg >= 8000) return { label: 'ממוצע', cls: 'accent' };
  return                { label: 'נמוך',  cls: 'green' };
}

// ─── Brand logo ───────────────────────────────────────────────
const BRAND_MAP = {
  hyundai:'hyundai', toyota:'toyota', kia:'kia', honda:'honda',
  mazda:'mazda', nissan:'nissan', mitsubishi:'mitsubishi',
  volkswagen:'volkswagen', skoda:'skoda', seat:'seat', audi:'audi',
  bmw:'bmw', mercedes:'mercedes-benz', ford:'ford', opel:'opel',
  peugeot:'peugeot', renault:'renault', citroen:'citroen', fiat:'fiat',
  subaru:'subaru', suzuki:'suzuki', tesla:'tesla', volvo:'volvo',
  jeep:'jeep', dodge:'dodge', chevrolet:'chevrolet', lexus:'lexus',
  chrysler:'jeep', 'grand cherokee':'jeep', 'grand_cherokee':'jeep',
  infiniti:'infiniti', dacia:'dacia', seat:'seat', cupra:'cupra',
};
function loadBrandLogo(kinuyEn, tozetNm, engBrand) {
  const logo = document.getElementById('brandLogo');
  logo.style.display = 'none';
  const search = [kinuyEn, tozetNm, engBrand].filter(Boolean).join(' ').toLowerCase();
  const key = Object.keys(BRAND_MAP).find(k => search.includes(k));
  if (!key) return;
  logo.src = `https://cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset/logos/thumb/${BRAND_MAP[key]}.png`;
  logo.onload = () => { logo.style.display = 'block'; };
}

// ─── Health Score ─────────────────────────────────────────────
const healthData = { base: null, mileage: null, owners: null, recalls: null, changes: null };

// ─── Timeline data store ──────────────────────────────────────
const tlData = { base: null, owners: null, recalls: null };

function tryRenderTimeline() {
  if (!tlData.base) return;
  const { c } = tlData.base;
  const events = [];
  // Parse to LOCAL time so that owner-month and road-month dates compare equal
  // when they share the same year+month (UTC parsing of "YYYY-MM" was offsetting them)
  const fmtDt = s => {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };
  const fmt     = d => d ? d.toLocaleDateString('he-IL', { month:'2-digit', year:'numeric' }) : null;
  const fmtFull = d => d ? d.toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' }) : null;

  const ICONS = {
    'ev-birth':   'fa-solid fa-industry',
    'ev-road':    'fa-solid fa-road',
    'ev-owner':   'fa-solid fa-user',
    'ev-test':    'fa-solid fa-wrench',
    'ev-recall':  'fa-solid fa-triangle-exclamation',
    'ev-license': 'fa-solid fa-id-card',
    'ev-today':   'fa-solid fa-location-dot',
  };

  if (c.shnat_yitzur) events.push({ type:'ev-birth', date: new Date(c.shnat_yitzur, 0), label:'ייצור הרכב', sub: `שנת ${c.shnat_yitzur}` });

  const roadDate = fmtDt(c.moed_aliya_lakvish);
  if (roadDate) events.push({ type:'ev-road', date: roadDate, label:'עלייה לכביש', sub: fmt(roadDate) });

  if (tlData.owners) {
    tlData.owners.forEach((r, i) => {
      const rawDt = String(r.baalut_dt || '');
      if (rawDt.length >= 6) {
        const yr = parseInt(rawDt.slice(0,4)), mo = parseInt(rawDt.slice(4,6)) - 1;
        events.push({ type:'ev-owner', date: new Date(yr, mo), label: r.baalut || 'שינוי בעלות', sub: `${String(mo+1).padStart(2,'0')}/${yr}`, badge: `<span class="tl-badge tl-badge-owner">יד ${i+1}</span>` });
      }
    });
  }

  const testDate = fmtDt(c.mivchan_acharon_dt);
  if (testDate) {
    const km = c.kilometer_test_aharon ? Number(c.kilometer_test_aharon).toLocaleString('he-IL') + ' ק"מ' : '';
    events.push({ type:'ev-test', date: testDate, label:'טסט אחרון', sub: fmt(testDate), badge: km ? `<span class="tl-badge tl-badge-test">${km}</span>` : '' });
  }

  if (tlData.recalls) {
    tlData.recalls.forEach(r => {
      const d = fmtDt(r.TAARICH_PTICHA);
      if (d) events.push({ type:'ev-recall', date: d, label: r.SUG_TAKALA || 'ריקול פתוח', sub: fmt(d), badge: `<span class="tl-badge tl-badge-recall">#${r.RECALL_ID}</span>` });
    });
  }

  const licDate = fmtDt(c.tokef_dt);
  if (licDate) events.push({ type:'ev-license', date: licDate, label: licDate > new Date() ? 'תוקף רישיון' : 'רישיון פג תוקף', sub: fmt(licDate) });

  events.push({ type:'ev-today', date: new Date(), label:'היום', sub: fmtFull(new Date()) });
  // When dates tie (typical: road entry & first owner in the same month), order
  // events by their natural chronology in vehicle life
  const TYPE_ORDER = { 'ev-birth':1, 'ev-road':2, 'ev-owner':3, 'ev-test':4, 'ev-recall':5, 'ev-license':6, 'ev-today':7 };
  events.sort((a, b) => (a.date - b.date) || ((TYPE_ORDER[a.type]||9) - (TYPE_ORDER[b.type]||9)));

  const el = document.getElementById('timelineBody');
  if (!el) return;

  let lastYear = null;
  const rows = events.map(ev => {
    const yr = ev.date.getFullYear();
    const yearMark = yr !== lastYear ? `<div class="tl-year-label">${yr}</div>` : '';
    lastYear = yr;
    const metaParts = [];
    if (ev.badge) metaParts.push(ev.badge);
    if (ev.sub)   metaParts.push(`<span class="tl-sub">${ev.sub}</span>`);
    const metaRow = metaParts.length ? `<div class="tl-meta-row">${metaParts.join('')}</div>` : '';
    return `${yearMark}<div class="tl-event ${ev.type}">
      <div class="tl-icon"><i class="${ICONS[ev.type]}"></i></div>
      <div class="tl-content">
        <div class="tl-label">${ev.label}</div>
        ${metaRow}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="timeline">${rows}</div>`;
}

function initHealthScore(c) {
  const now = new Date();
  const year = Number(c.shnat_yitzur) || now.getFullYear();
  const age  = now.getFullYear() - year;

  let score = 100;
  const flags = [];

  // Age (-3 per year over 3, max -24)
  if (age > 3) { const pen = Math.min((age - 3) * 3, 24); score -= pen; }
  if (age >= 10) flags.push({ cls:'hf-red',    txt:`גיל ${age} שנה` });
  else if (age >= 6) flags.push({ cls:'hf-yellow', txt:`גיל ${age} שנה` });
  else flags.push({ cls:'hf-green', txt:`גיל ${age} שנה` });

  // License expired
  if (c.tokef_dt) {
    const diff = (new Date(c.tokef_dt) - now) / (1000*60*60*24);
    if (diff < 0)  { score -= 10; flags.push({ cls:'hf-red',    txt:'רישיון פג תוקף' }); }
    else if (diff < 60) flags.push({ cls:'hf-yellow', txt:'רישיון פג בקרוב' });
  }

  healthData.base = { score, flags };
  renderHealthScore();
}

function updateHealthFromHistory(r) {
  if (!r) return;
  const flags = [];
  let score = 0;

  // Mileage
  const km = Number(r.kilometer_test_aharon) || 0;
  if (km > 0) {
    if (km > 200000)     { score -= 15; flags.push({ cls:'hf-red',    txt:`${km.toLocaleString('he-IL')} ק"מ` }); }
    else if (km > 120000){ score -= 7;  flags.push({ cls:'hf-yellow', txt:`${km.toLocaleString('he-IL')} ק"מ` }); }
    else                 {              flags.push({ cls:'hf-green',  txt:`${km.toLocaleString('he-IL')} ק"מ` }); }
  }

  // Structure / color / LPG changes
  if (Number(r.shinui_mivne_ind) === 1) { score -= 15; flags.push({ cls:'hf-red',    txt:'שינוי מבנה' }); }
  if (Number(r.shnui_zeva_ind)   === 1) { score -= 5;  flags.push({ cls:'hf-yellow', txt:'שינוי צבע' }); }
  if (Number(r.gapam_ind)        === 1) { score -= 5;  flags.push({ cls:'hf-yellow', txt:'גפ"מ' }); }

  healthData.changes = { score, flags };
  renderHealthScore();
}

function updateHealthFromOwnership(count) {
  const flags = [];
  let score = 0;
  if (count === 1)     flags.push({ cls:'hf-green',  txt:'יד ראשונה' });
  else if (count === 2){ score -= 5;  flags.push({ cls:'hf-green',  txt:`${count} ידיים` }); }
  else if (count <= 4) { score -= 12; flags.push({ cls:'hf-yellow', txt:`${count} ידיים` }); }
  else                 { score -= 20; flags.push({ cls:'hf-red',    txt:`${count} ידיים` }); }
  healthData.owners = { score, flags };
  renderHealthScore();
}

function updateHealthFromRecalls(count) {
  const flags = [];
  let score = 0;
  if (count === 0) flags.push({ cls:'hf-green', txt:'אין ריקולים פתוחים' });
  else { score -= Math.min(count * 10, 20); flags.push({ cls:'hf-red', txt:`${count} ריקולים פתוחים` }); }
  healthData.recalls = { score, flags };
  renderHealthScore();
}

function renderHealthScore() {
  if (!healthData.base) return;

  let total = healthData.base.score
    + (healthData.changes?.score  || 0)
    + (healthData.owners?.score   || 0)
    + (healthData.recalls?.score  || 0);
  total = Math.max(0, Math.min(100, total));

  const allFlags = [
    ...(healthData.base.flags    || []),
    ...(healthData.changes?.flags || []),
    ...(healthData.owners?.flags  || []),
    ...(healthData.recalls?.flags || []),
  ];

  // Color
  const color = total >= 75 ? '#22c55e' : total >= 50 ? '#e8a825' : '#ef4444';

  // Verdict
  const verdict = total >= 80 ? '✅ מצב מצוין'
                : total >= 65 ? '👍 מצב טוב'
                : total >= 50 ? '⚠️ מצב סביר'
                : total >= 35 ? '🔶 מצב ירוד'
                : '🔴 מצב גרוע';

  // SVG arc
  const circumference = 188.5;
  const offset = circumference - (total / 100) * circumference;
  const arc = document.getElementById('healthArc');
  if (arc) { arc.style.strokeDashoffset = offset; arc.style.stroke = color; }

  const numEl = document.getElementById('healthNum');
  if (numEl) { numEl.textContent = total; numEl.style.color = color; }

  const verdictEl = document.getElementById('healthVerdict');
  if (verdictEl) { verdictEl.textContent = verdict; verdictEl.style.color = color; }

  const flagsEl = document.getElementById('healthFlags');
  if (flagsEl) flagsEl.innerHTML = allFlags.map(f =>
    `<span class="health-flag ${f.cls}">${f.txt}</span>`).join('');

  document.getElementById('healthWrap').style.display = 'flex';

  // Update history snapshot for compare feature
  const plate = document.getElementById('stolenRaw')?.value;
  if (plate) updateHistorySnapshot(plate, { health: total, verdict });
}

// ─── Main fetch ───────────────────────────────────────────────
async function fetchCar() {
  const raw = document.getElementById('plateInput').value.trim().replace(/-/g,'');
  if (!raw) return;

  statusMsg('<div class="status-loading"><span class="spin"><i class="fa-solid fa-circle-notch"></i></span> שולף נתונים...</div>');
  document.getElementById('resultCard').style.display = 'none';

  // Reset brand logo
  const logo = document.getElementById('brandLogo');
  logo.style.display = 'none';
  logo.src = '';

  // Reset cross-search UI state — sections we skip for some vehicle types must
  // not retain content from the previous search
  ['publicBadge', 'priceSection', 'offRoadBanner'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const kmSec = document.getElementById('kmSection');
  const ownSec = document.getElementById('ownershipSection');
  if (kmSec)  kmSec.style.display  = '';
  if (ownSec) ownSec.style.display = '';

  try {
    const apiUrl = `https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&q=${raw}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    let c, isPublic = false;
    if (data.success && data.result.records.length) {
      c = data.result.records[0];
    } else {
      // Fall back to public-vehicle registry (taxis / buses / share-taxis)
      const pub = await fetchPublicVehicle(raw);
      if (!pub) throw new Error('not found');
      isPublic = true;
      c = {
        mispar_rechev:    pub.mispar_rechev,
        tozeret_cd:       pub.tozeret_cd,
        tozeret_nm:       pub.tozeret_nm,
        degem_cd:         pub.degem_cd,
        degem_nm:         pub.degem_nm,
        shnat_yitzur:     pub.shnat_yitzur,
        tzeva_cd:         pub.tzeva_cd,
        tzeva_rechev:     pub.tzeva_rechev,
        tokef_dt:         pub.tokef_dt,
        // Don't fall back to degem_nm so we don't show identical model+kinuy rows
        kinuy_mishari:    pub.kinuy_mishari || null,
        // Public vehicles don't have a trim concept — leave empty
        ramat_gimur:      null,
        baalut:           'ציבורי',
        _isPublic:        true,
        _publicType:      { cd: pub.sug_rechev_cd, nm: pub.sug_rechev_nm },
        _seats:           pub.mispar_mekomot,
        _seatsNextDriver: pub.mispar_mekomot_leyd_nahag,
        _totalWeight:     pub.mishkal_kolel,
      };

      // Show the public badge + hide private-only sections
      const pubBadge = document.getElementById('publicBadge');
      if (pubBadge) {
        const t = publicVehicleType(c._publicType.cd, c._publicType.nm);
        pubBadge.innerHTML = `<span>${t.icon}</span><span>${t.label}</span>`;
        pubBadge.style.display = 'inline-flex';
      }
      if (kmSec)  kmSec.style.display  = 'none';
      if (ownSec) ownSec.style.display = 'none';
    }

    // Build names
    const makeHeb = c.tozeret_nm || '';
    const modelHeb = c.kinuy_mishari || c.degem_nm || '';
    const engMatch = (makeHeb + ' ' + modelHeb).match(/[a-zA-Z]+(?:\s+[a-zA-Z0-9]+)*/);
    const engName = engMatch ? engMatch[0] : makeHeb;

    // ── Hero Panel ──
    set('plateTxt', fPlate(c.mispar_rechev));
    set('carMake', makeHeb);
    set('carModel', modelHeb || makeHeb);
    const publicExtras = document.getElementById('publicVehicleExtras');
    if (c._isPublic) {
      const t = publicVehicleType(c._publicType.cd, c._publicType.nm);
      const parts = [t.label];
      if (c._seats) parts.push(`${c._seats} מקומות`);
      set('carTrim', parts.join(' · '));

      // Public-specific rows pinned to the top of "פרטי הרכב"
      if (publicExtras) {
        const rows = [];
        rows.push(`<div class="data-row"><span class="data-label">סוג כלי רכב</span><span class="data-value">${t.icon} ${t.label}</span></div>`);
        if (c._seats != null)
          rows.push(`<div class="data-row"><span class="data-label">מקומות ישיבה</span><span class="data-value">${c._seats}</span></div>`);
        if (c._seatsNextDriver != null && Number(c._seatsNextDriver) > 0)
          rows.push(`<div class="data-row"><span class="data-label">מקומות ליד הנהג</span><span class="data-value">${c._seatsNextDriver}</span></div>`);
        if (c._totalWeight != null && Number(c._totalWeight) > 0)
          rows.push(`<div class="data-row"><span class="data-label">משקל כולל</span><span class="data-value">${Number(c._totalWeight).toLocaleString('he-IL')} ק"ג</span></div>`);
        publicExtras.innerHTML = rows.join('');
      }
    } else {
      set('carTrim', c.ramat_gimur || '');
      if (publicExtras) publicExtras.innerHTML = '';
    }
    set('qYear', c.shnat_yitzur);
    set('qFuel', c.sug_delek_nm);
    set('qColor', c.tzeva_rechev);

    // License validity color
    const lc = licenseChip(c.tokef_dt);
    const chip = document.getElementById('chipTest');
    chip.className = 'stat-chip ' + (lc || '');
    set('qLicense', fDate(c.tokef_dt));

    // ── Data sections ──
    set('dMake', c.tozeret_nm);
    set('dModel', c.degem_nm);
    set('dKinuy', c.kinuy_mishari);
    set('dTrim', c.ramat_gimur);
    set('dMakeCd', c.tozeret_cd);
    set('dModelCd', c.degem_cd);
    set('dSugDegem', c.sug_degem);
    set('dEngine', c.degem_manoa);
    set('dFuel', c.sug_delek_nm);
    set('dTireF', c.zmig_kidmi);
    set('dTireR', c.zmig_ahori);
    set('dPollution', c.kvutzat_zihum);
    set('dSafety', c.ramat_eivzur_betihuty);
    set('dOwner', c.baalut);
    set('dChassis', c.misgeret);
    set('dRegOrder', c.horaat_rishum);
    set('dFirstReg', fDate(c.moed_aliya_lakvish));
    set('dColorCd', c.tzeva_cd);
    set('dColor', c.tzeva_rechev);
    set('dYear', c.shnat_yitzur);
    set('dLastTest', fDate(c.mivchan_acharon_dt));
    set('dLicense', fDate(c.tokef_dt));
    renderCountdown(c.tokef_dt);

    // ── Image & logo ──
    const kinuyEn = (c.kinuy_mishari || '').trim();
    // Extract English brand from tozeret_nm — may be Hebrew (e.g. "מאזדה יפן")
    const HEB_TO_ENG = {
      'מאזדה':'Mazda','מזדה':'Mazda','טויוטה':'Toyota','הונדה':'Honda','ניסאן':'Nissan',
      'יונדאי':'Hyundai','קיה':'Kia','מיצובישי':'Mitsubishi','סובארו':'Subaru',
      'סוזוקי':'Suzuki','אינפיניטי':'Infiniti','לקסוס':'Lexus',
      'פולקסווגן':'Volkswagen','אאודי':'Audi','אודי':'Audi',
      'סקודה':'Skoda',"סקודה צ'כיה":'Skoda',
      'סיאט':'Seat','קופרה':'Cupra','מרצדס':'Mercedes','ב מ וו':'BMW','ב.מ.וו':'BMW',
      'פיאט':'Fiat',"פז'ו":'Peugeot','רנו':'Renault','סיטרואן':'Citroen',
      'אופל':'Opel','פורד':'Ford','שברולט':'Chevrolet','דאצ\'יה':'Dacia',
      'וולוו':'Volvo','טסלה':'Tesla','פורשה':'Porsche','מיני':'Mini',
      'קריזלר':'Jeep',"ג'יפ":'Jeep','דודג\'':'Dodge',
      'לנד רובר':'Land Rover','יגואר':'Jaguar','אלפא רומיאו':'Alfa Romeo',
    };
    const tozetNm = c.tozeret_nm || '';
    let engBrand = tozetNm.match(/[a-zA-Z]+(?:[\s-][a-zA-Z]+)*/)?.[0] || '';
    if (!engBrand) {
      const hebKey = Object.keys(HEB_TO_ENG).find(k => tozetNm.includes(k));
      if (hebKey) engBrand = HEB_TO_ENG[hebKey];
    }
    loadBrandLogo(kinuyEn, tozetNm, engBrand);

    // ── Computed insights: license fee + avg km/year placeholder ──
    const fee = estimateLicenseFee(c.kvutzat_zihum, c.shnat_yitzur);
    const feeChip = document.getElementById('chipFee');
    if (fee) {
      setHtml('qFee', `₪${fee.toLocaleString('he-IL')} <a href="https://www.gov.il/he/service/calculate-vehicle-license-fee" target="_blank" rel="noopener" class="fee-info" title="המחיר משוער. לחץ למחשבון הרשמי של משרד התחבורה">*</a>`);
      feeChip.classList.add('accent');
    } else {
      set('qFee', '—');
      feeChip.classList.remove('accent');
    }
    // Avg km/year is filled in renderVehicleHistory once mileage arrives
    set('qAvgKm', '—');
    document.getElementById('chipAvgKm').className = 'stat-chip';

    // ── History (with snapshot for compare feature) ──
    const label = fPlate(raw) + (kinuyEn ? ` · ${kinuyEn}` : '');
    const logoUrl = document.getElementById('brandLogo')?.src || '';
    const snapshot = {
      make:    makeHeb,
      model:   modelHeb,
      year:    c.shnat_yitzur || null,
      fuel:    c.sug_delek_nm || null,
      color:   c.tzeva_rechev || null,
      license: fDate(c.tokef_dt),
      fee:     estimateLicenseFee(c.kvutzat_zihum, c.shnat_yitzur),
      // mileage / avgKm / owners / recalls / health filled in by async fetches below
    };
    addToHistory(raw, label, logoUrl, snapshot);

    // ── Update URL for deep-linking / sharing (no history pollution) ──
    history.replaceState(null, '', `${location.pathname}?plate=${raw}`);

    // ── gov.il history link ──
    document.getElementById('findcarLink').href = `https://www.gov.il/he/Departments/DynamicCollectors/private_vehicle_history_1?skip=0&mispar_rechev=${raw}`;
    document.getElementById('ownershipLink').href = `https://www.gov.il/he/Departments/DynamicCollectors/private_vehicle_history_2?skip=0&mispar_rechev=${raw}`;
    document.getElementById('stolenRaw').value = raw;

    // ── Health score (immediate from base data) ──
    Object.keys(healthData).forEach(k => healthData[k] = null);
    document.getElementById('healthWrap').style.display = 'none';
    // Reset timeline
    tlData.base = null; tlData.owners = null; tlData.recalls = null;
    document.getElementById('timelineBody').innerHTML = '<div class="km-loading"><span class="spin"><i class="fa-solid fa-circle-notch"></i></span> בונה ציר זמן...</div>';
    initHealthScore(c);
    tlData.base = { c }; tryRenderTimeline();

    // ── Async non-blocking enrichment ──
    fetchRecalls(raw);
    fetchVehicleSpecs(c.tozeret_cd, c.degem_cd, c.shnat_yitzur);
    fetchModelPopulation(c.tozeret_cd, c.degem_cd, c.shnat_yitzur);
    if (!isPublic) {
      // These all assume a private vehicle in the standard registries
      fetchTestHistory(raw);
      fetchOwnershipHistory(raw);
      fetchOffRoad(raw);
      fetchImporterPrice(c.tozeret_cd, c.degem_cd, c.shnat_yitzur);
    }

    statusMsg('');
    document.getElementById('resultCard').style.display = 'block';

  } catch (e) {
    // Still check if car is off-road even if not in active registry
    fetchOffRoad(raw, true);
    statusMsg(`<span class="status-error"><i class="fa-solid fa-triangle-exclamation"></i> לא נמצאו נתונים למספר רישוי זה — ייתכן שמדובר ברכב צבאי, דיפלומטי, או שאינו כלול במאגר הממשלתי הפתוח</span>`);
  }
}

// ─── Export PDF → Professional HTML Report ────────────────────
function exportPDF() {
  const g = id => document.getElementById(id)?.textContent?.trim() || '—';

  const plate      = g('plateTxt');
  const make       = g('carMake');
  const model      = g('carModel');
  const trim       = g('carTrim');
  const year       = g('qYear');
  const fuel       = g('qFuel');
  const carColor   = g('qColor');
  const license    = g('qLicense');
  const healthNum  = g('healthNum');
  const healthVerdict = g('healthVerdict');
  const today      = new Date().toLocaleDateString('he-IL', {day:'2-digit',month:'2-digit',year:'numeric'});

  // Collect flags
  const flagEls  = [...document.querySelectorAll('#healthFlags .health-flag')];
  const flagsHTML = flagEls.map(f => {
    const cls = f.classList.contains('hf-red') ? 'flag-red' : f.classList.contains('hf-green') ? 'flag-green' : 'flag-yellow';
    return `<span class="flag ${cls}">${f.textContent.trim()}</span>`;
  }).join('');

  // Collect data sections
  const sections = [
    { title:'פרטי הרכב', icon:'🚗', rows:[
      ['שם תוצר', g('dMake')], ['שם דגם', g('dModel')], ['כינוי מסחרי', g('dKinuy')],
      ['רמת גימור', g('dTrim')], ['דגם מנוע', g('dEngine')], ['סוג דגם', g('dSugDegem')],
      ['קוד תוצר', g('dMakeCd')], ['קוד דגם', g('dModelCd')],
    ]},
    { title:'פרטים טכניים', icon:'⚙️', rows:[
      ['סוג דלק', g('dFuel')], ['צמיג קדמי', g('dTireF')], ['צמיג אחורי', g('dTireR')],
      ['קבוצת זיהום', g('dPollution')], ['רמת איבזור בטיחות', g('dSafety')],
    ]},
    { title:'בעלות ורישום', icon:'📋', rows:[
      ['סוג בעלות', g('dOwner')], ['מספר שילדה', g('dChassis')],
      ['הוראת רישום', g('dRegOrder')], ['מועד עלייה לכביש', g('dFirstReg')],
      ['קוד צבע', g('dColorCd')], ['צבע רכב', g('dColor')],
    ]},
    { title:'תאריכים ותוקף', icon:'📅', rows:[
      ['שנת ייצור', g('dYear')], ['תאריך מבחן אחרון', g('dLastTest')],
      ['תוקף רישיון רכב', g('dLicense')],
    ]},
  ];

  const sectionsHTML = sections.map(sec => `
    <div class="section">
      <div class="section-header"><span class="section-icon">${sec.icon}</span>${sec.title}</div>
      <table class="data-table">
        ${sec.rows.map(([label, val]) => `
        <tr>
          <td class="cell-label">${label}</td>
          <td class="cell-value">${val}</td>
        </tr>`).join('')}
      </table>
    </div>`).join('');

  // Ownership history
  const ownerRows = [...document.querySelectorAll('#ownershipBody .data-row')].map(row => {
    const spans = row.querySelectorAll('span');
    const label = spans[0]?.textContent?.replace(/^\d+/, '').trim() || '';
    const val   = spans[1]?.textContent?.trim() || '';
    return `<tr><td class="cell-label">${label}</td><td class="cell-value">${val}</td></tr>`;
  }).join('');

  // Recalls
  const recallItems = [...document.querySelectorAll('#recallBody > div > div')].map(item => {
    const type = item.querySelector('span')?.textContent?.trim() || '';
    const desc = item.querySelector('div:last-child')?.textContent?.trim() || '';
    return `<div class="recall-item"><div class="recall-type">${type}</div><div class="recall-desc">${desc}</div></div>`;
  }).join('');

  // Mileage
  const kmHero  = document.querySelector('#kmBody [style*="2.2rem"]')?.textContent?.trim() || '';
  const kmRows  = [...document.querySelectorAll('#kmBody .data-row')].map(row => {
    const spans = row.querySelectorAll('span');
    return `<tr><td class="l">${spans[0]?.textContent?.trim()||''}</td><td class="v">${spans[1]?.textContent?.trim()||''}</td></tr>`;
  }).join('');

  const score = parseInt(healthNum) || 0;
  const scoreColor = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const circumference = 188.5;
  const offset = circumference - (score / 100) * circumference;

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>דוח רכב — ${plate}</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&family=IBM+Plex+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --brown: #8a7d6f; --brown-dark: #5c524a; --brown-light: #b8aa9a;
    --paper: #faf8f4; --paper2: #f2ede4; --line: #e0d8cc;
    --ink: #5c524a; --muted: #8a7d6f;
    --gold: #c9953a; --red: #b91c1c; --green: #15803d; --amber: #b45309;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4 portrait; margin: 0; }

  body {
    font-family: 'Heebo', sans-serif;
    background: #f1f5f9;
    color: var(--ink); direction: rtl;
    padding: 0 0 60px;
  }

  /* ── SCREEN TOOLBAR ── */
  .toolbar {
    background: var(--brown-dark); color:#fff;
    padding: 10px 24px; display:flex; align-items:center;
    justify-content:space-between;
    position: sticky; top:0; z-index:100;
  }
  .back-btn {
    display:inline-flex; align-items:center; gap:6px;
    color:rgba(255,255,255,0.8); font-size:0.82rem; font-weight:600;
    text-decoration:none; padding:5px 12px;
    border:1px solid rgba(255,255,255,0.25); border-radius:6px;
  }
  .print-btn {
    background:var(--gold); color:#fff; border:none;
    padding:8px 22px; border-radius:6px;
    font-family:'Heebo',sans-serif; font-size:0.85rem; font-weight:700; cursor:pointer;
  }
  @media print {
    .toolbar { display:none !important; }
    body { background:#fff; padding:0; }
    .doc { box-shadow:none; border-radius:0; padding:14mm 14mm 10mm; margin:0; max-width:none; }
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }

  /* ── PAGE WRAPPER ── */
  .doc {
    max-width: 820px;
    margin: 24px auto 0;
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 8px 40px rgba(0,0,0,.10);
    padding: 14mm 14mm 10mm;
    display: flex; flex-direction: column; gap: 6mm;
  }

  /* ── HEADER ── */
  .doc-header {
    display: flex; align-items: flex-end; justify-content: space-between;
    border-bottom: 2.5px solid var(--brown); padding-bottom: 4mm;
  }
  .dh-left .org  { font-size: 7pt; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin-bottom:2px; }
  .dh-left .title{ font-size: 22pt; font-weight:900; letter-spacing:-.02em; color:var(--brown-dark); line-height:1; }
  .dh-left .sub  { font-size: 7.5pt; color:var(--muted); margin-top:2px; }
  .dh-right      { text-align:left; }
  .dh-right .date{ font-size:7pt; color:var(--muted); margin-bottom:4px; }
  .plate-badge {
    display:inline-flex; align-items:stretch;
    border:2px solid var(--brown-dark); border-radius:7px; overflow:hidden;
  }
  .plate-flag {
    background:#003399; color:#fff;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:4px 7px; gap:1px; font-size:7pt; font-weight:800;
  }
  .plate-flag .flag-emoji { font-size:11pt; }
  .plate-num {
    background:#f5c518; color:#111;
    display:flex; align-items:center; padding:5px 14px;
    font-size:30pt; letter-spacing:10px; font-weight:700;
  }

  /* ── HERO BAND ── */
  .hero-band {
    background: var(--brown); color:#fff;
    border-radius: 10px; padding: 5mm 6mm;
    display: grid; grid-template-columns: 1fr auto;
    align-items: center; gap: 6mm;
  }
  .hb-make   { font-size:6.5pt; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:rgba(255,255,255,0.55); margin-bottom:2px; }
  .hb-model  { font-size:18pt; font-weight:900; line-height:1.1; }
  .hb-trim   { font-size:7.5pt; color:rgba(255,255,255,0.55); margin-top:2px; }
  .hb-stats  { display:flex; gap:6mm; margin-top:4mm; padding-top:3mm; border-top:1px solid rgba(255,255,255,0.2); }
  .stat-lbl  { font-size:5.5pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,0.45); margin-bottom:1px; }
  .stat-val  { font-size:9pt; font-weight:700; }

  .score-wrap { position:relative; display:flex; flex-direction:column; align-items:center; gap:3px; flex-shrink:0; }
  .score-svg  { width:60px; height:60px; display:block; }
  .sc-track   { fill:none; stroke:rgba(255,255,255,0.15); stroke-width:6; }
  .sc-fill    { fill:none; stroke-width:6; stroke-linecap:round; }
  .score-center {
    position:absolute; top:0; left:0; width:60px; height:60px;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
  }
  .sc-num { font-size:13pt; font-weight:900; line-height:1; }
  .sc-lbl { font-size:5pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,0.4); }
  .sc-verdict { font-size:6pt; font-weight:600; color:rgba(255,255,255,0.7); text-align:center; max-width:60px; }

  /* ── FLAGS ── */
  .flags { display:flex; flex-wrap:wrap; gap:4px; }
  .flag { font-size:6.5pt; font-weight:700; padding:2.5px 9px; border-radius:100px; }
  .flag-red    { background:#fee2e2; color:var(--red);   border:1px solid #fca5a5; }
  .flag-green  { background:#dcfce7; color:var(--green); border:1px solid #86efac; }
  .flag-yellow { background:#fef3c7; color:var(--amber); border:1px solid #fcd34d; }

  /* ── DATA SECTIONS ── */
  .sections { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
  .sec { border:1.5px solid var(--line); border-radius:8px; overflow:hidden; }
  .sec-full { grid-column:1/-1; }
  .sec-head {
    background:var(--paper2); padding:5px 12px;
    font-size:6.5pt; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
    color:var(--brown-dark); border-bottom:1.5px solid var(--line);
    display:flex; align-items:center; gap:5px;
  }
  .sec-head-icon { font-size:9pt; }
  table.dt { width:100%; border-collapse:collapse; background:#fff; }
  table.dt tr:not(:last-child) td { border-bottom:1px solid var(--line); }
  td.l { padding:4.5px 10px; font-size:7pt; color:var(--muted); font-weight:500; width:40%; border-left:1px solid var(--line); white-space:nowrap; }
  td.v { padding:4.5px 10px; font-size:7.5pt; font-weight:700; color:var(--ink); }

  /* ── OWNERSHIP CHIPS ── */
  .owner-chips { display:flex; flex-wrap:wrap; gap:4px; padding:8px 10px; background:#fff; }
  .owner-chip {
    display:inline-flex; align-items:center; gap:5px;
    background:var(--paper2); border:1px solid var(--line);
    border-radius:100px; padding:3px 10px; font-size:7pt; font-weight:700; color:var(--ink);
  }
  .oc-label { font-weight:700; }
  .oc-val   { color:var(--muted); font-weight:500; }
  .owner-chip .num {
    width:15px; height:15px; border-radius:50%;
    background:var(--brown); color:#fff;
    display:inline-flex; align-items:center; justify-content:center;
    font-size:6pt; font-weight:800; flex-shrink:0;
  }

  /* ── KM HERO ── */
  .km-big { padding:7px 12px 4px; display:flex; align-items:baseline; gap:5px; border-bottom:1px solid var(--line); background:#fff; }
  .km-n { font-size:18pt; font-weight:900; color:var(--gold); font-family:'IBM Plex Mono',monospace; }
  .km-u { font-size:8pt; color:var(--muted); font-weight:600; }

  .no-recall { padding:8px 12px; color:var(--green); font-size:7.5pt; font-weight:700; background:#fff; }
  .recall-item { padding:6px 12px; border-bottom:1px solid var(--line); background:#fff; }
  .rc-type { font-size:7pt; font-weight:700; color:var(--red); margin-bottom:2px; }
  .rc-desc { font-size:6.5pt; color:var(--muted); line-height:1.4; }

  /* ── FOOTER ── */
  .doc-footer {
    border-top:1.5px solid var(--line); padding-top:3mm;
    display:flex; justify-content:space-between; align-items:center;
    color:var(--muted); font-size:6.5pt;
  }
  .df-brand { font-weight:900; color:var(--brown-dark); font-size:7.5pt; }
</style>
</head>
<body>

<div class="doc">

  <!-- Header -->
  <div class="doc-header">
    <div class="dh-left">
      <div class="org">מאגר הרכבים הלאומי — ישראל</div>
      <div class="title">דוח בדיקת רכב</div>
      <div class="sub">נתונים ממשרד התחבורה · data.gov.il</div>
    </div>
    <div class="dh-right">
      <div class="plate-badge">
        <div class="plate-flag"><span>IL</span></div>
        <div class="plate-num">${plate}</div>
      </div>
    </div>
  </div>

  <!-- Hero band -->
  <div class="hero-band">
    <div>
      <div class="hb-make">${make}</div>
      <div class="hb-model">${model}</div>
      ${trim && trim !== '—' ? `<div class="hb-trim">${trim}</div>` : ''}
      <div class="hb-stats">
        <div><div class="stat-lbl">שנת ייצור</div><div class="stat-val">${year}</div></div>
        <div><div class="stat-lbl">דלק</div><div class="stat-val">${fuel}</div></div>
        <div><div class="stat-lbl">צבע</div><div class="stat-val">${carColor}</div></div>
        <div><div class="stat-lbl">תוקף רישיון</div><div class="stat-val">${license}</div></div>
      </div>
    </div>
    <div class="score-wrap">
      <svg class="score-svg" viewBox="0 0 60 60">
        <circle class="sc-track" cx="30" cy="30" r="24" transform="rotate(-90 30 30)"/>
        <circle class="sc-fill" cx="30" cy="30" r="24" transform="rotate(-90 30 30)"
          stroke="${scoreColor}"
          stroke-dasharray="150.8"
          stroke-dashoffset="${(150.8 - (score/100)*150.8).toFixed(1)}"/>
      </svg>
      <div class="score-center">
        <div class="sc-num" style="color:#f2ede4">${healthNum}</div>
      </div>
      <div class="sc-verdict">${healthVerdict}</div>
    </div>
  </div>

  <!-- Flags -->
  ${flagsHTML ? `<div class="flags">${flagsHTML}</div>` : ''}

  <!-- 2-column grid -->
  <div class="sections">

    <!-- פרטי רכב -->
    <div class="sec">
      <div class="sec-head"><span class="sec-head-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="22" height="13" rx="2"/><path d="M5 6V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/><circle cx="8" cy="17" r="1.5" fill="currentColor"/><circle cx="16" cy="17" r="1.5" fill="currentColor"/></svg></span> פרטי הרכב</div>
      <table class="dt">
        <tr><td class="l">יצרן</td><td class="v">${g('dMake')}</td></tr>
        <tr><td class="l">דגם</td><td class="v">${g('dModel')}</td></tr>
        <tr><td class="l">כינוי מסחרי</td><td class="v">${g('dKinuy')}</td></tr>
        <tr><td class="l">גימור</td><td class="v">${g('dTrim')}</td></tr>
        <tr><td class="l">דגם מנוע</td><td class="v">${g('dEngine')}</td></tr>
        <tr><td class="l">סוג דלק</td><td class="v">${g('dFuel')}</td></tr>
        <tr><td class="l">קב' זיהום</td><td class="v">${g('dPollution')}</td></tr>
        <tr><td class="l">רמת בטיחות</td><td class="v">${g('dSafety')}</td></tr>
        <tr><td class="l">צמיג קדמי</td><td class="v">${g('dTireF')}</td></tr>
        <tr><td class="l">צמיג אחורי</td><td class="v">${g('dTireR')}</td></tr>
      </table>
    </div>

    <!-- בעלות ורישום -->
    <div class="sec">
      <div class="sec-head"><span class="sec-head-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg></span> בעלות ורישום</div>
      <table class="dt">
        <tr><td class="l">שילדה</td><td class="v" style="font-size:6.5pt">${g('dChassis')}</td></tr>
        <tr><td class="l">עלייה לכביש</td><td class="v">${g('dFirstReg')}</td></tr>
        <tr><td class="l">צבע</td><td class="v">${g('dColor')}</td></tr>
        <tr><td class="l">שנת ייצור</td><td class="v">${g('dYear')}</td></tr>
        <tr><td class="l">טסט אחרון</td><td class="v">${g('dLastTest')}</td></tr>
        <tr><td class="l">תוקף רישיון</td><td class="v">${g('dLicense')}</td></tr>
      </table>
      <div class="sec-head" style="font-size:6pt; border-top:1.5px solid var(--line); border-bottom:none; margin-top:0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> היסטוריית בעלויות</div>
      <div class="owner-chips">
        ${[...document.querySelectorAll('#ownershipBody .data-row')].map((row,i)=>{
          const spans = row.querySelectorAll('span');
          // spans[0] may contain a number circle + text, strip all leading digits/spaces
          const rawLabel = spans[0]?.textContent?.trim()||'';
          const label = rawLabel.replace(/^\d+\s*/,'').replace(/\d/g,'').trim();
          const val   = spans[1]?.textContent?.trim()||'';
          return `<div class="owner-chip"><span class="num">${i+1}</span><span class="oc-label">${label}</span></div>`;
        }).join('')}
      </div>
    </div>

    <!-- קילומטרז' -->
    <div class="sec">
      <div class="sec-head"><span class="sec-head-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span> קילומטרז' ומידע היסטורי</div>
      <table class="dt">
        ${kmHero ? `<tr><td class="l">נסועה אחרונה</td><td class="v">${kmHero} ק"מ</td></tr>` : ''}
        ${kmRows}
      </table>
    </div>

    <!-- ריקולים -->
    <div class="sec">
      <div class="sec-head"><span class="sec-head-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> ריקולים פתוחים</div>
      ${recallItems || '<div class="no-recall">&#10003; לא נמצאו ריקולים פתוחים לרכב זה</div>'}
    </div>

  </div>

  <!-- Footer -->
  <div class="doc-footer">
    <div class="df-brand">מאגר רכבים ישראל</div>
    <div>נתונים ממשרד התחבורה ובטיחות בדרכים · data.gov.il</div>
    <div>${today}</div>
  </div>

</div>
</body>
</html>`;
  
  // --- הצגת לואדר ---
  const pdfLoader = document.getElementById('pdf-loader');
  const pdfLoaderText = document.getElementById('pdf-loader-text');
  pdfLoaderText.textContent = 'מכין מסמך להדפסה...';
  pdfLoader.classList.add('active');

  // 1. ניקוי Iframe קודם אם קיים (למניעת תקיעות באייפון בפעמים הבאות)
  const existingIframe = document.getElementById('print-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }

  // 2. יצירת Iframe נסתר
  const iframe = document.createElement('iframe');
  iframe.id = 'print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '-10000px';
  iframe.style.bottom = '-10000px';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  // 3. הגדרת מה קורה כשהמסמך מסיים להיטען
  iframe.onload = () => {
    // השהייה של 2.5 שניות כדי שהמשתמש יראה את הלואדר
    setTimeout(() => {
      // העלמת הלואדר והקפצת חלון ההדפסה
      pdfLoader.classList.remove('active');
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      
      // ה-Iframe נשאר ברקע ויימחק אוטומטית רק בלחיצה הבאה
    }, 2500); 
  };

  // 4. כתיבת ה-HTML לתוך ה-Iframe
  const filename = `דוח-רכב-${plate}`;
  const doc = iframe.contentWindow.document;
  doc.open();
  // הגדרת Title כדי ששמירת ה-PDF תציע את השם הזה אוטומטית
  doc.write(`<title>${filename}</title>`);
  // הסרת שוליים כדי להעלים את התאריך וכתובת ה-URL שמתווספים בהדפסת ברירת מחדל
  doc.write(`
    <style>
      @page { size: A4; margin: 0; }
    </style>
  `);
  doc.write(html);
  doc.close();
}

// ─── WhatsApp Share ───────────────────────────────────────────
function shareWhatsApp() {
  const g = id => document.getElementById(id)?.textContent?.trim() || '—';
  const plate    = g('plateTxt');
  const make     = g('carMake');
  const model    = g('carModel');
  const year     = g('qYear');
  const fuel     = g('qFuel');
  const carColor = g('qColor');
  const license  = g('qLicense');
  const health   = g('healthNum');
  const verdict  = g('healthVerdict');
  const km       = document.querySelector('#kmBody [style*="2.2rem"]')?.textContent?.trim() || '';
  const owners   = document.querySelector('#ownershipBody [style*="2.8rem"]')?.textContent?.trim() || '';

  const plateRaw = (document.getElementById('stolenRaw')?.value || '').replace(/\D/g, '');
  // On localhost, point shareable links at the production URL
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const baseUrl = isLocal
    ? 'https://perezari.github.io/CarInformation/'
    : `${location.origin}${location.pathname}`;
  const link = plateRaw ? `${baseUrl}?plate=${plateRaw}` : '';

  const lines = [
    `*דוח רכב — ${plate}*`,
    `─────────────────`,
    `יצרן: ${make} ${model} (${year})`,
    `דלק: ${fuel} | צבע: ${carColor}`,
    km     ? `נסועה: ${km} ק"מ` : '',
    owners ? `ידיים: ${owners}` : '',
    `תוקף רישיון: ${license}`,
    `─────────────────`,
    `*ציון בריאות: ${health}/100 — ${verdict}*`,
    `─────────────────`,
    link ? `לצפייה בדוח המלא:` : '',
    link || '',
    `נתונים מ-data.gov.il`,
  ].filter(Boolean).join('\n');

  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

// ─── Camera OCR ───────────────────────────────────────────────
let cameraStream = null;

// Lazy-load Tesseract.js (~5MB) only when camera is used
let tesseractPromise = null;
function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload  = () => resolve(window.Tesseract);
    s.onerror = () => { tesseractPromise = null; reject(new Error('failed to load tesseract')); };
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

async function openCamera() {
  // Kick off Tesseract download in parallel with camera permission
  loadTesseract().catch(() => {});

  const modal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');
  modal.style.display = 'flex';
  setModalOpen(true);
  document.getElementById('ocrStatus').textContent = 'פותח מצלמה...';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = cameraStream;
    document.getElementById('ocrStatus').textContent = 'כוון את הלוחית לתוך המסגרת הצהובה';
  } catch(e) {
    document.getElementById('ocrStatus').textContent = 'לא ניתן לגשת למצלמה: ' + e.message;
  }
}

function closeCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  document.getElementById('cameraModal').style.display = 'none';
  document.getElementById('cameraVideo').srcObject = null;
  setModalOpen(false);
}

async function captureAndOCR() {
  const video  = document.getElementById('cameraVideo');
  const canvas = document.getElementById('ocrCanvas');
  const status = document.getElementById('ocrStatus');

  // Crop to the plate frame area (middle 75% width, 22% height)
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = Math.round(vw * 0.75), ch = Math.round(vh * 0.22);
  const cx = Math.round((vw - cw) / 2),  cy = Math.round((vh - ch) / 2);

  canvas.width = cw; canvas.height = ch;
  canvas.getContext('2d').drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);

  status.innerHTML = '<span class="spin"><i class="fa-solid fa-circle-notch"></i></span> מנתח תמונה...';

  try {
    await loadTesseract();
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
    const { data: { text } } = await worker.recognize(canvas);
    await worker.terminate();

    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length >= 7) {
      closeCamera();
      document.getElementById('plateInput').value = digits;
      syncOtpBoxes();
      status.textContent = '';
      fetchCar();
    } else {
      status.textContent = `זוהו רק ${digits.length} ספרות (${digits}) — נסה שוב עם תאורה טובה יותר`;
    }
  } catch(e) {
    status.textContent = 'שגיאה בזיהוי: ' + e.message;
  }
}

// ─── Modal helpers ───────────────────────────────────────────
function setModalOpen(isOpen) {
  document.body.classList.toggle('modal-open', !!isOpen);
}

// ─── Compare cars ────────────────────────────────────────────
let compareSelection = [];
const snapshotsLoading = new Set();

// Backfill basic data for cars saved before the snapshot feature
async function ensureSnapshot(plate) {
  const h = getHistory();
  const item = h.find(x => x.plate === plate);
  if (!item) return;
  if (item.snapshot && item.snapshot.year) return; // already populated
  if (snapshotsLoading.has(plate)) return;
  snapshotsLoading.add(plate);

  try {
    const apiUrl = `https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&q=${plate}`;
    const res  = await fetch(apiUrl);
    const data = await res.json();
    if (data.success && data.result?.records?.length) {
      const c = data.result.records[0];
      updateHistorySnapshot(plate, {
        make:    c.tozeret_nm || '',
        model:   c.kinuy_mishari || c.degem_nm || '',
        year:    c.shnat_yitzur || null,
        fuel:    c.sug_delek_nm || null,
        color:   c.tzeva_rechev || null,
        license: fDate(c.tokef_dt),
        fee:     estimateLicenseFee(c.kvutzat_zihum, c.shnat_yitzur),
      });
    }
  } catch (_) {}
  finally { snapshotsLoading.delete(plate); }
}

function openCompareModal() {
  const h = getHistory();
  if (h.length < 2) {
    statusMsg('<span class="status-error"><i class="fa-solid fa-circle-info"></i> דרושים לפחות 2 רכבים בהיסטוריה כדי להשוות</span>');
    setTimeout(() => statusMsg(''), 3500);
    return;
  }
  compareSelection = [];
  document.getElementById('compareModal').style.display = 'flex';
  document.getElementById('compareSelect').style.display = 'block';
  document.getElementById('compareView').style.display = 'none';
  setModalOpen(true);
  renderCompareList();

  // Backfill snapshots for any history items missing them
  h.forEach(item => {
    if (!item.snapshot || !item.snapshot.year) {
      ensureSnapshot(item.plate).then(() => renderCompareList());
    }
  });
}

function closeCompareModal() {
  document.getElementById('compareModal').style.display = 'none';
  setModalOpen(false);
}

function renderCompareList() {
  const h = getHistory();
  const list = document.getElementById('compareList');
  list.innerHTML = h.map(x => {
    const sel = compareSelection.includes(x.plate);
    const disabled = !sel && compareSelection.length >= 3;
    return `
      <label class="compare-item ${sel ? 'selected' : ''} ${disabled ? 'disabled' : ''}">
        <input type="checkbox" ${sel ? 'checked' : ''} ${disabled ? 'disabled' : ''}
               onchange="toggleCompareItem('${x.plate}')">
        ${x.logo ? `<img src="${x.logo}" class="cmp-item-logo" onerror="this.style.display='none'">` : `<i class="fa-solid fa-car cmp-item-icon"></i>`}
        <div class="cmp-item-text">
          <div class="cmp-item-label">${x.label}</div>
          ${x.snapshot ? `<div class="cmp-item-meta">${x.snapshot.year || ''} · ${x.snapshot.fuel || ''} · ${x.snapshot.color || ''}</div>` : `<div class="cmp-item-meta">אין מידע נוסף</div>`}
        </div>
      </label>`;
  }).join('');

  const btn = document.getElementById('compareGoBtn');
  btn.disabled = compareSelection.length < 2;
  btn.innerHTML = `<i class="fa-solid fa-scale-balanced"></i> השווה (${compareSelection.length})`;
}

function toggleCompareItem(plate) {
  const i = compareSelection.indexOf(plate);
  if (i >= 0) compareSelection.splice(i, 1);
  else if (compareSelection.length < 3) compareSelection.push(plate);
  renderCompareList();
}

async function runCompare() {
  if (compareSelection.length < 2) return;
  // Make sure snapshots are loaded for all selected cars
  const btn = document.getElementById('compareGoBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"><i class="fa-solid fa-circle-notch"></i></span> טוען נתונים...';
  await Promise.all(compareSelection.map(p => ensureSnapshot(p)));
  btn.innerHTML = orig; btn.disabled = false;

  const h = getHistory();
  const cars = compareSelection.map(p => h.find(x => x.plate === p)).filter(Boolean);

  const get = (c, key) => c.snapshot?.[key];

  // Find best/worst per metric for highlighting
  const ages = cars.map(c => Number(get(c, 'year')) || 0);
  const newestYear = Math.max(...ages.filter(Boolean));
  const oldestYear = Math.min(...ages.filter(Boolean));
  const mileages = cars.map(c => Number(get(c, 'mileage')) || Infinity).filter(v => v !== Infinity);
  const lowMileage = mileages.length ? Math.min(...mileages) : null;
  const highMileage = mileages.length ? Math.max(...mileages) : null;
  const owners = cars.map(c => Number(get(c, 'owners')) || Infinity).filter(v => v !== Infinity);
  const lowOwners = owners.length ? Math.min(...owners) : null;
  const highOwners = owners.length ? Math.max(...owners) : null;
  const recalls = cars.map(c => Number(get(c, 'recalls')) ?? 0);
  const healths = cars.map(c => Number(get(c, 'health')) || 0);
  const bestHealth = Math.max(...healths);
  const worstHealth = Math.min(...healths);
  const fees = cars.map(c => Number(get(c, 'fee')) || Infinity).filter(v => v !== Infinity);
  const lowFee  = fees.length ? Math.min(...fees) : null;
  const highFee = fees.length ? Math.max(...fees) : null;
  const avgKms = cars.map(c => Number(get(c, 'avgKm')) || Infinity).filter(v => v !== Infinity);
  const lowAvgKm  = avgKms.length ? Math.min(...avgKms) : null;
  const highAvgKm = avgKms.length ? Math.max(...avgKms) : null;

  const fmt = v => (v == null || v === '' ? '<span class="cmp-na">—</span>' : v);
  const fmtKm = v => v ? Number(v).toLocaleString('he-IL') + ' ק"מ' : '<span class="cmp-na">—</span>';

  const cls = (val, best, worst) => {
    if (val == null || best == null || best === worst) return '';
    if (val === best) return 'cmp-good';
    if (val === worst) return 'cmp-bad';
    return '';
  };

  const cols = cars.map(c => `<th>
    <div class="cmp-col-head">
      ${c.logo ? `<img src="${c.logo}" class="cmp-head-logo" onerror="this.style.display='none'">` : ''}
      <div class="cmp-head-model">${get(c, 'model') || c.label.split('·')[0].trim()}</div>
      <div class="cmp-head-plate">${fPlate(c.plate)}</div>
    </div>
  </th>`).join('');

  const row = (label, vals, classifier) => `
    <tr>
      <td class="cmp-row-label">${label}</td>
      ${vals.map((v, i) => {
        const cls = classifier ? classifier(i) : '';
        return `<td class="cmp-row-val ${cls}">${v}</td>`;
      }).join('')}
    </tr>`;

  const tableHtml = `
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead><tr><th></th>${cols}</tr></thead>
        <tbody>
          ${row('יצרן',         cars.map(c => fmt(get(c, 'make'))))}
          ${row('דגם',          cars.map(c => fmt(get(c, 'model'))))}
          ${row('שנת ייצור',    cars.map(c => fmt(get(c, 'year'))),
              i => cls(Number(get(cars[i], 'year')), newestYear, oldestYear))}
          ${row('דלק',          cars.map(c => fmt(get(c, 'fuel'))))}
          ${row('צבע',          cars.map(c => fmt(get(c, 'color'))))}
          ${row('תוקף רישיון',  cars.map(c => fmt(get(c, 'license'))))}
          ${row('נסועה',        cars.map(c => fmtKm(get(c, 'mileage'))),
              i => { const v = Number(get(cars[i], 'mileage')); return cls(v, lowMileage, highMileage); })}
          ${row('ממוצע נסועה לשנה', cars.map(c => fmtKm(get(c, 'avgKm'))),
              i => { const v = Number(get(cars[i], 'avgKm')); return cls(v, lowAvgKm, highAvgKm); })}
          ${row('אגרת רישוי משוערת', cars.map(c => { const f = get(c, 'fee'); return f ? `₪${Number(f).toLocaleString('he-IL')}` : '<span class="cmp-na">—</span>'; }),
              i => { const v = Number(get(cars[i], 'fee')); return cls(v, lowFee, highFee); })}
          ${row('ידיים',        cars.map(c => fmt(get(c, 'owners'))),
              i => { const v = Number(get(cars[i], 'owners')); return cls(v, lowOwners, highOwners); })}
          ${row('ריקולים פתוחים', cars.map(c => fmt(get(c, 'recalls') ?? '—')),
              i => { const v = recalls[i]; const min = Math.min(...recalls); const max = Math.max(...recalls); return cls(v, min, max); })}
          ${row('ציון בריאות',  cars.map(c => { const h = get(c, 'health'); return h ? `<strong>${h}/100</strong>` : '<span class="cmp-na">—</span>'; }),
              i => cls(healths[i], bestHealth, worstHealth))}
        </tbody>
      </table>
    </div>
    <div class="cmp-note"><i class="fa-solid fa-circle-info"></i> ההשוואה מבוססת על נתונים שנשמרו בעת החיפוש האחרון של כל רכב</div>
    <button class="cmp-back-btn" onclick="backToCompareSelect()"><i class="fa-solid fa-arrow-right"></i> חזור לבחירה</button>
  `;

  document.getElementById('compareView').innerHTML = tableHtml;
  document.getElementById('compareSelect').style.display = 'none';
  document.getElementById('compareView').style.display = 'block';
}

function backToCompareSelect() {
  document.getElementById('compareSelect').style.display = 'block';
  document.getElementById('compareView').style.display = 'none';
}

// ─── Theme toggle ────────────────────────────────────────────
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f5f5f7' : '#0a0c10');
}

// Init
renderHistory();

// Deep-link: read URL params on load
(function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const plate  = (params.get('plate') || '').replace(/\D/g, '');
  const action = params.get('action');

  if (plate.length === 7 || plate.length === 8) {
    document.getElementById('plateInput').value = plate;
    syncOtpBoxes();
    fetchCar();
  } else if (action === 'scan') {
    openCamera();
  } else if (action === 'new') {
    document.getElementById('plateInput').focus();
  }
})();
