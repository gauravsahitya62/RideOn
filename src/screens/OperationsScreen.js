import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { rideOnApi } from '../services/api';

const COLORS = {
  bg: '#F6F7F9',
  white: '#FFFFFF',
  ink: '#17202D',
  muted: '#78818E',
  line: '#E8EAF0',
  orange: '#E85D35',
  green: '#228A60',
  red: '#B23B3B',
};

const LIFECYCLE_LABELS = {
  CONFIRMED: 'Confirmed',
  DELIVERY_ASSIGNED: 'Delivery Assigned',
  PICKUP_ASSIGNED: 'Pickup Assigned',
  DELIVERY_STARTED: 'On the Way',
  READY_FOR_PICKUP: 'Ready for Pickup',
  HANDED_OVER: 'Vehicle Handed Over',
  ACTIVE_RENTAL: 'Rental Active',
  RETURN_REQUESTED: 'Return Requested',
  RETURNED: 'Vehicle Returned',
  INSPECTION: 'Under Inspection',
  DAMAGE_REVIEW_REQUIRED: 'Damage Review',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function lifecycleLabel(value) {
  const key = String(value || '').toUpperCase();
  return LIFECYCLE_LABELS[key] || key.replaceAll('_', ' ') || '—';
}

function StatCard({label, value}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{String(value ?? 0)}</Text>
    </View>
  );
}

function ActionButton({label, onPress, disabled, secondary}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, secondary && styles.actionSecondary, disabled && styles.actionDisabled]}
    >
      <Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function OperationsScreen({ user, onLogout }) {
  const [dashboard, setDashboard] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [damageCases, setDamageCases] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [dashResponse, bookingResponse, damageResponse] = await Promise.all([
        rideOnApi.getFleetOpsDashboard(),
        rideOnApi.getFleetOpsBookings(),
        rideOnApi.listFleetDamageCases({ status: 'reported,under_review,approved' }),
      ]);
      setDashboard(dashResponse?.dashboard || {});
      setBookings(bookingResponse?.bookings || bookingResponse?.data || []);
      setDamageCases(damageResponse?.cases || damageResponse?.data || []);
    } catch (err) {
      setError(err?.message || 'Operations data is temporarily unavailable.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const runAction = useCallback(async (key, task) => {
    setBusy(key);
    setError('');
    try {
      await task();
      await load();
    } catch (err) {
      setError(err?.message || 'Operation failed. No state was changed by the client.');
    } finally {
      setBusy('');
    }
  }, [load]);

  const counts = useMemo(() => {
    const d = dashboard || {};
    return {
      pickups: d.todayPickups ?? d.pickupsToday ?? 0,
      deliveries: d.todayDeliveries ?? d.deliveriesToday ?? 0,
      active: d.activeRentals ?? 0,
      returns: d.todayExpectedReturns ?? d.expectedReturnsToday ?? 0,
      overdue: d.overdueRentals ?? 0,
      inspection: d.vehiclesAwaitingInspection ?? d.awaitingInspection ?? 0,
      damage: d.damageReviews ?? damageCases.length,
      deposits: d.depositsAwaitingSettlement ?? 0,
    };
  }, [dashboard, damageCases.length]);

  const bookingList = useMemo(() => bookings.slice(0, 50), [bookings]);

  const promptInspection = (booking) => {
    const vehicleId = booking.vehicleId || booking.vehicle?.id;
    if (!vehicleId) {
      setError('This booking has no vehicle identifier.');
      return;
    }
    Alert.prompt(
      'Return Inspection',
      'Enter return odometer. Leave blank to use the stored value.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Inspect',
          onPress: (value) => {
            const odometer = String(value || '').trim();
            runAction('inspection:' + booking.id, () =>
              rideOnApi.createFleetOpsInspection(vehicleId, {
                bookingId: booking.id || booking.bookingId,
                inspectionType: 'return',
                ...(odometer ? {odometer: Number(odometer)} : {}),
                inspectionStatus: 'passed',
                damageNotes: '',
                conditionPhotos: [],
              })
            );
          },
        },
      ],
      'plain-text'
    );
  };

  const requestHandover = (booking) => {
    runAction('handover:' + booking.id, () =>
      rideOnApi.createFleetOpsHandover(booking.id || booking.bookingId, {
        customerConfirmed: true,
        odometer: booking.vehicle?.currentOdometer ?? undefined,
        fuelBattery: booking.vehicle?.currentFuelBattery ?? undefined,
      })
    );
  };

  const recordReturn = (booking) => {
    runAction('return:' + booking.id, () =>
      rideOnApi.createFleetOpsReturn(booking.id || booking.bookingId, {
        returnLocation: booking.returnLocation || booking.address || null,
        returnedCondition: '',
        damageNotes: '',
        evidencePhotos: [],
      })
    );
  };

  const requestDeposit = (booking) => {
    runAction('deposit:' + booking.id, () =>
      rideOnApi.settleFleetDeposit(booking.id || booking.bookingId, {
        deductionPaise: 0,
        reason: '',
        evidenceReference: '',
      })
    );
  };

  const confirmDeposit = (settlementId) => {
    Alert.prompt(
      'Provider Confirmation',
      'Enter the real payment-provider confirmation reference.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Confirm',
          onPress: (providerReference) => {
            const value = String(providerReference || '').trim();
            if (!value) {
              setError('A real provider confirmation reference is required.');
              return;
            }
            runAction('settlement-confirm:' + settlementId, () =>
              rideOnApi.confirmFleetDepositSettlement(settlementId, {providerReference: value})
            );
          },
        },
      ],
      'plain-text'
    );
  };

  const updateDamage = (caseItem, nextStatus) => {
    runAction('damage:' + caseItem.id, () =>
      rideOnApi.updateFleetDamageCase(caseItem.id, {status: nextStatus})
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>ride<Text style={styles.brandDot}>.on</Text></Text>
            <Text style={styles.eyebrow}>OPERATIONS</Text>
          </View>
          <TouchableOpacity onPress={onLogout} style={styles.signOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.identity}>
          <Text style={styles.identityTitle}>Fleet operations</Text>
          <Text style={styles.identityText}>
            Signed in as {String(user?.role || '').replaceAll('_', ' ')}.
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Today</Text>
        <View style={styles.statsGrid}>
          <StatCard label="Pickups" value={counts.pickups} />
          <StatCard label="Deliveries" value={counts.deliveries} />
          <StatCard label="Active rentals" value={counts.active} />
          <StatCard label="Expected returns" value={counts.returns} />
          <StatCard label="Overdue" value={counts.overdue} />
          <StatCard label="Inspection" value={counts.inspection} />
          <StatCard label="Damage reviews" value={counts.damage} />
          <StatCard label="Deposit settlement" value={counts.deposits} />
        </View>

        <Text style={styles.sectionTitle}>Rental operations</Text>
        {bookingList.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No rental operations in the queue.</Text>
            <Text style={styles.emptyText}>Refresh to check for newly assigned work.</Text>
          </View>
        ) : bookingList.map((booking, index) => {
          const id = booking.id || booking.bookingId || String(index);
          const state = String(booking.lifecycleState || booking.lifecycle_state || '').toUpperCase();
          const settlement = booking.depositSettlement || booking.deposit_settlement;
          const canHandover = ['CONFIRMED', 'DELIVERY_ASSIGNED', 'PICKUP_ASSIGNED', 'DELIVERY_STARTED', 'READY_FOR_PICKUP'].includes(state);
          const canReturn = ['RETURN_REQUESTED', 'ACTIVE_RENTAL', 'OVERDUE'].includes(state);
          const canInspect = ['RETURNED', 'INSPECTION'].includes(state);
          const canSettle = ['INSPECTION', 'DAMAGE_REVIEW_REQUIRED'].includes(state);
          const pendingSettlement = settlement?.status && settlement.status !== 'confirmed';

          return (
            <View style={styles.bookingCard} key={id}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.bookingTitle}>
                    {booking.vehicle?.name || booking.vehicleName || 'RideOn vehicle'}
                  </Text>
                  <Text style={styles.muted}>Booking {String(id)}</Text>
                </View>
                <Text style={styles.statePill}>{lifecycleLabel(state)}</Text>
              </View>

              <Text style={styles.detail}>Start: {formatDate(booking.startAt || booking.start_at)}</Text>
              <Text style={styles.detail}>Return: {formatDate(booking.endAt || booking.end_at)}</Text>
              <Text style={styles.detail}>Customer: {booking.customerName || booking.customer?.fullName || 'Customer'}</Text>

              <View style={styles.actions}>
                {canHandover && <ActionButton
                  disabled={busy === 'handover:' + id}
                  label={busy === 'handover:' + id ? 'Handing over…' : 'Confirm handover'}
                  onPress={() => requestHandover(booking)}
                />}
                {canReturn && <ActionButton
                  secondary
                  disabled={busy === 'return:' + id}
                  label={busy === 'return:' + id ? 'Recording…' : 'Record return'}
                  onPress={() => recordReturn(booking)}
                />}
                {canInspect && <ActionButton
                  secondary
                  disabled={busy === 'inspection:' + id}
                  label={busy === 'inspection:' + id ? 'Inspecting…' : 'Perform inspection'}
                  onPress={() => promptInspection(booking)}
                />}
                {canSettle && !pendingSettlement && <ActionButton
                  secondary
                  disabled={busy === 'deposit:' + id}
                  label={busy === 'deposit:' + id ? 'Requesting…' : 'Request deposit settlement'}
                  onPress={() => requestDeposit(booking)}
                />}
                {pendingSettlement && settlement?.id && (
                  <ActionButton
                    disabled={busy === 'settlement-confirm:' + settlement.id}
                    label={busy === 'settlement-confirm:' + settlement.id ? 'Confirming…' : 'Confirm provider settlement'}
                    onPress={() => confirmDeposit(settlement.id)}
                  />
                )}
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Damage reviews</Text>
        {damageCases.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No open damage reviews.</Text>
          </View>
        ) : damageCases.slice(0, 30).map((item) => (
          <View style={styles.bookingCard} key={item.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.bookingTitle}>Damage case {String(item.id).slice(0, 8)}</Text>
              <Text style={styles.statePill}>{lifecycleLabel(item.status)}</Text>
            </View>
            <Text style={styles.detail}>{item.description || 'Damage details not provided.'}</Text>
            <Text style={styles.detail}>Estimated: ₹{(Number(item.estimatedAmountPaise || 0) / 100).toFixed(2)}</Text>
            <View style={styles.actions}>
              {item.status === 'reported' && <ActionButton
                disabled={busy === 'damage:' + item.id}
                label="Start review"
                onPress={() => updateDamage(item, 'under_review')}
              />}
              {item.status === 'under_review' && <ActionButton
                disabled={busy === 'damage:' + item.id}
                label="Approve review"
                onPress={() => updateDamage(item, 'approved')}
              />}
              {['approved', 'disputed'].includes(String(item.status)) && <ActionButton
                secondary
                disabled={busy === 'damage:' + item.id}
                label="Resolve"
                onPress={() => updateDamage(item, 'resolved')}
              />}
            </View>
          </View>
        ))}

        <View style={styles.boundaryBox}>
          <Text style={styles.boundaryTitle}>Financial safety</Text>
          <Text style={styles.boundaryText}>
            Deposit settlement remains pending until a real provider confirmation is recorded. The app never marks a refund or deduction successful on an operator tap alone.
          </Text>
        </View>

        <ActionButton secondary disabled={!dashboard || !!busy} label={busy ? 'Working…' : 'Refresh operations'} onPress={onRefresh} />
        {busy && <ActivityIndicator style={{marginTop: 14}} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 18, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  brand: { fontSize: 31, fontWeight: '900', letterSpacing: -1.6, color: COLORS.ink },
  brandDot: { color: COLORS.orange },
  eyebrow: { fontSize: 9, letterSpacing: 1.4, fontWeight: '900', color: COLORS.muted, marginTop: 2 },
  signOut: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, backgroundColor: COLORS.white },
  signOutText: { fontSize: 11, fontWeight: '800', color: COLORS.ink },
  identity: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, padding: 16, marginBottom: 16 },
  identityTitle: { fontSize: 19, fontWeight: '900', color: COLORS.ink },
  identityText: { fontSize: 12, color: COLORS.muted, marginTop: 5 },
  errorBox: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#F4CCCC', borderRadius: 13, padding: 12, marginBottom: 16 },
  errorText: { fontSize: 12, fontWeight: '700', color: COLORS.red, lineHeight: 17 },
  sectionTitle: { fontSize: 21, fontWeight: '900', color: COLORS.ink, letterSpacing: -0.4, marginTop: 8, marginBottom: 11 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statCard: { width: '48%', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 14 },
  statLabel: { fontSize: 10, fontWeight: '800', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 25, fontWeight: '900', color: COLORS.ink, marginTop: 4 },
  empty: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, padding: 18, marginBottom: 14 },
  emptyTitle: { fontSize: 14, fontWeight: '900', color: COLORS.ink },
  emptyText: { fontSize: 11, color: COLORS.muted, marginTop: 5 },
  bookingCard: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, padding: 16, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1 },
  bookingTitle: { fontSize: 15, fontWeight: '900', color: COLORS.ink },
  muted: { fontSize: 10, color: COLORS.muted, marginTop: 3 },
  detail: { fontSize: 11, color: COLORS.muted, lineHeight: 17, marginTop: 6 },
  statePill: { fontSize: 9, fontWeight: '900', color: COLORS.green, backgroundColor: '#EAF6F0', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6, overflow: 'hidden' },
  actions: { gap: 8, marginTop: 12 },
  actionButton: { backgroundColor: COLORS.orange, borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  actionSecondary: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line },
  actionText: { color: COLORS.white, fontSize: 12, fontWeight: '900' },
  actionSecondaryText: { color: COLORS.ink },
  actionDisabled: { opacity: 0.55 },
  boundaryBox: { backgroundColor: '#FFF8EE', borderWidth: 1, borderColor: '#F1DFC0', borderRadius: 17, padding: 16, marginTop: 8, marginBottom: 14 },
  boundaryTitle: { fontSize: 12, fontWeight: '900', color: COLORS.ink },
  boundaryText: { fontSize: 11, color: COLORS.muted, lineHeight: 17, marginTop: 6 },
});
