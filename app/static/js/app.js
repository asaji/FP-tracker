'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let routes = [];
const miniCharts = {};
let expandedChart = null;

// trip builder: map of route_id -> {label, price}
const tripSelection = new Map();

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadRoutes();
  loadSettings();

  document.querySelectorAll('input[name="tripType"]').forEach(radio => {
    radio.addEventListener('change', e => {
      const isRound = e.target.value === 'round_trip';
      document.getElementById('return-segment').classList.toggle('d-none', !isRound);
      document.getElementById('outbound-label').textContent = isRound ? 'Outbound' : 'Flight';
      if (isRound) autoFillReturn();
    });
  });

  document.getElementById('out-origin').addEventListener('input', autoFillReturn);
  document.getElementById('out-dest').addEventListener('input', autoFillReturn);
});

function autoFillReturn() {
  if (document.getElementById('typeRoundTrip').checked) {
    document.getElementById('ret-origin').value = document.getElementById('out-dest').value;
    document.getElementById('ret-dest').value = document.getElementById('out-origin').value;
  }
}

// ── Load & render routes ───────────────────────────────────────────────────
async function loadRoutes() {
  try {
    const res = await fetch('/api/routes');
    routes = await res.json();
    renderRoutes(routes);
    updateLastChecked(routes);
  } catch (e) {
    console.error('Failed to load routes:', e);
  }
}

function updateLastChecked(routes) {
  const timestamps = routes.map(r => r.last_checked).filter(Boolean).sort().reverse();
  const el = document.getElementById('last-checked-text');
  if (timestamps.length) {
    el.textContent = `Last checked ${timeAgo(timestamps[0])}`;
    el.classList.remove('d-none');
  }
}

// ── Grouping ───────────────────────────────────────────────────────────────
// Returns array of "trip groups", each with one or two "leg groups"
// leg group = { leg_label, origin, dest, options, dates: [route, route, route] }
function buildTripGroups(routes) {
  const byTrip = new Map();

  for (const r of routes) {
    const tid = r.trip_id ?? `solo_${r.id}`;
    if (!byTrip.has(tid)) byTrip.set(tid, new Map());
    const legMap = byTrip.get(tid);
    const lk = r.leg_label;
    if (!legMap.has(lk)) legMap.set(lk, []);
    legMap.get(lk).push(r);
  }

  const tripGroups = [];
  for (const [, legMap] of byTrip) {
    const legs = [];
    for (const [leg_label, dateRoutes] of legMap) {
      dateRoutes.sort((a, b) => a.day_offset - b.day_offset);
      const ref = dateRoutes[0];
      legs.push({
        leg_label,
        origin: ref.origin,
        destination: ref.destination,
        seat_type: ref.seat_type,
        non_stop_only: ref.non_stop_only,
        airlines: ref.airlines,
        adults: ref.adults,
        dates: dateRoutes,
        // all IDs in this leg group (for batch delete)
        ids: dateRoutes.map(r => r.id),
      });
    }
    // sort so outbound comes before return
    legs.sort((a, b) => a.leg_label === 'outbound' ? -1 : 1);
    tripGroups.push({ legs, isRoundTrip: legs.length > 1 });
  }

  return tripGroups;
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderRoutes(routes) {
  const grid = document.getElementById('routes-grid');
  const empty = document.getElementById('empty-state');

  Object.values(miniCharts).forEach(c => c.destroy());
  Object.keys(miniCharts).forEach(k => delete miniCharts[k]);

  if (!routes.length) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.classList.remove('d-none');
    return;
  }

  empty.classList.add('d-none');
  grid.innerHTML = '';

  const tripGroups = buildTripGroups(routes);

  for (const group of tripGroups) {
    const col = document.createElement('div');
    col.className = 'col-12 col-xl-6';
    col.appendChild(buildGroupCard(group));
    grid.appendChild(col);
  }

  // Load mini charts after DOM is ready
  routes.forEach(r => loadMiniChart(r.id));
}

function buildGroupCard(group) {
  const card = document.createElement('div');
  card.className = `group-card p-3 ${group.isRoundTrip ? 'round-trip-group' : ''}`;

  group.legs.forEach((leg, legIdx) => {
    if (legIdx > 0) {
      const divider = document.createElement('hr');
      divider.className = 'border-secondary my-3';
      card.appendChild(divider);
    }
    card.appendChild(buildLegSection(leg, group.isRoundTrip));
  });

  return card;
}

function buildLegSection(leg, isRoundTrip) {
  const section = document.createElement('div');

  const seatLabel = { ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Prem. Eco', BUSINESS: 'Business', FIRST: 'First' }[leg.seat_type] || leg.seat_type;
  const airlinesStr = leg.airlines?.length ? leg.airlines.join(', ') : 'Any airline';
  const adults = leg.adults > 1 ? ` · ${leg.adults} adults` : '';
  const nonstop = leg.non_stop_only ? ' · Non-stop' : '';
  const legBadgeHtml = isRoundTrip
    ? `<span class="badge bg-secondary me-2" style="font-size:0.65rem">${leg.leg_label.toUpperCase()}</span>`
    : '';

  section.innerHTML = `
    <div class="d-flex justify-content-between align-items-start mb-3">
      <div>
        ${legBadgeHtml}
        <span class="fw-bold fs-5">${leg.origin} → ${leg.destination}</span>
        <div class="text-secondary small mt-1">${seatLabel}${adults}${nonstop} · ${airlinesStr}</div>
      </div>
      <button class="btn btn-sm btn-outline-danger py-0 px-1"
              onclick="deleteLegGroup([${leg.ids.join(',')}])" title="Remove">
        <i class="bi bi-trash3 small"></i>
      </button>
    </div>
    <div class="row g-2" id="dates-${leg.ids[0]}"></div>
  `;

  const datesRow = section.querySelector(`#dates-${leg.ids[0]}`);
  const colWidth = leg.dates.length === 3 ? 'col-4' : 'col-6';

  leg.dates.forEach(r => {
    const col = document.createElement('div');
    col.className = colWidth;
    col.appendChild(buildDateSubcard(r));
    datesRow.appendChild(col);
  });

  return section;
}

function buildDateSubcard(r) {
  const isTarget = r.day_offset === 0;
  const offsetLabel = r.day_offset === -1 ? '← Day Before' : r.day_offset === 1 ? 'Day After →' : 'Selected';
  const offsetClass = r.day_offset === -1 ? 'offset-badge-neg' : r.day_offset === 1 ? 'offset-badge-pos' : 'offset-badge-mid';
  const isSelected = tripSelection.has(r.id);

  const card = document.createElement('div');
  card.className = `date-subcard p-2${isTarget ? ' is-target-date' : ''}${isSelected ? ' selected' : ''}`;
  card.id = `subcard-${r.id}`;

  const priceHtml = formatPrice(r.current_price, r.prev_price);
  const lastChecked = r.last_checked ? timeAgo(r.last_checked) : 'never';

  card.innerHTML = `
    <input type="checkbox" class="route-checkbox" id="chk-${r.id}"
           ${isSelected ? 'checked' : ''}
           onchange="toggleTripSelection(${r.id}, '${r.origin}→${r.destination} ${r.departure_date}', event)">
    <div class="text-center mb-1">
      <span class="badge ${offsetClass} rounded-pill">${offsetLabel}</span>
    </div>
    <div class="text-center small mb-1">${r.departure_date}</div>
    <div class="text-center mb-1">${priceHtml}</div>
    <div class="text-center text-secondary mb-2" style="font-size:0.65rem">checked ${lastChecked}</div>
    <div class="chart-area" style="height:70px"
         onclick="openChartModal(${r.id}, '${r.origin}→${r.destination} · ${r.departure_date}')">
      <canvas id="chart-${r.id}"></canvas>
    </div>
  `;

  return card;
}

function formatPrice(current, prev) {
  if (current == null) {
    return `<span class="price-none" style="font-size:1rem">—</span>`;
  }
  const fmt = n => `$${Math.round(n).toLocaleString()}`;
  let changeHtml = '';
  if (prev != null && prev !== current) {
    const diff = current - prev;
    const cls = diff < 0 ? 'price-down' : 'price-up';
    const icon = diff < 0 ? '↓' : '↑';
    changeHtml = `<span class="${cls}" style="font-size:0.7rem"> ${icon}${fmt(Math.abs(diff))}</span>`;
  }
  const mainCls = prev == null || prev === current ? '' : (current < prev ? 'price-down' : 'price-up');
  return `<span class="price-display ${mainCls}">${fmt(current)}</span>${changeHtml}`;
}

// ── Mini charts ────────────────────────────────────────────────────────────
async function loadMiniChart(routeId) {
  try {
    const res = await fetch(`/api/routes/${routeId}/history`);
    const history = await res.json();
    renderMiniChart(routeId, history);
  } catch (e) {
    console.error(`Chart load failed for route ${routeId}:`, e);
  }
}

function buildChartData(history) {
  return history.filter(h => h.price != null).map(h => ({ x: new Date(h.checked_at), y: h.price }));
}

function renderMiniChart(routeId, history) {
  const canvas = document.getElementById(`chart-${routeId}`);
  if (!canvas) return;
  if (miniCharts[routeId]) miniCharts[routeId].destroy();

  const data = buildChartData(history);

  if (!data.length) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6e7681';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', canvas.width / 2, 30);
    return;
  }

  miniCharts[routeId] = new Chart(canvas, chartConfig(data, true));
}

function chartConfig(data, mini = false) {
  const prices = data.map(d => d.y);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const pad = Math.max((maxP - minP) * 0.2, 10);

  return {
    type: 'line',
    data: {
      datasets: [{
        data,
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88,166,255,0.08)',
        borderWidth: mini ? 1.5 : 2,
        pointRadius: mini ? 2 : 4,
        pointHoverRadius: mini ? 4 : 6,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `$${Math.round(ctx.parsed.y).toLocaleString()}` } }
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'MMM d, h:mm a' },
          grid: { color: mini ? 'transparent' : '#21262d' },
          ticks: { display: !mini, color: '#8b949e', maxRotation: 0, maxTicksLimit: 6 }
        },
        y: {
          min: minP - pad,
          max: maxP + pad,
          grid: { color: mini ? 'transparent' : '#21262d' },
          ticks: { display: !mini, color: '#8b949e', callback: v => `$${Math.round(v).toLocaleString()}` }
        }
      }
    }
  };
}

// ── Expanded chart modal ───────────────────────────────────────────────────
async function openChartModal(routeId, title) {
  document.getElementById('chart-modal-title').textContent = title;
  const modal = new bootstrap.Modal(document.getElementById('chartModal'));
  modal.show();

  document.getElementById('chartModal').addEventListener('shown.bs.modal', async () => {
    if (expandedChart) { expandedChart.destroy(); expandedChart = null; }
    try {
      const res = await fetch(`/api/routes/${routeId}/history`);
      const history = await res.json();
      const data = buildChartData(history);
      const canvas = document.getElementById('chart-modal-canvas');
      if (data.length) {
        expandedChart = new Chart(canvas, chartConfig(data, false));
      } else {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#6e7681';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No price data yet', canvas.width / 2, 60);
      }
    } catch (e) { console.error('Chart modal error:', e); }
  }, { once: true });
}

// ── Trip Builder ───────────────────────────────────────────────────────────
function toggleTripSelection(routeId, label, event) {
  event.stopPropagation();
  const route = routes.find(r => r.id === routeId);
  const price = route?.current_price ?? null;

  if (tripSelection.has(routeId)) {
    tripSelection.delete(routeId);
  } else {
    tripSelection.set(routeId, { label, price });
  }

  const subcard = document.getElementById(`subcard-${routeId}`);
  if (subcard) subcard.classList.toggle('selected', tripSelection.has(routeId));

  renderTripBuilder();
}

function renderTripBuilder() {
  const bar = document.getElementById('trip-builder');
  const itemsEl = document.getElementById('trip-builder-items');
  const totalEl = document.getElementById('trip-builder-total');
  const countEl = document.getElementById('trip-builder-count');

  if (tripSelection.size === 0) {
    bar.classList.add('d-none');
    return;
  }

  bar.classList.remove('d-none');

  itemsEl.innerHTML = '';
  let total = 0;
  let hasNull = false;

  for (const [id, { label, price }] of tripSelection) {
    const span = document.createElement('span');
    span.className = 'trip-item-badge';
    span.innerHTML = `${label} ${price != null ? `<strong>$${Math.round(price).toLocaleString()}</strong>` : '<em class="text-secondary">no price</em>'}
      <button class="btn-close ms-1" style="font-size:0.5rem" onclick="removeTripItem(${id})"></button>`;
    itemsEl.appendChild(span);

    if (price != null) total += price;
    else hasNull = true;
  }

  countEl.textContent = `${tripSelection.size} flight${tripSelection.size > 1 ? 's' : ''} selected`;

  if (hasNull) {
    totalEl.innerHTML = `<span class="text-secondary">Total: n/a</span>`;
  } else {
    totalEl.innerHTML = `Total: <span class="text-success">$${Math.round(total).toLocaleString()}</span>`;
  }
}

function removeTripItem(routeId) {
  tripSelection.delete(routeId);
  const chk = document.getElementById(`chk-${routeId}`);
  if (chk) chk.checked = false;
  const subcard = document.getElementById(`subcard-${routeId}`);
  if (subcard) subcard.classList.remove('selected');
  renderTripBuilder();
}

function clearTripBuilder() {
  for (const id of tripSelection.keys()) {
    const chk = document.getElementById(`chk-${id}`);
    if (chk) chk.checked = false;
    const subcard = document.getElementById(`subcard-${id}`);
    if (subcard) subcard.classList.remove('selected');
  }
  tripSelection.clear();
  renderTripBuilder();
}

// ── Delete ─────────────────────────────────────────────────────────────────
async function deleteLegGroup(ids) {
  if (!confirm(`Remove this route group (${ids.length} date variants) and all price history?`)) return;

  // Remove from trip selection if present
  ids.forEach(id => {
    tripSelection.delete(id);
  });
  renderTripBuilder();

  try {
    await fetch('/api/routes/batch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    await loadRoutes();
  } catch (e) {
    alert('Failed to delete route group.');
  }
}

// ── Add route ──────────────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-error').classList.add('d-none');
  document.getElementById('typeOneWay').checked = true;
  document.getElementById('return-segment').classList.add('d-none');
  document.getElementById('outbound-label').textContent = 'Flight';
  ['out-origin','out-dest','out-date','ret-origin','ret-dest','ret-date','opt-airlines'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('opt-adults').value = 1;
  document.getElementById('opt-seat').value = 'ECONOMY';
  document.getElementById('opt-nonstop').checked = false;
  new bootstrap.Modal(document.getElementById('addModal')).show();
}

async function addRoute() {
  const errEl = document.getElementById('add-error');
  errEl.classList.add('d-none');

  const tripType = document.querySelector('input[name="tripType"]:checked').value;
  const outOrigin = document.getElementById('out-origin').value.trim().toUpperCase();
  const outDest = document.getElementById('out-dest').value.trim().toUpperCase();
  const outDate = document.getElementById('out-date').value;
  const adults = parseInt(document.getElementById('opt-adults').value) || 1;
  const seatType = document.getElementById('opt-seat').value;
  const nonStop = document.getElementById('opt-nonstop').checked;
  const airlinesRaw = document.getElementById('opt-airlines').value;
  const airlines = airlinesRaw ? airlinesRaw.split(',').map(a => a.trim().toUpperCase()).filter(Boolean) : [];

  if (!outOrigin || !outDest || !outDate) {
    showAddError('Origin, destination, and departure date are required.');
    return;
  }
  if (outOrigin.length !== 3 || outDest.length !== 3) {
    showAddError('Origin and destination must be 3-letter IATA codes (e.g. JFK, LHR).');
    return;
  }

  const body = {
    trip_type: tripType,
    outbound: { origin: outOrigin, destination: outDest, departure_date: outDate },
    adults, seat_type: seatType, non_stop_only: nonStop, airlines,
  };

  if (tripType === 'round_trip') {
    const retOrigin = document.getElementById('ret-origin').value.trim().toUpperCase();
    const retDest = document.getElementById('ret-dest').value.trim().toUpperCase();
    const retDate = document.getElementById('ret-date').value;
    if (!retOrigin || !retDest || !retDate) {
      showAddError('Return origin, destination, and date are required for round trips.');
      return;
    }
    body.return = { origin: retOrigin, destination: retDest, departure_date: retDate };
  }

  const btn = document.getElementById('btn-add-route');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Adding…';

  try {
    const res = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Server error');
    bootstrap.Modal.getInstance(document.getElementById('addModal')).hide();
    await loadRoutes();
  } catch (e) {
    showAddError('Failed to add route. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add Route';
  }
}

function showAddError(msg) {
  const el = document.getElementById('add-error');
  el.textContent = msg;
  el.classList.remove('d-none');
}

// ── Check now ──────────────────────────────────────────────────────────────
async function checkNow() {
  const btn = document.getElementById('btn-check-now');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Checking…';
  try {
    await fetch('/api/poll', { method: 'POST' });
    let attempts = 0;
    const refresh = setInterval(async () => {
      await loadRoutes();
      if (++attempts >= 6) {
        clearInterval(refresh);
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Check Now';
      }
    }, 5000);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Check Now';
  }
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('setting-interval').value = data.poll_interval_minutes;
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function openSettingsModal() {
  document.getElementById('notify-result').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('settingsModal')).show();
}

async function saveSettings() {
  const interval = parseInt(document.getElementById('setting-interval').value);
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poll_interval_minutes: interval }),
    });
    bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
  } catch (e) {
    alert('Failed to save settings.');
  }
}

async function testNotification() {
  const btn = document.getElementById('btn-test-notify');
  const resultEl = document.getElementById('notify-result');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sending…';

  try {
    const res = await fetch('/api/notify/test', { method: 'POST' });
    const data = await res.json();
    resultEl.classList.remove('d-none', 'text-danger', 'text-success');
    if (res.ok) {
      resultEl.className = 'mt-2 small text-success';
      resultEl.textContent = '✓ Test notification sent successfully.';
    } else {
      resultEl.className = 'mt-2 small text-danger';
      resultEl.textContent = `✗ ${data.detail || 'Failed to send. Check PUSHOVER_TOKEN and PUSHOVER_USER.'}`;
    }
  } catch (e) {
    resultEl.className = 'mt-2 small text-danger';
    resultEl.textContent = '✗ Request failed.';
    resultEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-bell me-1"></i>Send Test';
    resultEl.classList.remove('d-none');
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function timeAgo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
