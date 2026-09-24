import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ReviewsSection } from '../components';

const COLORS = { ink: '#17202D', muted: '#78818E', orange: '#E85D35', bg: '#F6F7F9', line: '#E8EAF0', white: '#FFFFFF' };
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

/**
 * Reusable vehicle details view. Pass the selected API vehicle, the existing
 * checkout callback, and optional date/location/quote context from RideOnApp.
 * Images are rendered only when the API supplies image URLs.
 */
export default function VehicleDetailScreen({
  vehicle,
  onBack,
  onBook,
  pickupDate,
  returnDate,
  location,
  quote,
  quoteLoading = false,
  quoteError,
  onRetryQuote,
  onEditDates,
  onEditLocation,
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  const images = useMemo(() => {
    if (!vehicle) return [];
    const raw = Array.isArray(vehicle.images) ? vehicle.images : [];
    const candidates = [...raw, vehicle.image, vehicle.imageUrl, vehicle.photoUrl]
      .filter(value => typeof value === 'string' && /^https?:\/\//i.test(value));
    return [...new Set(candidates)];
  }, [vehicle]);

  if (!vehicle) {
    return <View style={styles.empty}><Text style={styles.heading}>Vehicle unavailable</Text><Text style={styles.muted}>Return to Explore and select a vehicle again.</Text><Action title="Back to Explore" onPress={onBack} /></View>;
  }

  const specs = [
    ['Category', asText(vehicle.type)],
    ['Brand', asText(vehicle.brand)],
    ['Model', asText(vehicle.model)],
    ['Transmission', asText(vehicle.transmission)],
    ['Fuel', asText(vehicle.fuel)],
    ['Seats', vehicle.seats ? `${vehicle.seats} seats` : null],
    ['Engine', asText(vehicle.engine ?? vehicle.engineCapacity)],
    ['Mileage / range', asText(vehicle.mileage ?? vehicle.range)],
  ].filter(([, value]) => value);
  const description = asText(vehicle.description ?? vehicle.detail);
  const features = Array.isArray(vehicle.features) ? vehicle.features.filter(item => typeof item === 'string' && item.trim()) : [];
  const rentalDays = Number(quote?.days ?? quote?.pricing?.days);
  const rentalSubtotal = quote?.rental ?? quote?.pricing?.rental;
  const quoteTotal = quote?.total ?? quote?.totalPrice ?? quote?.pricing?.total;
  const quoteIsEstimate = Boolean(quote?.disclaimer || quote?.estimate || quote?.pricing?.disclaimer);

  const moveImage = delta => setActiveImage(current => (current + delta + images.length) % images.length);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backGlyph}>‹</Text></TouchableOpacity>
        <Text style={styles.topTitle}>Vehicle details</Text><View style={{ width: 42 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.gallery}>
          {images.length ? <TouchableOpacity activeOpacity={0.95} onPress={() => setImageViewerOpen(true)} accessibilityRole="button" accessibilityLabel="Open larger vehicle image">
            <FastImage uri={images[Math.min(activeImage, images.length - 1)]} style={styles.heroImage} />
          </TouchableOpacity> : <View style={styles.imageFallback}><Text style={styles.fallbackIcon}>{vehicle.emoji || '🚘'}</Text><Text style={styles.muted}>Vehicle image not provided</Text></View>}
          {images.length > 1 && <View style={styles.galleryControls}>
            <TouchableOpacity onPress={() => moveImage(-1)} style={styles.galleryButton} accessibilityRole="button" accessibilityLabel="Previous image"><Text style={styles.galleryGlyph}>‹</Text></TouchableOpacity>
            <Text style={styles.imageCount}>{activeImage + 1} / {images.length}</Text>
            <TouchableOpacity onPress={() => moveImage(1)} style={styles.galleryButton} accessibilityRole="button" accessibilityLabel="Next image"><Text style={styles.galleryGlyph}>›</Text></TouchableOpacity>
          </View>}
        </View>

        <Text style={styles.eyebrow}>{[vehicle.brand, vehicle.type, vehicle.city].filter(Boolean).join(' · ').toUpperCase()}</Text>
        <Text style={styles.heading}>{vehicle.name || [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Selected vehicle'}</Text>
        <View style={styles.priceRow}><Text style={styles.price}>{money(vehicle.price ?? vehicle.pricePerDay)}</Text><Text style={styles.perDay}>/ day</Text></View>
        <Text style={styles.notice}>Date-specific availability is not confirmed on this screen. Continue to the existing booking quote step for server validation.</Text>

        {(pickupDate || returnDate || location) && <View style={styles.summaryCard}>
          <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Your trip</Text><TouchableOpacity onPress={onEditDates || onEditLocation}><Text style={styles.link}>Edit</Text></TouchableOpacity></View>
          {(pickupDate || returnDate) && <Text style={styles.summaryText}>{pickupDate || 'Pickup date not set'}  →  {returnDate || 'Return date not set'}{Number.isFinite(rentalDays) && rentalDays > 0 ? ` · ${rentalDays} day${rentalDays === 1 ? '' : 's'}` : ''}</Text>}
          {location && <Text style={styles.summaryText}>{location}</Text>}
        </View>}

        {specs.length > 0 && <View style={styles.section}>
          <Text style={styles.sectionTitle}>Specifications</Text>
          <View style={styles.specGrid}>{specs.map(([label, value]) => <View key={label} style={styles.specCell}><Text style={styles.specLabel}>{label}</Text><Text style={styles.specValue} numberOfLines={2}>{value}</Text></View>)}</View>
        </View>}

        {description && <View style={styles.section}>
          <Text style={styles.sectionTitle}>About this vehicle</Text>
          <Text style={styles.description} numberOfLines={descriptionExpanded ? undefined : 4}>{description}</Text>
          {description.length > 180 && <TouchableOpacity onPress={() => setDescriptionExpanded(value => !value)} accessibilityRole="button"><Text style={styles.link}>{descriptionExpanded ? 'Show less' : 'Read more'}</Text></TouchableOpacity>}
        </View>}

        {features.length > 0 && <View style={styles.section}><Text style={styles.sectionTitle}>Features</Text><View style={styles.features}>{features.map((feature, index) => <View key={`${feature}-${index}`} style={styles.feature}><Text style={styles.featureDot}>•</Text><Text style={styles.featureText}>{feature}</Text></View>)}</View></View>}

        <ReviewsSection vehicleId={vehicle.id} title="Vehicle reviews" onWriteReview={onWriteReview}/>
        {vehicle.vendorId ? <ReviewsSection vendorId={vehicle.vendorId} title={vehicle.vendorName ? vehicle.vendorName+' · reviews' : 'Vendor reviews'} compact onWriteReview={onWriteReview}/> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pickup & delivery</Text>
          <Text style={styles.description}>Pickup or doorstep delivery is subject to the options accepted in checkout. Enter a location there and review any server-provided fee before submitting your booking.</Text>
          {location && <Text style={styles.summaryText}>Selected location: {location}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rental estimate</Text>
          <View style={styles.priceLine}><Text style={styles.muted}>Daily rental</Text><Text style={styles.specValue}>{money(vehicle.price ?? vehicle.pricePerDay)}</Text></View>
          {rentalSubtotal != null && <View style={styles.priceLine}><Text style={styles.muted}>Rental subtotal{Number.isFinite(rentalDays) && rentalDays > 0 ? ` · ${rentalDays} days` : ''}</Text><Text style={styles.specValue}>{money(rentalSubtotal)}</Text></View>}
          {quote?.deliveryFee != null && <View style={styles.priceLine}><Text style={styles.muted}>Delivery fee</Text><Text style={styles.specValue}>{money(quote.deliveryFee)}</Text></View>}
          {quote?.platformFee != null && <View style={styles.priceLine}><Text style={styles.muted}>Platform fee</Text><Text style={styles.specValue}>{money(quote.platformFee)}</Text></View>}
          {quoteTotal != null && <View style={[styles.priceLine, styles.totalLine]}><Text style={styles.totalLabel}>Quote total</Text><Text style={styles.totalPrice}>{money(quoteTotal)}</Text></View>}
          {quoteIsEstimate && <Text style={styles.notice}>Estimate only — not a confirmed final charge.</Text>}
          {quoteError && <View style={styles.errorBox}><Text style={styles.errorText}>{quoteError}</Text>{onRetryQuote && <Action title="Retry quote" onPress={onRetryQuote} />}</View>}
          {quoteLoading && <Text style={styles.muted}>Checking quote…</Text>}
        </View>
      </ScrollView>
      <View style={styles.footer}><View style={{ flex: 1 }}><Text style={styles.footerLabel}>Starting at</Text><Text style={styles.footerPrice}>{money(vehicle.price ?? vehicle.pricePerDay)}<Text style={styles.perDay}> / day</Text></Text></View><Action title="Continue to booking →" onPress={() => onBook?.(vehicle)} disabled={!vehicle.id || quoteLoading} /></View>

      <Modal visible={imageViewerOpen} transparent animationType="fade" onRequestClose={() => setImageViewerOpen(false)}>
        <View style={styles.viewer}><TouchableOpacity style={styles.viewerClose} onPress={() => setImageViewerOpen(false)} accessibilityRole="button" accessibilityLabel="Close image viewer"><Text style={styles.viewerCloseText}>✕</Text></TouchableOpacity>
          {images.length > 0 && <FastImage uri={images[Math.min(activeImage, images.length - 1)]} style={styles.viewerImage} resizeMode="contain" />}
          {images.length > 1 && <View style={styles.viewerControls}><Action title="‹ Previous" ghost onPress={() => moveImage(-1)} /><Text style={styles.imageCount}>{activeImage + 1} / {images.length}</Text><Action title="Next ›" ghost onPress={() => moveImage(1)} /></View>}
        </View>
      </Modal>
    </View>
  );
}

function Action({ title, onPress, ghost = false, disabled = false }) {
  return <TouchableOpacity onPress={onPress} disabled={disabled || !onPress} accessibilityRole="button" style={[styles.action, ghost && styles.actionGhost, (disabled || !onPress) && styles.disabled]}><Text style={[styles.actionText, ghost && styles.actionGhostText]}>{title}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { height: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 32, color: COLORS.ink, lineHeight: 34 }, topTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink },
  content: { padding: 18, paddingBottom: 32 }, gallery: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#E9ECF1', marginBottom: 20 }, heroImage: { width: '100%', height: 250, backgroundColor: '#E9ECF1' }, imageFallback: { height: 220, alignItems: 'center', justifyContent: 'center', gap: 8 }, fallbackIcon: { fontSize: 76 }, galleryControls: { position: 'absolute', bottom: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, galleryButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFFE8', alignItems: 'center', justifyContent: 'center' }, galleryGlyph: { fontSize: 27, color: COLORS.ink }, imageCount: { color: COLORS.ink, backgroundColor: '#FFFFFFE8', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
  eyebrow: { color: COLORS.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 }, heading: { color: COLORS.ink, fontSize: 27, lineHeight: 33, fontWeight: '900' }, priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 12, marginBottom: 12 }, price: { fontSize: 27, color: COLORS.ink, fontWeight: '900' }, perDay: { color: COLORS.muted, fontSize: 12, fontWeight: '600' }, muted: { color: COLORS.muted, fontSize: 12, lineHeight: 18 }, notice: { color: '#7B5526', backgroundColor: '#FFF5E8', borderRadius: 12, padding: 12, fontSize: 11, lineHeight: 16, marginTop: 8 },
  section: { backgroundColor: COLORS.white, borderRadius: 18, padding: 16, marginTop: 14, borderWidth: 1, borderColor: COLORS.line }, sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '900', marginBottom: 12 }, summaryCard: { backgroundColor: COLORS.white, borderRadius: 18, padding: 16, marginTop: 16, borderWidth: 1, borderColor: COLORS.line }, summaryText: { color: COLORS.ink, fontSize: 12, lineHeight: 19, marginTop: 4 }, link: { color: COLORS.orange, fontSize: 12, fontWeight: '900', paddingVertical: 5 }, specGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, specCell: { width: '47%', minHeight: 62, backgroundColor: COLORS.bg, borderRadius: 12, padding: 11 }, specLabel: { color: COLORS.muted, fontSize: 10, marginBottom: 5 }, specValue: { color: COLORS.ink, fontSize: 12, fontWeight: '800' }, description: { color: '#535D6A', fontSize: 13, lineHeight: 21 }, features: { gap: 8 }, feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, featureDot: { color: COLORS.orange, fontSize: 18, lineHeight: 20 }, featureText: { flex: 1, color: '#535D6A', fontSize: 12, lineHeight: 19 }, priceLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 }, totalLine: { borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: 5, paddingTop: 14 }, totalLabel: { color: COLORS.ink, fontSize: 13, fontWeight: '900' }, totalPrice: { color: COLORS.ink, fontSize: 20, fontWeight: '900' }, errorBox: { marginTop: 10, backgroundColor: '#FFF0F0', borderRadius: 12, padding: 12 }, errorText: { color: '#A22', fontSize: 12, lineHeight: 18 },
  footer: { padding: 14, paddingBottom: 18, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.line, flexDirection: 'row', alignItems: 'center', gap: 12 }, footerLabel: { color: COLORS.muted, fontSize: 10 }, footerPrice: { color: COLORS.ink, fontSize: 18, fontWeight: '900' }, action: { backgroundColor: COLORS.orange, borderRadius: 14, paddingHorizontal: 17, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' }, actionText: { color: COLORS.white, fontSize: 12, fontWeight: '900' }, actionGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.line }, actionGhostText: { color: COLORS.ink }, disabled: { opacity: 0.45 }, empty: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  viewer: { flex: 1, backgroundColor: '#0B0E13', justifyContent: 'center', padding: 14 }, viewerImage: { width: '100%', height: '70%' }, viewerClose: { position: 'absolute', top: 48, right: 22, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' }, viewerCloseText: { color: '#FFFFFF', fontSize: 20 }, viewerControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
});
