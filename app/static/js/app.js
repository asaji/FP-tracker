'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let routes = [];
const miniCharts = {};
let expandedChart = null;

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadRoutes();
  loadSettings();

  // Trip type toggle
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
    const origin = document.getElementById('out-origin').value;
    const dest = document.getElementById('out-dest').value;
    document.getElementById('ret-origin').value = dest;
    document.getElementById('ret-dest').value = origin;
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
  const timestamps = routes
    .map(r => r.last_checked)
    .filter(Boolean)
    .sort()
    .reverse();
  const el = document.getElementById('last-checked-text');
  if (timestamps.length) {
    el.textContent = `Last checked ${timeAgo(timestamps[0])}`;
    el.classList.remove('d-none');
  }
}

function renderRoutes(routes) {
  const grid = document.getElementById('routes-grid');
  const empty = document.getElementById('empty-state');

  // Destroy existing mini charts
  Object.values(miniCharts).forEach(c => c.destroy());
  Object.keys(miniCharts).forEach(k => delete miniCharts[k]);

  if (!routes.length) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.classList.remove('d-none');
    return;
  }

  empty.classList.add('d-none');

  // Group by trip_id for visual grouping
  const grouped = groupRoutes(routes);

  grid.innerHTML = '';
  grouped.forEach(group => {
    const wrapper = document.createElement('div');
    wrapper.className = group.length > 1
      ? 'col-12 col-md-6 col-xl-4'
      : 'col-12 col-md-6 col-xl-4';

    if (group.length > 1) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'trip-group d-flex flex-column gap-2';
      group.forEach(r => groupDiv.appendChild(buildCard(r)));
      wrapper.appendChild(groupDiv);
    } else {
      wrapper.appendChild(buildCard(group[0]));
    }

    grid.appendChild(wrapper);
  });

  // Load charts after cards are in DOM
  routes.forEach(r => loadMiniChart(r.id));
}

function groupRoutes(routes) {
  const groups = {};
  const standalone = [];
  routes.forEach(r => {
    if (r.trip_id) {
      if (!groups[r.trip_id]) groups[r.trip_id] = [];
      groups[r.trip_id].push(r);
    } else {
      standalone.push([r]);
    }
  });
  return [...Object.values(groups), ...standalone];
}

function buildCard(r) {
  const priceHtml = formatPrice(r.current_price, r.prev_price);
  const legBadge = r.trip_id
    ? `<span class="badge badge-leg bg-secondary me-1">${r.leg_label}</span>`
    : '';
  const nonstopBadge = r.non_stop_only
    ? '<span class="badge bg-info text-dark small">Non-stop</span>'
    : '';
  const airlinesStr = r.airlines && r.airlines.length
    ? r.airlines.join(', ')
    : 'Any airline';
  const seatLabel = {
    ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Prem. Economy',
    BUSINESS: 'Business', FIRST: 'First'
  }[r.seat_type] || r.seat_type;

  const lastChecked = r.last_checked
    ? `<span class="text-secondary small">Checked ${timeAgo(r.last_checked)}</span>`
    : `<span class="text-secondary small">Never checked</span>`;

  const adults = r.adults > 1 ? `· ${r.adults} adults` : '';

  const card = document.createElement('div');
  card.className = 'route-card p-3';
  card.innerHTML = `
    <div class="d-flex justify-content-between align-items-start mb-2">
      <div>
        ${legBadge}
        <span class="route-label">${r.origin} → ${r.destination}</span>
        <div class="text-secondary small mt-0">${r.departure_date}</div>
      </div>
      <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="deleteRoute(${r.id})" title="Remove">
        <i class="bi bi-trash3 small"></i>
      </button>
    </div>

    <div class="d-flex align-items-baseline gap-2 mb-1">
      ${priceHtml}
    </div>
    <div class="mb-2">${lastChecked}</div>

    <div class="d-flex flex-wrap gap-1 mb-3">
      <span class="badge bg-secondary">${seatLabel}${adults}</span>
      <span class="badge bg-secondary">${airlinesStr}</span>
      ${nonstopBadge}
    </div>

    <div class="chart-container" style="height:100px" onclick="openChartModal(${r.id}, '${r.origin} → ${r.destination} (${r.departure_date})')">
      <canvas id="chart-${r.id}"></canvas>
    </div>
  `;
  return card;
}

function formatPrice(current, prev) {
  if (current == null) {
    return `<span class="price-display price-none">—</span><span class="text-secondary small">No results</span>`;
  }
  const fmt = n => `$${Math.round(n).toLocaleString()}`;
  let changeHtml = '';
  if (prev != null && prev !== current) {
    const diff = current - prev;
    const cls = diff < 0 ? 'price-down' : 'price-up';
    const icon = diff < 0 ? '↓' : '↑';
    changeHtml = `<span class="${cls} small fw-semibold">${icon} ${fmt(Math.abs(diff))}</span>`;
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
    console.error(`Failed to load history for route ${routeId}:`, e);
  }
}

function buildChartData(history) {
  return history
    .filter(h => h.price != null)
    .map(h => ({ x: new Date(h.checked_at), y: h.price }));
}

function renderMiniChart(routeId, history) {
  const canvas = document.getElementById(`chart-${routeId}`);
  if (!canvas) return;
  if (miniCharts[routeId]) miniCharts[routeId].destroy();

  const data = buildChartData(history);

  if (!data.length) {
    const ctx = canvas.getContext('2d');
    canvas.parentElement.style.height = '40px';
    ctx.fillStyle = '#6e7681';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No price data yet', canvas.width / 2, 24);
    return;
  }

  miniCharts[routeId] = new Chart(canvas, chartConfig(data, true));
}

function chartConfig(data, mini = false) {
  const prices = data.map(d => d.y);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = Math.max((maxPrice - minPrice) * 0.2, 10);

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
        tooltip: {
          callbacks: {
            label: ctx => `$${Math.round(ctx.parsed.y).toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'MMM d, h:mm a' },
          grid: { color: mini ? 'transparent' : '#21262d' },
          ticks: {
            display: !mini,
            color: '#8b949e',
            maxRotation: 0,
            maxTicksLimit: 6,
          }
        },
        y: {
          min: minPrice - padding,
          max: maxPrice + padding,
          grid: { color: mini ? 'transparent' : '#21262d' },
          ticks: {
            display: !mini,
            color: '#8b949e',
            callback: v => `$${Math.round(v).toLocaleString()}`,
          }
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
    } catch (e) {
      console.error('Chart modal error:', e);
    }
  }, { once: true });
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
    errEl.textContent = 'Origin, destination, and departure date are required.';
    errEl.classList.remove('d-none');
    return;
  }
  if (outOrigin.length !== 3 || outDest.length !== 3) {
    errEl.textContent = 'Origin and destination must be 3-letter IATA airport codes (e.g. JFK, LHR).';
    errEl.classList.remove('d-none');
    return;
  }

  const body = {
    trip_type: tripType,
    outbound: { origin: outOrigin, destination: outDest, departure_date: outDate },
    adults,
    seat_type: seatType,
    non_stop_only: nonStop,
    airlines,
  };

  if (tripType === 'round_trip') {
    const retOrigin = document.getElementById('ret-origin').value.trim().toUpperCase();
    const retDest = document.getElementById('ret-dest').value.trim().toUpperCase();
    const retDate = document.getElementById('ret-date').value;
    if (!retOrigin || !retDest || !retDate) {
      errEl.textContent = 'Return origin, destination, and date are required for round trips.';
      errEl.classList.remove('d-none');
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
    errEl.textContent = 'Failed to add route. Please try again.';
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add Route';
  }
}

// ── Delete route ───────────────────────────────────────────────────────────
async function deleteRoute(id) {
  if (!confirm('Remove this route and all its price history?')) return;
  try {
    await fetch(`/api/routes/${id}`, { method: 'DELETE' });
    await loadRoutes();
  } catch (e) {
    alert('Failed to delete route.');
  }
}

// ── Check now ──────────────────────────────────────────────────────────────
async function checkNow() {
  const btn = document.getElementById('btn-check-now');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Checking…';
  try {
    await fetch('/api/poll', { method: 'POST' });
    // Poll for updates — refresh a few times over 30 seconds
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

// ── Utilities ──────────────────────────────────────────────────────────────
function timeAgo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
