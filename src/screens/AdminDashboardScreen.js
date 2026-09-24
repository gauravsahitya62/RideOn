import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View
} from 'react-native';
import { rideOnApi, setAccessToken } from '../services/api';

const C = {
  bg: '#F5F7FA', navy: '#17202D', ink: '#1D2632', muted: '#74808D',
  line: '#E2E7EC', white: '#FFFFFF', orange: '#E85D35', green: '#2D9D66',
  red: '#C94B4B', yellow: '#A66A00'
};

const NAV = [
  ['overview', 'Overview'],
  ['bookings', 'Bookings'],
  ['users', 'Users'],
  ['vendors', 'Vendors'],
  ['vehicles', 'Vehicles'],
  ['finance', 'Finance'],
  ['support', 'Support'],
  ['reviews', 'Reviews'],
  ['deliveries', 'Live Ops'],
  ['audit', 'Audit Log']
];

const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function errorText(error) {
  if (error && error.code === 'FORBIDDEN') return 'You do not have permission to perform that operation.';
  if (error && error.code === 'ACCOUNT_SUSPENDED') return 'This account is suspended.';
  return String((error && error.message) || 'We could not load operations data right now.');
}

function Badge({ value }) {
  const text = String(value || 'unknown').replace(/_/g, ' ');
  const lower = text.toLowerCase();
  let tone = styles.badgeGray;
  if (lower.indexOf('cancel') >= 0 || lower.indexOf('fail') >= 0 || lower.indexOf('suspend') >= 0 || lower === 'hidden' || lower === 'issue') tone = styles.badgeRed;
  else if (lower.indexOf('pending') >= 0 || lower.indexOf('requested') >= 0 || lower.indexOf('waiting') >= 0 || lower.indexOf('progress') >= 0 || lower === 'open') tone = styles.badgeYellow;
  else if (lower.indexOf('complete') >= 0 || lower.indexOf('paid') >= 0 || lower.indexOf('approved') >= 0 || lower === 'active' || lower === 'visible') tone = styles.badgeGreen;
  return <Text style={[styles.badge, tone]}>{text}</Text>;
}

function Metric({ label, value, detail }) {
  return <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{String(value == null ? 0 : value)}</Text>
    {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
  </View>;
}

function Empty({ title, message }) {
  return <View style={styles.empty}>
    <Text style={styles.emptyTitle}>{title || 'No records found'}</Text>
    <Text style={styles.muted}>{message || 'Try a different search or filter.'}</Text>
  </View>;
}

function Detail({ label, value }) {
  return <View style={styles.detailBlock}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value == null || value === '' ? '—' : String(value)}</Text>
  </View>;
}

export default function AdminDashboardScreen({ user, onLogout }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 960;
  const canMutate = user && user.role === 'admin';
  const [section, setSection] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [data, setData] = useState(null);
  const [finance, setFinance] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [rating, setRating] = useState('');
  const [moderation, setModeration] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [supportInternal, setSupportInternal] = useState(false);
  const [supportAssignee, setSupportAssignee] = useState('');

  const limit = 25;

  useEffect(() => {
    setAccessToken(user && user.token ? user.token : null);
  }, [user]);

  const load = useCallback(async (refresh) => {
    setError('');
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      if (section === 'overview') {
        setDashboard(await rideOnApi.adminDashboard());
        setData(null);
        setFinance(null);
      } else if (section === 'finance') {
        const result = await Promise.all([
          rideOnApi.adminPayments({ q: query, status: status || undefined, limit: limit, offset: page * limit }),
          rideOnApi.adminRefunds({ status: status || undefined, limit: limit, offset: page * limit }),
          rideOnApi.adminSecurityDeposits({ q: query, status: status || undefined, limit: limit, offset: page * limit })
        ]);
        setFinance({ payments: result[0], refunds: result[1], deposits: result[2] });
        setData(null);
      } else {
        let result = null;
        const params = { q: query || undefined, limit: limit, offset: page * limit };
        if (section === 'bookings') result = await rideOnApi.adminBookings({ ...params, status: status || undefined });
        if (section === 'users') result = await rideOnApi.adminUsers({ ...params, role: status === 'customer' || status === 'vendor' || status === 'support' || status === 'admin' ? status : undefined, status: status === 'active' || status === 'suspended' ? status : undefined });
        if (section === 'vendors') result = await rideOnApi.adminVendors({ ...params, status: status || undefined });
        if (section === 'vehicles') result = await rideOnApi.adminVehicles({ ...params, active: status === 'active' ? 'true' : status === 'inactive' ? 'false' : undefined });
        if (section === 'support') result = await rideOnApi.adminSupportTickets({ ...params, status: status || undefined });
        if (section === 'reviews') result = await rideOnApi.adminReviews({ ...params, rating: rating || undefined, moderationStatus: moderation || undefined });
        if (section === 'deliveries') result = await rideOnApi.adminDeliveries({ ...params, status: status || 'active' });
        if (section === 'audit') result = await rideOnApi.adminAuditLogs(params);
        setData(result);
        setDashboard(null);
        setFinance(null);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [section, query, status, page, rating, moderation]);

  useEffect(() => {
    setPage(0);
    setQuery('');
    setStatus('');
    setRating('');
    setModeration('');
    setSelected(null);
  }, [section]);

  useEffect(() => {
    load(false);
  }, [load]);

  const title = NAV.find(item => item[0] === section);
  const sectionTitle = title ? title[1] : 'Operations';

  const items = section === 'bookings' ? ((data && data.bookings) || [])
    : section === 'users' ? ((data && data.users) || [])
    : section === 'vendors' ? ((data && data.vendors) || [])
    : section === 'vehicles' ? ((data && data.vehicles) || [])
    : section === 'support' ? ((data && data.tickets) || [])
    : section === 'reviews' ? ((data && data.reviews) || [])
    : section === 'deliveries' ? ((data && data.deliveries) || [])
    : section === 'audit' ? ((data && data.auditLogs) || [])
    : [];

  const pagination = (data && data.pagination) || null;

  async function open(type, id) {
    setDetailLoading(true);
    setError('');
    try {
      let result = null;
      if (type === 'booking') result = await rideOnApi.adminBooking(id);
      if (type === 'user') result = await rideOnApi.adminUser(id);
      if (type === 'vendor') result = await rideOnApi.adminVendor(id);
      if (type === 'vehicle') result = await rideOnApi.adminVehicle(id);
      setSelected({ type: type, result: result });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshAfterAction() {
    await load(true);
  }

  function confirmUser(item) {
    if (!canMutate) {
      setError('Only admin accounts may change account status.');
      return;
    }
    const next = item.accountStatus === 'suspended' ? 'active' : 'suspended';
    Alert.alert(next === 'suspended' ? 'Suspend user?' : 'Reactivate user?', 'The server will enforce the account restriction.', [
      { text: 'Cancel', style: 'cancel' },
      { text: next === 'suspended' ? 'Suspend' : 'Reactivate', style: next === 'suspended' ? 'destructive' : 'default', onPress: async () => {
        try {
          await rideOnApi.adminUserStatus(item.id, next);
          await refreshAfterAction();
        } catch (e) {
          setError(errorText(e));
        }
      }}
    ]);
  }

  async function toggleVendor(item) {
    if (!canMutate) return setError('Only admin accounts may change vendor status.');
    try {
      await rideOnApi.adminVendorStatus(item.id, item.status === 'suspended' ? 'approved' : 'suspended');
      await refreshAfterAction();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function toggleVehicle(item) {
    if (!canMutate) return setError('Only admin accounts may change vehicle activation.');
    try {
      await rideOnApi.adminVehicleStatus(item.id, !Boolean(item.active));
      await refreshAfterAction();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function moderate(item) {
    if (!canMutate) return setError('Only admin accounts may moderate reviews.');
    const next = item.moderationStatus === 'hidden' ? 'visible' : 'hidden';
    if (next === 'hidden') {
      if (Platform.OS === 'ios' && Alert.prompt) {
        Alert.prompt('Moderation reason', 'Document why this review is being hidden.', async reason => {
          try {
            await rideOnApi.adminReviewModeration(item.id, 'hidden', String(reason || '').trim() || 'Policy moderation');
            await refreshAfterAction();
          } catch (e) {
            setError(errorText(e));
          }
        });
      } else {
        try {
          await rideOnApi.adminReviewModeration(item.id, 'hidden', 'Policy moderation');
          await refreshAfterAction();
        } catch (e) {
          setError(errorText(e));
        }
      }
      return;
    }
    Alert.alert('Restore review?', 'The review will become visible again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: async () => {
        try {
          await rideOnApi.adminReviewModeration(item.id, 'visible', 'Moderation reversed by admin');
          await refreshAfterAction();
        } catch (e) {
          setError(errorText(e));
        }
      }}
    ]);
  }

  async function supportStatus(ticket, next) {
    try {
      await rideOnApi.adminSupportStatus(ticket.id, { status: next, resolution: next === 'resolved' ? 'Resolved by RideOn Operations.' : undefined });
      await refreshAfterAction();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function sendSupport(ticket) {
    if (!supportMessage.trim()) return setError('Enter a support message.');
    try {
      await rideOnApi.adminSupportMessage(ticket.id, supportMessage.trim(), supportInternal);
      setSupportMessage('');
      await refreshAfterAction();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function assignSupport(ticket) {
    if (!supportAssignee.trim()) return setError('Enter the support staff user UUID.');
    try {
      await rideOnApi.adminSupportAssign(ticket.id, supportAssignee.trim());
      setSupportAssignee('');
      await refreshAfterAction();
    } catch (e) {
      setError(errorText(e));
    }
  }

  function renderOverview() {
    const m = (dashboard && dashboard.metrics) || {};
    return <View>
      <Text style={styles.pageTitle}>Operations overview</Text>
      <Text style={styles.pageSub}>Live database metrics from RideOn marketplace systems.</Text>
      <View style={styles.metricGrid}>
        <Metric label="Customers" value={m.totalCustomers} />
        <Metric label="Vendors" value={m.totalVendors} />
        <Metric label="Vehicles" value={m.totalVehicles} />
        <Metric label="Bookings" value={m.totalBookings} />
        <Metric label="Active bookings" value={m.activeBookings} />
        <Metric label="Completed bookings" value={m.completedBookings} />
        <Metric label="Cancelled bookings" value={m.cancelledBookings} />
        <Metric label="Pending payments" value={m.pendingPayments} />
        <Metric label="Paid bookings" value={m.paidBookings} />
        <Metric label="Refunds pending" value={m.refundsPending} />
        <Metric label="Security deposits held" value={m.securityDepositsHeld} detail={money(m.securityDepositsHeldAmount)} />
        <Metric label="Open support tickets" value={m.openSupportTickets} />
        <Metric label="Active deliveries" value={m.activeDeliveries} />
      </View>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Recent activity</Text>
          <Pressable onPress={() => setSection('audit')}><Text style={styles.link}>Open audit log</Text></Pressable>
        </View>
        {dashboard && dashboard.recentActivity && dashboard.recentActivity.length ? dashboard.recentActivity.map(item =>
          <View key={item.entityId + String(item.occurredAt)} style={styles.activity}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardStrong}>{item.summary}</Text>
              <Text style={styles.muted}>{item.action} · {new Date(item.occurredAt).toLocaleString()}</Text>
            </View>
            <Badge value={item.type} />
          </View>
        ) : <Empty title="No recent activity" message="New booking, support and payment activity will appear here." />}
      </View>
    </View>;
  }

  function renderFinance() {
    const payments = finance && finance.payments ? finance.payments.payments || [] : [];
    const refunds = finance && finance.refunds ? finance.refunds.refunds || [] : [];
    const deposits = finance && finance.deposits ? finance.deposits.securityDeposits || [] : [];
    return <View>
      <Text style={styles.pageTitle}>Financial operations</Text>
      <Text style={styles.pageSub}>Read-only operational visibility. Financial state remains controlled by the existing payment, refund and security-deposit services.</Text>
      <Text style={styles.sectionLabel}>PAYMENTS</Text>
      {payments.length ? payments.map(item =>
        <View key={item.id} style={styles.rowCard}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardStrong}>{item.customer ? item.customer.name : 'Customer'} · Booking {String(item.bookingId).slice(0, 8)}</Text>
              <Text style={styles.muted}>{item.provider} · {item.id}</Text>
            </View>
            <View style={styles.right}>
              <Badge value={item.status} />
              <Text style={styles.price}>{money(item.amount)}</Text>
            </View>
          </View>
          <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString()} · Provider reference: {item.providerReference || '—'}</Text>
        </View>
      ) : <Empty title="No payments" />}
      <Text style={styles.sectionLabel}>REFUNDS</Text>
      {refunds.length ? refunds.map(item =>
        <View key={item.id} style={styles.rowCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardStrong}>Refund {String(item.id).slice(0, 8)} · Booking {String(item.bookingId).slice(0, 8)}</Text>
            <View style={styles.right}><Badge value={item.status} /><Text style={styles.price}>{money(item.amount)}</Text></View>
          </View>
          <Text style={styles.muted}>{item.provider} · {item.customer ? item.customer.name : 'Customer'}</Text>
        </View>
      ) : <Empty title="No refund transactions" />}
      <Text style={styles.sectionLabel}>SECURITY DEPOSITS</Text>
      {deposits.length ? deposits.map(item =>
        <View key={item.id} style={styles.rowCard}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardStrong}>Booking {String(item.bookingId).slice(0, 8)} · {item.customer ? item.customer.name : 'Customer'}</Text>
              <Text style={styles.muted}>{item.provider || 'Provider not recorded'} · {item.disputeStatus || 'No dispute'}</Text>
            </View>
            <View style={styles.right}><Badge value={item.status} /><Text style={styles.price}>{money(item.originalAmount)}</Text></View>
          </View>
          <Text style={styles.muted}>Refundable {money(item.refundableAmount)} · Deduction {money(item.deduction)}</Text>
        </View>
      ) : <Empty title="No security deposits" />}
    </View>;
  }

  function renderList() {
    if (!items.length) return <Empty />;
    return <View style={{ gap: 10 }}>
      {items.map((item, index) => {
        const id = item.id || item.bookingId || item.trackingSessionId || String(index);
        const type = section === 'bookings' ? 'booking' : section === 'users' ? 'user' : section === 'vendors' ? 'vendor' : section === 'vehicles' ? 'vehicle' : '';
        const clickable = Boolean(type);
        let titleText = id;
        let metaText = '';
        if (section === 'bookings') {
          titleText = 'Booking ' + String(item.id).slice(0, 8);
          metaText = (item.customer ? item.customer.name : 'Customer') + ' · ' + (item.vehicle ? item.vehicle.name : 'Vehicle') + ' · ' + new Date(item.startAt).toLocaleDateString();
        } else if (section === 'users') {
          titleText = item.fullName || item.email || item.id;
          metaText = (item.email || item.phone || '') + ' · ' + item.role + ' · ' + item.bookingCount + ' bookings';
        } else if (section === 'vendors') {
          titleText = item.businessName;
          metaText = item.serviceCity + ' · ' + item.vehicleCount + ' vehicles · ' + item.bookingCount + ' bookings';
        } else if (section === 'vehicles') {
          titleText = item.name;
          metaText = (item.make || '') + ' ' + (item.model || '') + ' · ' + item.city + ' · ' + item.bookingCount + ' bookings';
        } else if (section === 'support') {
          titleText = item.subject;
          metaText = (item.ticketNumber || item.id) + ' · ' + item.category + ' · ' + item.priority;
        } else if (section === 'reviews') {
          titleText = String(item.rating) + '/5 · ' + (item.comment || 'No comment');
          metaText = (item.reviewType || '') + ' · ' + (item.vehicleName || 'Vehicle');
        } else if (section === 'deliveries') {
          titleText = 'Booking ' + String(item.bookingId).slice(0, 8);
          metaText = (item.customer ? item.customer.name : 'Customer') + ' · ' + (item.vendor ? item.vendor.name : 'Vendor') + ' · ' + (item.vehicle ? item.vehicle.name : 'Vehicle');
        } else if (section === 'audit') {
          titleText = item.action;
          metaText = item.entityType + ' · ' + (item.entityId || '—');
        }
        const state = item.status || item.accountStatus || item.moderationStatus || item.deliveryStatus || (section === 'vehicles' ? (item.active ? 'active' : 'inactive') : '');
        return <View key={id} style={styles.rowCard}>
          <Pressable onPress={() => clickable && open(type, id)} disabled={!clickable}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.cardStrong}>{titleText}</Text>
                <Text style={styles.muted}>{metaText}</Text>
              </View>
              <View style={styles.right}><Badge value={state} /></View>
            </View>
          </Pressable>
          {section === 'bookings' ? <View style={styles.metaLine}><Text style={styles.muted}>{item.payment ? item.payment.provider : 'No payment'} · {item.paymentStatus}</Text><Text style={styles.price}>{money(item.payment ? item.payment.amount : item.total)}</Text></View> : null}
          {section === 'users' && canMutate && (item.role === 'customer' || item.role === 'vendor') ?
            <View style={styles.actions}><Pressable style={styles.smallButton} onPress={() => confirmUser(item)}><Text style={styles.smallButtonText}>{item.accountStatus === 'suspended' ? 'Reactivate' : 'Suspend'}</Text></Pressable></View> : null}
          {section === 'vendors' && canMutate ?
            <View style={styles.actions}><Pressable style={styles.smallButton} onPress={() => toggleVendor(item)}><Text style={styles.smallButtonText}>{item.status === 'suspended' ? 'Reactivate' : 'Suspend'}</Text></Pressable></View> : null}
          {section === 'vehicles' && canMutate ?
            <View style={styles.actions}><Pressable style={styles.smallButton} onPress={() => toggleVehicle(item)}><Text style={styles.smallButtonText}>{item.active ? 'Deactivate' : 'Activate'}</Text></Pressable></View> : null}
          {section === 'reviews' && canMutate ?
            <View style={styles.actions}><Pressable style={styles.smallButton} onPress={() => moderate(item)}><Text style={styles.smallButtonText}>{item.moderationStatus === 'hidden' ? 'Restore' : 'Hide'}</Text></Pressable></View> : null}
          {section === 'support' ?
            <View style={styles.actions}><Pressable style={styles.smallButton} onPress={() => supportStatus(item, 'in_progress')}><Text style={styles.smallButtonText}>In progress</Text></Pressable><Pressable style={styles.smallButton} onPress={() => supportStatus(item, 'resolved')}><Text style={styles.smallButtonText}>Resolve</Text></Pressable></View> : null}
          {section === 'deliveries' ?
            <Text style={item.isStale ? styles.danger : styles.muted}>{item.lastLocation && item.lastLocation.latitude != null ? item.lastLocation.latitude.toFixed(5) + ', ' + item.lastLocation.longitude.toFixed(5) : 'No recent location'} · {item.isStale ? 'Stale GPS' : item.etaMinutes ? String(item.etaMinutes) + ' min ETA' : 'ETA unavailable'}</Text> : null}
          {section === 'support' ?
            <View style={styles.supportBox}>
              <TextInput value={supportAssignee} onChangeText={setSupportAssignee} placeholder="Support assignee UUID" placeholderTextColor="#A0A7B1" style={styles.input} />
              <TextInput value={supportMessage} onChangeText={setSupportMessage} placeholder="Reply or internal note" placeholderTextColor="#A0A7B1" multiline style={[styles.input, styles.multiline]} />
              <Pressable style={styles.checkRow} onPress={() => setSupportInternal(!supportInternal)}><Text style={styles.check}>{supportInternal ? '☑' : '☐'}</Text><Text style={styles.body}>Internal note</Text></Pressable>
              <View style={styles.actions}>
                <Pressable style={styles.button} onPress={() => assignSupport(item)}><Text style={styles.buttonText}>Assign</Text></Pressable>
                <Pressable style={styles.buttonSecondary} onPress={() => sendSupport(item)}><Text style={styles.buttonSecondaryText}>Send reply</Text></Pressable>
              </View>
            </View> : null}
        </View>;
      })}
    </View>;
  }

  function renderSelected() {
    if (!selected) return null;
    const result = selected.result || {};
    const body = result.booking || result.user || result.vendor || result.vehicle || {};
    const close = () => setSelected(null);
    return <View style={styles.overlay}>
      <Pressable style={styles.overlayShade} onPress={close} />
      <View style={[styles.detailPanel, desktop ? styles.detailPanelDesktop : null]}>
        <View style={styles.detailHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pageTitle}>{selected.type.charAt(0).toUpperCase() + selected.type.slice(1)} detail</Text>
            <Text style={styles.muted}>{body.id || ''}</Text>
          </View>
          <Pressable onPress={close}><Text style={styles.close}>×</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.detailScroll}>
          {selected.type === 'booking' ? <View>
            <Detail label="Customer" value={body.customer && body.customer.name + ' · ' + (body.customer.email || '')} />
            <Detail label="Vendor" value={body.vendor && body.vendor.name} />
            <Detail label="Vehicle" value={body.vehicle && body.vehicle.name + ' · ' + (body.vehicle.registrationNumber || '')} />
            <Detail label="Lifecycle" value={(result.lifecycle || []).map(x => x.nextStatus + ' · ' + x.actorType).join('\n') || 'No lifecycle events'} />
            <Detail label="Payment" value={result.payment ? result.payment.status + ' · ' + money(result.payment.amount) + ' · ' + result.payment.provider : 'No payment record'} />
            <Detail label="Refunds" value={(result.refundTransactions || []).map(x => x.status + ' · ' + money(x.amount)).join('\n') || 'No refund transactions'} />
            <Detail label="Security deposit" value={result.securityDeposit ? result.securityDeposit.status + ' · ' + money(result.securityDeposit.originalAmount) + ' · refundable ' + money(result.securityDeposit.refundableAmount) : 'No deposit record'} />
            <Detail label="Delivery" value={body.deliveryStatus + ' · ' + (body.deliveredAt ? new Date(body.deliveredAt).toLocaleString() : 'Not delivered')} />
            <Detail label="Support tickets" value={(result.supportTickets || []).map(x => (x.ticketNumber || x.id) + ' · ' + x.status).join('\n') || 'No linked tickets'} />
            <Detail label="Reviews" value={(result.reviews || []).map(x => x.rating + '/5 · ' + (x.comment || '')).join('\n') || 'No reviews'} />
          </View> : null}
          {selected.type === 'user' ? <View>
            <Detail label="Profile" value={(body.fullName || '') + '\n' + (body.email || '') + '\n' + (body.phone || '')} />
            <Detail label="Account status" value={body.accountStatus || 'active'} />
            <Detail label="Recent bookings" value={(result.recentBookings || []).map(x => String(x.id).slice(0, 8) + ' · ' + x.status).join('\n') || 'No bookings'} />
            <Detail label="Support tickets" value={(result.tickets || []).map(x => (x.ticketNumber || x.id) + ' · ' + x.status).join('\n') || 'No tickets'} />
            <Detail label="Reviews" value={(result.reviews || []).map(x => x.rating + '/5 · ' + (x.comment || '')).join('\n') || 'No reviews'} />
            {result.vendorProfile ? <Detail label="Vendor profile" value={result.vendorProfile.businessName + ' · ' + result.vendorProfile.status} /> : null}
          </View> : null}
          {selected.type === 'vendor' ? <View>
            <Detail label="Vendor" value={(body.businessName || '') + '\n' + (body.serviceCity || '') + '\n' + (body.status || '')} />
            <Detail label="Vehicles" value={String((result.vehicles || []).length)} />
            <Detail label="Recent bookings" value={(result.bookings || []).map(x => String(x.id).slice(0, 8) + ' · ' + x.status).join('\n') || 'No bookings'} />
            <Detail label="Reviews" value={(result.reviews || []).map(x => x.rating + '/5 · ' + (x.comment || '')).join('\n') || 'No reviews'} />
          </View> : null}
          {selected.type === 'vehicle' ? <View>
            <Detail label="Vehicle" value={(body.name || '') + '\n' + (body.city || '') + '\n' + (body.registrationNumber || '')} />
            <Detail label="Owner" value={result.vendor && (result.vendor.name || result.vendor.businessName) || 'Marketplace inventory'} />
            <Detail label="Booking history" value={(result.bookings || []).map(x => String(x.id).slice(0, 8) + ' · ' + x.status).join('\n') || 'No bookings'} />
          </View> : null}
        </ScrollView>
      </View>
    </View>;
  }

  function filterButtons() {
    let options = [''];
    if (section === 'users') options = ['', 'customer', 'vendor', 'support', 'admin', 'active', 'suspended'];
    if (section === 'vendors') options = ['', 'pending', 'approved', 'suspended', 'rejected'];
    if (section === 'vehicles') options = ['', 'active', 'inactive'];
    if (section === 'support') options = ['', 'open', 'in_progress', 'waiting_for_user', 'resolved', 'closed'];
    if (section === 'deliveries') options = ['', 'active', 'completed', 'aborted', 'expired'];
    if (section === 'bookings') options = ['', 'requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rejected'];
    if (section === 'finance') options = ['', 'pending', 'paid', 'refund_pending', 'refunded', 'failed', 'held', 'settled'];
    return <View style={styles.pills}>{options.map(item =>
      <Pressable key={item || 'all'} onPress={() => { setStatus(item); setPage(0); }} style={[styles.pill, status === item && styles.pillActive]}>
        <Text style={[styles.pillText, status === item && styles.pillTextActive]}>{item || 'All'}</Text>
      </Pressable>
    )}</View>;
  }

  function renderReviewsFilters() {
    if (section !== 'reviews') return null;
    return <View style={styles.filtersExtra}>
      <Text style={styles.filterLabel}>RATING</Text>
      <View style={styles.pills}>{['', '1', '2', '3', '4', '5'].map(item =>
        <Pressable key={item || 'rating-all'} onPress={() => setRating(item)} style={[styles.pill, rating === item && styles.pillActive]}>
          <Text style={[styles.pillText, rating === item && styles.pillTextActive]}>{item ? item + '★' : 'All'}</Text>
        </Pressable>
      )}</View>
      <Text style={styles.filterLabel}>MODERATION</Text>
      <View style={styles.pills}>{['', 'visible', 'hidden'].map(item =>
        <Pressable key={item || 'moderation-all'} onPress={() => setModeration(item)} style={[styles.pill, moderation === item && styles.pillActive]}>
          <Text style={[styles.pillText, moderation === item && styles.pillTextActive]}>{item || 'All'}</Text>
        </Pressable>
      )}</View>
    </View>;
  }

  return <SafeAreaView style={styles.safe}>
    <View style={[styles.shell, desktop ? styles.desktopShell : null]}>
      {desktop ? <View style={styles.sidebar}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>ride<Text style={{ color: C.orange }}>on.</Text></Text>
          <Text style={styles.brandSub}>OPERATIONS CONSOLE</Text>
        </View>
        <ScrollView>
          {NAV.map(item =>
            <Pressable key={item[0]} onPress={() => setSection(item[0])} style={[styles.navItem, section === item[0] && styles.navItemActive]}>
              <Text style={[styles.navText, section === item[0] && styles.navTextActive]}>{item[1]}</Text>
            </Pressable>
          )}
        </ScrollView>
        <View style={styles.staff}>
          <Text style={styles.staffName}>{user && user.name ? user.name : 'RideOn operator'}</Text>
          <Badge value={user && user.role} />
          <Pressable style={styles.logout} onPress={onLogout}><Text style={styles.logoutText}>Sign out</Text></Pressable>
        </View>
      </View> : null}
      <View style={styles.main}>
        {!desktop ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileNav}>
          {NAV.map(item =>
            <Pressable key={item[0]} onPress={() => setSection(item[0])} style={[styles.mobileNavItem, section === item[0] && styles.mobileNavItemActive]}>
              <Text style={[styles.mobileNavText, section === item[0] && styles.mobileNavTextActive]}>{item[1]}</Text>
            </Pressable>
          )}
        </ScrollView> : null}
        <View style={styles.toolbar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>RIDEON OPS</Text>
            <Text style={styles.headerTitle}>{sectionTitle}</Text>
          </View>
          <Pressable style={styles.refresh} onPress={() => load(true)}><Text style={styles.refreshText}>↻</Text></Pressable>
          {!desktop ? <Pressable onPress={onLogout}><Text style={styles.muted}>Sign out</Text></Pressable> : null}
        </View>

        {section !== 'overview' ? <View style={styles.filters}>
          <TextInput value={query} onChangeText={value => { setQuery(value); setPage(0); }} placeholder="Search" placeholderTextColor="#A0A7B1" style={styles.input} />
          {filterButtons()}
          {renderReviewsFilters()}
        </View> : null}

        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.muted}>Loading operations data…</Text></View> :
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          >
            {section === 'overview' ? renderOverview() : section === 'finance' ? renderFinance() : renderList()}
            {pagination ? <View style={styles.pagination}>
              <Pressable disabled={!page} onPress={() => setPage(page - 1)} style={[styles.pageButton, !page && styles.disabled]}><Text>Previous</Text></Pressable>
              <Text style={styles.muted}>Page {page + 1} · {pagination.total || 0} total</Text>
              <Pressable disabled={!pagination.hasNext} onPress={() => setPage(page + 1)} style={[styles.pageButton, !pagination.hasNext && styles.disabled]}><Text>Next</Text></Pressable>
            </View> : null}
          </ScrollView>
        }
      </View>
    </View>
    {detailLoading ? <View style={styles.busy}><ActivityIndicator color="#fff" /><Text style={styles.busyText}>Loading detail…</Text></View> : null}
    {renderSelected()}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  shell: { flex: 1 },
  desktopShell: { flexDirection: 'row' },
  sidebar: { width: 245, backgroundColor: C.navy, padding: 18 },
  brandBlock: { paddingVertical: 8, marginBottom: 20 },
  brand: { fontSize: 32, fontWeight: '900', color: C.white, letterSpacing: -1.7 },
  brandSub: { fontSize: 9, letterSpacing: 1.5, fontWeight: '900', color: '#98A6B8', marginTop: 2 },
  navItem: { paddingVertical: 12, paddingHorizontal: 13, borderRadius: 10, marginBottom: 4 },
  navItemActive: { backgroundColor: '#243247' },
  navText: { fontSize: 12, fontWeight: '800', color: '#AEB9C6' },
  navTextActive: { color: C.white },
  staff: { borderTopWidth: 1, borderTopColor: '#304054', paddingTop: 15, gap: 8 },
  staffName: { fontSize: 12, fontWeight: '900', color: C.white },
  logout: { borderWidth: 1, borderColor: '#46566C', borderRadius: 9, paddingVertical: 8, alignItems: 'center' },
  logoutText: { fontSize: 11, fontWeight: '800', color: C.white },
  main: { flex: 1, minWidth: 0 },
  mobileNav: { padding: 10, gap: 7 },
  mobileNavItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  mobileNavItemActive: { backgroundColor: C.navy, borderColor: C.navy },
  mobileNavText: { fontSize: 10, fontWeight: '900', color: C.ink },
  mobileNavTextActive: { color: C.white },
  toolbar: { minHeight: 74, paddingHorizontal: 22, paddingVertical: 15, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 12 },
  kicker: { fontSize: 8, letterSpacing: 1.5, fontWeight: '900', color: C.orange },
  headerTitle: { fontSize: 28, fontWeight: '900', color: C.ink, letterSpacing: -.8 },
  refresh: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  refreshText: { fontSize: 23, color: C.ink },
  filters: { padding: 14, paddingBottom: 3 },
  input: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: C.ink, minHeight: 42, marginBottom: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 6 },
  pill: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  pillActive: { backgroundColor: C.navy, borderColor: C.navy },
  pillText: { fontSize: 10, fontWeight: '800', color: C.muted, textTransform: 'capitalize' },
  pillTextActive: { color: C.white },
  filtersExtra: { marginTop: 2 },
  filterLabel: { fontSize: 9, letterSpacing: 1.2, fontWeight: '900', color: C.muted, marginTop: 4 },
  content: { padding: 20, paddingBottom: 50, maxWidth: 1450, width: '100%', alignSelf: 'center' },
  pageTitle: { fontSize: 28, fontWeight: '900', letterSpacing: -.8, color: C.ink },
  pageSub: { fontSize: 13, color: C.muted, marginTop: 5, marginBottom: 18, lineHeight: 19 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  metric: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 15, width: '31%', minWidth: 165 },
  metricLabel: { fontSize: 10, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: .5 },
  metricValue: { fontSize: 26, fontWeight: '900', color: C.ink, marginTop: 5 },
  metricDetail: { fontSize: 10, color: C.green, fontWeight: '800', marginTop: 3 },
  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 16, marginBottom: 16 },
  rowCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 15, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: C.ink },
  cardStrong: { fontSize: 13, fontWeight: '900', color: C.ink },
  muted: { fontSize: 11, color: C.muted, lineHeight: 17 },
  body: { fontSize: 13, color: C.ink },
  link: { fontSize: 11, fontWeight: '900', color: C.orange },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  right: { alignItems: 'flex-end', gap: 5 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  metaLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line },
  price: { fontSize: 14, fontWeight: '900', color: C.ink },
  badge: { fontSize: 9, fontWeight: '900', textTransform: 'capitalize', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  badgeGreen: { backgroundColor: '#EAF6F0', color: C.green },
  badgeRed: { backgroundColor: '#FFF0F0', color: C.red },
  badgeYellow: { backgroundColor: '#FFF4DE', color: C.yellow },
  badgeGray: { backgroundColor: '#EDF1F4', color: C.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  smallButtonText: { fontSize: 10, fontWeight: '900', color: C.ink },
  button: { backgroundColor: C.navy, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10 },
  buttonText: { color: C.white, fontSize: 11, fontWeight: '900' },
  buttonSecondary: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10 },
  buttonSecondaryText: { color: C.ink, fontSize: 11, fontWeight: '900' },
  supportBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
  check: { fontSize: 20, color: C.orange },
  sectionLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: '900', color: C.orange, marginTop: 17, marginBottom: 8 },
  empty: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 15, padding: 24, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '900', color: C.ink, marginBottom: 4 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 20 },
  pageButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
  disabled: { opacity: .45 },
  error: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#F2CCCC', borderRadius: 12, padding: 12, margin: 14 },
  errorText: { fontSize: 12, fontWeight: '700', color: C.red },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60 },
  danger: { color: C.red, fontSize: 11, fontWeight: '800' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', justifyContent: 'flex-end' },
  overlayShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#09111ACC' },
  detailPanel: { backgroundColor: C.bg, width: '92%', paddingTop: 0 },
  detailPanelDesktop: { width: 620 },
  detailHeader: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 18, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center' },
  detailScroll: { padding: 18, paddingBottom: 40 },
  detailBlock: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 13, padding: 13, marginBottom: 10 },
  detailLabel: { fontSize: 9, letterSpacing: 1.1, fontWeight: '900', color: C.muted, marginBottom: 5 },
  detailValue: { fontSize: 12, color: C.ink, lineHeight: 18 },
  close: { fontSize: 31, color: C.ink, lineHeight: 32 },
  busy: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#17202DCC', alignItems: 'center', justifyContent: 'center', gap: 10 },
  busyText: { color: C.white, fontSize: 12, fontWeight: '800' }
});
