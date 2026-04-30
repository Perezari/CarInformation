// ─── Recent searches (localStorage) ──────────────────────────
const HISTORY_KEY = 'car_search_history';
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function addToHistory(plate, label, logoUrl) {
  let h = getHistory().filter(x => x.plate !== plate);
  h.unshift({ plate, label, logo: logoUrl || '' });
  if (h.length > 5) h = h.slice(0,5);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  renderHistory();
}
function removeFromHistory(plate) {
  const h = getHistory().filter(x => x.plate !== plate);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  renderHistory();
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
  const engine      = r.mispar_manoa ?? null;
  const regDate     = r.rishum_rishon_dt ?? r.tariph_rischum ?? null;
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
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${CKAN_RECALL}&q=${plate}&limit=100`;
    const res = await fetch(url);
    const d   = await res.json();
    if (!d.success) throw new Error('failed');

    let records = (d.result?.records ?? [])
      .filter(r => String(r.MISPAR_RECHEV) === String(plate));

    records.sort((a, b) => (b.TAARICH_PTICHA || '').localeCompare(a.TAARICH_PTICHA || ''));

    renderRecalls(records);
    updateHealthFromRecalls(records.length);
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

// ─── Car image from Wikipedia ─────────────────────────────────
async function loadCarImage(kinuyEn, engBrand) {
  const shimmer = document.getElementById('shimmer');
  const img = document.getElementById('carImg');

  const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  // Keep uppercase only for model codes like CX-5, Q5, E-TRON (contain digit or hyphen)
  // Regular words like GRAND, CHEROKEE, MAZDA → Title Case
  const smartCase = s => s.trim().split(/\s+/).map(w =>
    /[\d-]/.test(w) ? w.toUpperCase() : titleCase(w)
  ).join(' ');

  // Strip Israeli registry suffixes that don't appear in Wikipedia
  // e.g. "SUPERB FL" → "SUPERB", "CX-5 AWD" → "CX-5"
  const IL_SUFFIXES = /\b(FL|PHEV|HEV|MHEV|EV|AWD|4WD|4X4|SW|ST|SPORT|CROSS|PLUS|PRO|MAX|ELITE|PREMIUM|LUXURY|ACTIVE|STYLE|AMBITION|EXECUTIVE|LIMITED|SIGNATURE|PRESTIGE|MOTION|COMFORT|TREND|DESIGN|PULSE|ALLURE|FEEL|SHINE|PURETECH|BLUEHDI|ETSI|TSI|TDI|TFSI|FSI|GDI|CRDI|D|T|S|E|G|N|R)\b/g;
  const cleanKinuy = kinuyEn.replace(IL_SUFFIXES, '').replace(/\s+/g, ' ').trim();

  const kinuy = smartCase(cleanKinuy || kinuyEn || '');
  const brand = titleCase((engBrand || '').trim());

  // Does kinuy already start with the brand name?
  const kinuyHasBrand = brand && kinuy.toLowerCase().startsWith(brand.toLowerCase());
  const fullName = kinuyHasBrand ? kinuy : [brand, kinuy].filter(Boolean).join(' ');
  // e.g. "Jeep Grand Cherokee", "Mazda CX-5"

  const noHyphen  = fullName.replace(/-/g, '');
  // Also try adding hyphen before digits: "Mazda CX5" → "Mazda CX-5"
  const withHyphen = fullName.replace(/([A-Za-z])(\d)/g, '$1-$2');

  const candidates = [
    fullName,                          // "Mazda CX-5" / "Jeep Grand Cherokee"
    withHyphen,                        // "Mazda CX-5" (if CX5 was input)
    noHyphen,                          // "Mazda CX5"
    fullName.replace(/\s/g, '_'),      // "Mazda_CX-5"
    brand || kinuy,                    // "Mazda"
    fullName + ' car',
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const term of candidates) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.thumbnail?.source) {
        const src = data.thumbnail.source.replace(/\/\d+px-/, '/600px-');
        img.src = src;
        img.onload = () => { shimmer.style.display = 'none'; img.style.opacity = '1'; img.classList.add('loaded'); };
        img.onerror = () => loadFallbackImage(brand || kinuy);
        return;
      }
    } catch (_) {}
  }
  loadFallbackImage(brand || kinuy);
}

function loadFallbackImage(brand) {
  const img = document.getElementById('carImg');
  const shimmer = document.getElementById('shimmer');
  const kw = encodeURIComponent((brand || 'car') + ' car');
  // Unsplash source API
  img.src = `https://source.unsplash.com/800x500/?${kw}`;
  img.onload = () => {
    shimmer.style.display = 'none';
    img.style.opacity = '1';
    img.classList.add('loaded');
  };
  img.onerror = () => {
    shimmer.style.display = 'none';
    img.src = 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800';
    img.style.opacity = '1';
    img.classList.add('loaded');
  };
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
  const fmtDt = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
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
  events.sort((a,b) => a.date - b.date);

  const el = document.getElementById('timelineBody');
  if (!el) return;

  let lastYear = null;
  const rows = events.map(ev => {
    const yr = ev.date.getFullYear();
    const yearMark = yr !== lastYear ? `<div class="tl-year-label">${yr}</div>` : '';
    lastYear = yr;
    return `${yearMark}<div class="tl-event ${ev.type}">
      <div class="tl-icon"><i class="${ICONS[ev.type]}"></i></div>
      <div class="tl-content">
        <span class="tl-label">${ev.label}</span>
        <div class="tl-right">${ev.badge||''}<span class="tl-sub">${ev.sub||''}</span></div>
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
}

// ─── Main fetch ───────────────────────────────────────────────
async function fetchCar() {
  const raw = document.getElementById('plateInput').value.trim().replace(/-/g,'');
  if (!raw) return;

  statusMsg('<div class="status-loading"><span class="spin"><i class="fa-solid fa-circle-notch"></i></span> שולף נתונים...</div>');
  document.getElementById('resultCard').style.display = 'none';

  // Reset image + logo
  const img = document.getElementById('carImg');
  img.style.opacity = '0';
  img.src = '';
  document.getElementById('shimmer').style.display = 'block';
  const logo = document.getElementById('brandLogo');
  logo.style.display = 'none';
  logo.src = '';

  try {
    const apiUrl = `https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&q=${raw}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!data.success || !data.result.records.length) throw new Error('not found');

    const c = data.result.records[0];

    // Build names
    const makeHeb = c.tozeret_nm || '';
    const modelHeb = c.kinuy_mishari || c.degem_nm || '';
    const engMatch = (makeHeb + ' ' + modelHeb).match(/[a-zA-Z]+(?:\s+[a-zA-Z0-9]+)*/);
    const engName = engMatch ? engMatch[0] : makeHeb;

    // ── Hero Panel ──
    set('plateTxt', fPlate(c.mispar_rechev));
    set('carMake', makeHeb);
    set('carModel', modelHeb || makeHeb);
    set('carTrim', c.ramat_gimur || '');
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
      'מאזדה':'Mazda','טויוטה':'Toyota','הונדה':'Honda','ניסאן':'Nissan',
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
    loadCarImage(kinuyEn, engBrand);

    // ── History ──
    const label = fPlate(raw) + (kinuyEn ? ` · ${kinuyEn}` : '');
    const logoUrl = document.getElementById('brandLogo')?.src || '';
    addToHistory(raw, label, logoUrl);

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

    // ── Test history + mileage + ownership + off-road + recalls (async, non-blocking) ──
    fetchTestHistory(raw);
    fetchOwnershipHistory(raw);
    fetchOffRoad(raw);
    fetchRecalls(raw);

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
    `נתונים מ-data.gov.il`,
  ].filter(Boolean).join('\n');

  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank');
}

// ─── Camera OCR ───────────────────────────────────────────────
let cameraStream = null;

async function openCamera() {
  const modal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');
  modal.style.display = 'flex';
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
