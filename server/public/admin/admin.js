const app = document.querySelector('#app');
const tokenKey = 'rideon_admin_token';
let token = sessionStorage.getItem(tokenKey) || '';
let me = null;
let page = 'overview';
let toast = '';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = paise => '₹' + Math.round(Number(paise || 0) / 100).toLocaleString('en-IN');
const rupees = value => '₹' + Number(value || 0).toLocaleString('en-IN');

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? {'Content-Type': 'application/json'} : {}),
      ...(token ? {Authorization: 'Bearer ' + token} : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || 'Request failed.');
  return payload;
}

function setToast(message) {
  toast = message;
  render();
  setTimeout(() => { if (toast === message) { toast = ''; render(); } }, 3200);
}

function loginView() {
  app.innerHTML = '<main class="login"><form class="card" id="login"><p class="brand">ride<span>on</span></p><p class="muted">Admin dashboard. Sign in with the email on an admin account.</p><label>Email</label><input name="email" type="email" autocomplete="username" required><div id="code-wrap" hidden><label>Verification code</label><input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><button class="primary" type="submit">Send sign-in code</button><p class="muted" id="hint"></p><div class="error" id="err" hidden></div></form></main>';
  const form = document.querySelector('#login');
  const codeWrap = document.querySelector('#code-wrap');
  const button = form.querySelector('button');
  const hint = document.querySelector('#hint');
  const err = document.querySelector('#err');
  let sent = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    err.hidden = true;
    button.disabled = true;
    const email = form.email.value.trim().toLowerCase();
    try {
      if (!sent) {
        await api('/api/v1/auth/request-otp', {method:'POST', body:JSON.stringify({email})});
        sent = true;
        codeWrap.hidden = false;
        button.textContent = 'Continue';
        hint.textContent = 'Enter the 6-digit code sent to ' + email + '.';
      } else {
        const session = await api('/api/v1/auth/verify-otp', {method:'POST', body:JSON.stringify({email, token:form.code.value.trim()})});
        token = session.accessToken || session.data?.accessToken || '';
        if (!token) throw new Error('RideOn did not return a session.');
        sessionStorage.setItem(tokenKey, token);
        me = (await api('/api/v1/me')).user;
        if (!['admin','support'].includes(me?.role)) {
          sessionStorage.removeItem(tokenKey);
          token = '';
          throw new Error('This account is not an admin. Ask RideOn to set role = admin for this email.');
        }
        render();
      }
    } catch (error) {
      err.hidden = false;
      err.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function shell(title, body) {
  app.innerHTML = '<div class="shell"><aside class="side"><p class="brand">ride<span>on</span></p><p class="muted">' + esc(me?.name || 'Admin') + '</p><nav>' +
    ['overview','inventory','bookings','payments','customers'].map(item => '<button data-page="' + item + '" class="' + (page === item ? 'active' : '') + '">' + item[0].toUpperCase() + item.slice(1) + '</button>').join('') +
    '</nav><button class="ghost" id="signout">Sign out</button></aside><main class="main"><div class="top"><div><p class="muted">RideOn operations</p><h1>' + esc(title) + '</h1></div><p class="muted">' + esc(me?.name || 'Admin') + '</p></div>' + body + '</main></div>' +
    (toast ? '<div class="toast">' + esc(toast) + '</div>' : '');
  app.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { page = button.dataset.page; render(); }));
  document.querySelector('#signout').addEventListener('click', () => { sessionStorage.removeItem(tokenKey); token = ''; me = null; page = 'overview'; render(); });
}

function table(headers, rows) {
  return '<div class="panel"><table><thead><tr>' + headers.map(header => '<th>' + header + '</th>').join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.join('') : '<tr><td colspan="' + headers.length + '">Nothing here yet.</td></tr>') +
    '</tbody></table></div>';
}

async function overview() {
  const {overview: data} = await api('/api/v1/fleet-ops/overview');
  shell('Overview', '<section class="stats">' + [
    ['Vehicles', data.fleet.totalFleet],
    ['Available', data.fleet.available],
    ['Out now', data.fleet.rented],
    ['Paid', money(data.payments.paidPaise)],
    ['Bookings', data.bookings.total],
    ['Awaiting confirm', data.bookings.requested],
    ['In progress', data.bookings.inProgress],
    ['Verified customers', data.customers.verified + ' / ' + data.customers.total],
  ].map(([label, value]) => '<article class="stat"><span class="muted">' + label + '</span><b>' + value + '</b></article>').join('') + '</section><p class="muted">Pending payments ' + money(data.payments.pendingPaise) + ' · Refunds ' + money(data.payments.refundedPaise) + '</p>');
}

async function inventory() {
  const {vehicles} = await api('/api/v1/fleet-ops/vehicles?limit=100');
  shell('Inventory', '<form class="panel form-grid" id="vehicle"><div><label>Name</label><input name="name" required></div><div><label>Kind</label><select name="fleetVehicleClass"><option value="car">Car</option><option value="bike">Bike</option><option value="scooter">Scooter</option></select></div><div><label>City</label><input name="city" required></div><div><label>Daily rate (₹)</label><input name="dailyRate" type="number" min="0" required></div><div><label>Security deposit (₹)</label><input name="securityDeposit" type="number" min="0" value="0"></div><div><label>Registration</label><input name="registrationNumber"></div><div class="wide"><label>Photo URL</label><input name="imageUrl" type="url" placeholder="https://"></div><div class="wide"><button class="primary" type="submit">Add vehicle</button></div></form>' +
    table(['Vehicle','City','Rate','State'], (vehicles || []).map(vehicle => '<tr><td>' + esc(vehicle.name) + '<div class="muted">' + esc(vehicle.vehicleKind || vehicle.type || '') + '</div></td><td>' + esc(vehicle.city || '') + '</td><td>' + rupees(vehicle.pricePerDay || vehicle.dailyRate) + '</td><td>' + esc(vehicle.operationalState || 'AVAILABLE') + '</td></tr>')));
  document.querySelector('#vehicle').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const imageUrl = form.imageUrl.value.trim();
    try {
      await api('/api/v1/fleet-ops/vehicles', {method:'POST', body:JSON.stringify({
        name:form.name.value.trim(),
        fleetVehicleClass:form.fleetVehicleClass.value,
        city:form.city.value.trim(),
        dailyRate:Number(form.dailyRate.value),
        securityDeposit:Number(form.securityDeposit.value || 0),
        registrationNumber:form.registrationNumber.value.trim(),
        imageUrls:imageUrl ? [imageUrl] : [],
      })});
      setToast('Vehicle added to RideOn inventory.');
    } catch (error) { setToast(error.message); }
  });
}

const nextActions = {requested:[['confirmed','Confirm']], confirmed:[['in_progress','Start rental'],['cancelled','Cancel']], in_progress:[['completed','Mark returned']]};

async function changeBooking(id, status) {
  let note = '';
  if (status === 'rejected') {
    note = window.prompt('Why is this booking being rejected?') || '';
    if (!note.trim()) return;
  }
  try {
    await api('/api/v1/fleet-ops/bookings/' + id + '/status', {method:'POST', body:JSON.stringify({status, note})});
    setToast('Booking updated.');
  } catch (error) { setToast(error.message); }
}

async function bookings() {
  const {bookings: rows} = await api('/api/v1/fleet-ops/bookings?limit=50');
  shell('Bookings', table(['Trip','Customer','When','Payment','Status',''], (rows || []).map(booking => {
    const actions = nextActions[booking.status] || [];
    const reject = booking.status === 'requested' ? '<button data-id="' + esc(booking.id) + '" data-status="rejected">Reject</button>' : '';
    return '<tr><td>' + esc(booking.vehicleName) + '<div class="muted">' + esc(booking.id) + '</div></td><td>' + esc(booking.customerName) + '<div class="muted">' + esc(booking.customerPhone || '') + '</div></td><td>' + esc(new Date(booking.startAt).toLocaleString()) + '</td><td>' + esc(booking.paymentStatus || '') + '<div class="muted">' + rupees(booking.amount) + '</div></td><td>' + esc(booking.status) + '</td><td class="row-actions">' + actions.map(([status, label]) => '<button data-id="' + esc(booking.id) + '" data-status="' + status + '">' + label + '</button>').join('') + reject + '</td></tr>';
  })));
  app.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => changeBooking(button.dataset.id, button.dataset.status)));
}

async function payments() {
  const {payments: rows} = await api('/api/v1/fleet-ops/payments?limit=50');
  shell('Payments', table(['Customer','Booking','Amount','Provider','Status'], (rows || []).map(payment => '<tr><td>' + esc(payment.customerName) + '</td><td>' + esc(payment.bookingId) + '</td><td>' + rupees(payment.amount) + '</td><td>' + esc(payment.provider || '') + '</td><td>' + esc(payment.status) + '</td></tr>')));
}

async function customers() {
  const {customers: rows} = await api('/api/v1/fleet-ops/customers?limit=100');
  shell('Customers', table(['Name','Contact','Role','Identity'], (rows || []).map(customer => '<tr><td>' + esc(customer.fullName || '') + '</td><td>' + esc(customer.email || '') + '<div class="muted">' + esc(customer.phone || '') + '</div></td><td>' + esc(customer.role) + '</td><td>' + esc(customer.kycStatus) + '</td></tr>')));
}

const pages = {overview, inventory, bookings, payments, customers};

async function render() {
  if (!token) return loginView();
  try {
    if (!me) me = (await api('/api/v1/me')).user;
    if (!['admin','support'].includes(me?.role)) throw new Error('This account is not an admin.');
    await pages[page]();
  } catch (error) {
    if (/session|auth|invalid|expired/i.test(error.message)) { sessionStorage.removeItem(tokenKey); token = ''; me = null; return loginView(); }
    shell('Admin', '<div class="error">' + esc(error.message) + '</div>');
  }
}

render();
