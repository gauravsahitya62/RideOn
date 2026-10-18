import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ReviewsSection } from '../components';

const COLORS = { ink: '#111827', muted: '#6B7280', orange: '#E56A3D', bg: '#F7F5F1', line: '#E7E2DA', white: '#FFFFFF' };
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const asText = value => value == null || value === '' ? null : String(value);
const optimizeVehicleImageUrl = (url, width = 1200) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^(.*\/storage\/v1\/)object\/public\/(.+)$/);
    if (!match) return url;
    const query = new URLSearchParams(parsed.search);
    query.set('width', String(width));
    query.set('quality', '78');
    return `${parsed.origin}${match[1]}render/image/public/${match[2]}${query.toString() ? `?${query.toString()}` : ''}`;
  } catch { return url; }
};
const FastImage = ({ uri, style, resizeMode = 'cover' }) => {
  const [sourceUri, setSourceUri] = useState(() => optimizeVehicleImageUrl(uri));
  const [loading, setLoading] = useState(Boolean(uri));
  const [failed, setFailed] = useState(!uri);
  useEffect(() => {
    setSourceUri(optimizeVehicleImageUrl(uri));
    setLoading(Boolean(uri));
    setFailed(!uri);
  }, [uri]);
  if (!uri || failed) return null;
  return <View style={{position:'relative'}}>
    <Image source={{uri:sourceUri,cache:'force-cache'}} style={style} resizeMode={resizeMode}
      onLoadStart={()=>setLoading(true)} onLoad={()=>setLoading(false)}
      onError={()=>{
        if(sourceUri !== uri){setSourceUri(uri);setLoading(true);}
        else {setLoading(false);setFailed(true);}
      }}/>
    {loading && <View style={{position:'absolute',left:0,right:0,top:0,bottom:0,alignItems:'center',justifyContent:'center'}}><ActivityIndicator size="small" color={COLORS.orange}/></View>}
  </View>;
};

export default function VehicleDetailScreen({
  vehicle,
  onBack,
  onBook,
  onAddToCart,
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
  location,
  quote,
  quoteLoading = false,
  quoteError,
  onRetryQuote,
  onEditDates,
  onEditLocation,
  onWriteReview,
  saved = false,
  onToggleSave,
  selectedDays = 1,
  onSelectDays,
  availability,
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const images = useMemo(() => {
    if (!vehicle) return [];
    const raw = Array.isArray(vehicle.images) ? vehicle.images : [];
    return [...new Set([...raw, vehicle.image, vehicle.imageUrl, vehicle.photoUrl].filter(value => typeof value === 'string' && /^https?:\/\//i.test(value)))];
  }, [vehicle]);

  if (!vehicle) {
    return <View style={styles.empty}><Text style={styles.heading}>Vehicle unavailable</Text><Text style={styles.muted}>Return to Home and select a vehicle again.</Text><TouchableOpacity style={styles.book} onPress={onBack}><Text style={styles.bookText}>Back</Text></TouchableOpacity></View>;
  }

  const daily = Number(vehicle.price ?? vehicle.pricePerDay) || 0;
  const quoteTotal = quote?.total ?? quote?.totalPrice ?? quote?.pricing?.total;
  const chips = [asText(vehicle.fuel), asText(vehicle.transmission), vehicle.seats ? `${vehicle.seats} seats` : null, asText(vehicle.type)].filter(Boolean);
  const moveImage = delta => setActiveImage(current => (current + delta + images.length) % images.length);
  const share = () => Share.share({ message: `${vehicle.name} · ${money(daily)} a day on RideOn` }).catch(() => {});

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroWrap}>
        {images.length ? <TouchableOpacity activeOpacity={0.95} onPress={() => setImageViewerOpen(true)}><FastImage uri={images[Math.min(activeImage, images.length - 1)]} style={styles.heroImage} /></TouchableOpacity> : <View style={styles.imageFallback}><Text style={styles.fallbackIcon}>{vehicle.emoji || '🛵'}</Text></View>}
        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.round} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back"><Text style={styles.roundText}>←</Text></TouchableOpacity>
          <View style={styles.heroRight}>
            <TouchableOpacity style={styles.round} onPress={onToggleSave} accessibilityRole="button" accessibilityLabel="Save vehicle"><Text style={styles.roundText}>{saved ? '♥' : '♡'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.round} onPress={share} accessibilityRole="button" accessibilityLabel="Share vehicle"><Text style={styles.roundText}>↗</Text></TouchableOpacity>
          </View>
        </View>
        {images.length > 0 && <View style={styles.count}><Text style={styles.countText}>{Math.min(activeImage, images.length - 1) + 1}/{images.length}</Text></View>}
      </View>

      {images.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
        {images.map((uri, index) => <TouchableOpacity key={uri} onPress={() => setActiveImage(index)} style={[styles.thumb, index === activeImage && styles.thumbOn]}><FastImage uri={uri} style={styles.thumbImage} /></TouchableOpacity>)}
      </ScrollView>}

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>{vehicle.name || 'Selected vehicle'}</Text>
          <Text style={styles.subline}>{[vehicle.type, vehicle.fuel, vehicle.transmission].filter(Boolean).join('  ·  ') || 'RideOn vehicle'}</Text>
          {!!vehicle.registrationNumber && <Text style={styles.subline}>{vehicle.registrationNumber}</Text>}
        </View>
        <Text style={styles.daily}>{money(daily)}<Text style={styles.per}>/day</Text></Text>
      </View>

      {!!chips.length && <View style={styles.specRow}>
        {chips.map(chip => <View key={chip} style={styles.spec}><Text style={styles.specText}>{chip}</Text></View>)}
      </View>}

      <View style={[styles.banner, availability?.available && styles.bannerOn]}>
        <Text style={styles.bannerTitle}>{availability?.available ? 'Available for your dates' : 'Selected dates'}</Text>
        <Text style={styles.bannerBody}>{formatWhen(pickupDate, pickupTime)} – {formatWhen(returnDate, returnTime)}</Text>
      </View>

      {vehicle.deliveryAvailable ? <View style={styles.deliveryBanner}>
        <Text style={styles.bannerTitle}>Delivery can be added</Text>
        <Text style={styles.bannerBody}>{deliveryFeeText(quote)}</Text>
      </View> : null}

      {!!vehicle.description && <>
        <Text style={styles.section}>About this vehicle</Text>
        <Text style={styles.description}>{vehicle.description}</Text>
      </>}

      <Text style={styles.section}>Pickup & delivery location</Text>
      <TouchableOpacity style={styles.location} onPress={onEditLocation} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={styles.locationText} numberOfLines={2}>{location || 'Choose a location'}</Text>
        </View>
        <Text style={styles.change}>Change</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Select dates & time</Text>
      <View style={styles.dates}>
        <TouchableOpacity style={styles.dateCard} onPress={onEditDates} accessibilityRole="button">
          <Text style={styles.dateLabel}>Pickup</Text>
          <Text style={styles.dateValue}>{formatWhen(pickupDate, pickupTime)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateCard} onPress={onEditDates} accessibilityRole="button">
          <Text style={styles.dateLabel}>Return</Text>
          <Text style={styles.dateValue}>{formatWhen(returnDate, returnTime)}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Rental length</Text>
      <View style={styles.prices}>
        {[1, 3, 7].map(days => <TouchableOpacity key={days} style={[styles.priceCard, selectedDays === days && styles.priceOn]} onPress={() => onSelectDays?.(days)} accessibilityRole="button">
          <Text style={styles.priceValue}>{days} day{days === 1 ? '' : 's'}</Text>
          <Text style={styles.priceLabel}>{money(daily * days)} before fees</Text>
        </TouchableOpacity>)}
      </View>
      {quoteError ? <TouchableOpacity onPress={onRetryQuote}><Text style={styles.errorText}>{quoteError}</Text></TouchableOpacity> : null}
      {quoteLoading ? <Text style={styles.muted}>Checking the price…</Text> : null}

      <ReviewsSection vehicleId={vehicle.id} title="Vehicle reviews" onWriteReview={onWriteReview}/>
    </ScrollView>

    <View style={styles.footer}>
      {!!onAddToCart && <TouchableOpacity onPress={() => onAddToCart(vehicle)} disabled={!vehicle.id} accessibilityRole="button"><Text style={styles.cartText}>Add to cart</Text></TouchableOpacity>}
      <View style={styles.footerRow}>
        <View style={styles.footerPrice}>
          <Text style={styles.footerDaily}>{money(daily)}<Text style={styles.per}>/day</Text></Text>
          <Text style={styles.footerTotal}>{quoteTotal != null ? `Total  ${money(quoteTotal)}` : 'Total is confirmed on review'}</Text>
        </View>
        <TouchableOpacity style={[styles.book, { flex: 1 }]} onPress={() => onBook?.(vehicle)} disabled={!vehicle.id || quoteLoading} accessibilityRole="button">
          <Text style={styles.bookText}>Book Now  →</Text>
        </TouchableOpacity>
      </View>
    </View>

    <Modal visible={imageViewerOpen} transparent animationType="fade" onRequestClose={() => setImageViewerOpen(false)}>
      <View style={styles.viewer}>
        <TouchableOpacity style={styles.viewerClose} onPress={() => setImageViewerOpen(false)} accessibilityRole="button"><Text style={styles.viewerCloseText}>✕</Text></TouchableOpacity>
        {images.length > 0 && <FastImage uri={images[Math.min(activeImage, images.length - 1)]} style={styles.viewerImage} resizeMode="contain" />}
        {images.length > 1 && <View style={styles.viewerControls}><TouchableOpacity onPress={() => moveImage(-1)}><Text style={styles.viewerNav}>‹</Text></TouchableOpacity><Text style={styles.viewerCount}>{activeImage + 1} / {images.length}</Text><TouchableOpacity onPress={() => moveImage(1)}><Text style={styles.viewerNav}>›</Text></TouchableOpacity></View>}
      </View>
    </Modal>
  </View>;
}

function deliveryFeeText(quote) {
  if (Number(quote?.deliveryFee) > 0) return `Delivery fee on this quote: ${money(quote.deliveryFee)}`;
  return 'Choose delivery and the fee is added to the booking quote.';
}

function formatWhen(date, time) {
  if (!date) return 'Choose date & time';
  const parsed = new Date(`${date}T${time || '10:00'}:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  let hour = parsed.getHours();
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${day} · ${hour}:${String(parsed.getMinutes()).padStart(2, '0')} ${period}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingBottom: 24 },
  heroWrap: { margin: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: '#E8EEF2', height: 250 },
  heroImage: { width: '100%', height: 250 },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackIcon: { fontSize: 72 },
  heroActions: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  heroRight: { flexDirection: 'row', gap: 8 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFFEE', alignItems: 'center', justifyContent: 'center' },
  roundText: { color: COLORS.ink, fontSize: 18, fontWeight: '700' },
  count: { position: 'absolute', left: 12, bottom: 12, backgroundColor: '#111827CC', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  countText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  thumbs: { paddingHorizontal: 12, gap: 8 },
  thumb: { width: 64, height: 48, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: '#07A574' },
  thumbImage: { width: 64, height: 48 },
  titleRow: { paddingHorizontal: 16, marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { color: COLORS.ink, fontSize: 24, fontWeight: '800' },
  subline: { color: '#66707A', marginTop: 4, fontSize: 13 },
  daily: { color: COLORS.ink, fontSize: 20, fontWeight: '800' },
  per: { color: '#7B848E', fontSize: 12, fontWeight: '600' },
  specRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 14 },
  spec: { minWidth: 72, backgroundColor: '#F4F6F8', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10 },
  specText: { color: '#3E4A54', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  banner: { marginHorizontal: 16, marginTop: 14, backgroundColor: '#F4F6F8', borderRadius: 14, padding: 12 },
  bannerOn: { backgroundColor: '#E7F8EC' },
  bannerTitle: { color: '#067A4A', fontWeight: '800' },
  bannerBody: { color: '#3E4A54', marginTop: 4, fontSize: 13 },
  deliveryBanner: { marginHorizontal: 16, marginTop: 10, backgroundColor: '#EEF4FF', borderRadius: 14, padding: 12 },
  description: { marginHorizontal: 16, marginTop: 8, color: '#3E4A54', lineHeight: 20 },
  section: { marginTop: 18, marginHorizontal: 16, color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  prices: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 10 },
  priceCard: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: '#E6E8EC', padding: 10, backgroundColor: '#FFFFFF' },
  priceOn: { backgroundColor: '#E7F8EC', borderColor: '#07A574' },
  priceValue: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  priceLabel: { color: '#66707A', fontSize: 11, marginTop: 4 },
  dates: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 10 },
  dateCard: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: '#E6E8EC', padding: 10 },
  dateLabel: { color: '#7B848E', fontSize: 11 },
  dateValue: { color: COLORS.ink, fontSize: 13, fontWeight: '700', marginTop: 6 },
  location: { marginHorizontal: 16, marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E6E8EC', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationText: { color: COLORS.ink, fontWeight: '700' },
  change: { color: '#07A574', fontWeight: '800' },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEF1F4' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerPrice: { width: 128 },
  footerDaily: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  footerTotal: { color: '#66707A', fontSize: 12, marginTop: 2 },
  cartText: { color: '#067A4A', fontSize: 14, fontWeight: '800', textAlign: 'right', marginBottom: 6 },
  book: { height: 52, borderRadius: 26, backgroundColor: '#07A574', alignItems: 'center', justifyContent: 'center' },
  bookText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  cancelNote: { textAlign: 'center', color: '#8B949E', fontSize: 12, marginTop: 8 },
  muted: { color: COLORS.muted, marginHorizontal: 16, marginTop: 8 },
  errorText: { color: '#B23B3B', marginHorizontal: 16, marginTop: 8 },
  empty: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  viewer: { flex: 1, backgroundColor: '#0B0E13', justifyContent: 'center', padding: 14 },
  viewerImage: { width: '100%', height: '70%' },
  viewerClose: { position: 'absolute', top: 48, right: 22, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  viewerCloseText: { color: '#FFFFFF', fontSize: 20 },
  viewerControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  viewerNav: { color: '#FFFFFF', fontSize: 28, paddingHorizontal: 12 },
  viewerCount: { color: '#FFFFFF', fontWeight: '700' },
});
