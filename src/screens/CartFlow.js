import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const INK = '#12161C';
const MUTED = '#6B7280';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const LINE = '#E6E8EC';
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const imageOf = (vehicle) => (vehicle?.images || []).find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
const kindOf = (vehicle) => {
  const type = String(vehicle?.type || '').toLowerCase();
  if (type === 'car') return 'Car';
  if (String(vehicle?.fleetVehicleClass || '').toLowerCase() === 'scooter') return 'Scooter';
  if (type === 'bike') return 'Bike';
  return '';
};

export default function CartFlow({ view = 'cart', items, quote, dates, location, busy, error, onBack, onClear, onRemove, onDates, onLocation, onQuote, onPay, onEditCart }) {
  const [pickupDate, setPickupDate] = useState(dates?.pickupDate || '');
  const [pickupTime, setPickupTime] = useState(dates?.pickupTime || '10:00');
  const [returnDate, setReturnDate] = useState(dates?.returnDate || '');
  const [returnTime, setReturnTime] = useState(dates?.returnTime || '10:00');
  const [place, setPlace] = useState(location || '');
  const lines = quote?.items || [];
  const days = quote?.days || dates?.days || '';
  const count = items.length;

  const saveDates = () => onDates?.({ pickupDate, pickupTime, returnDate, returnTime });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backMark}>‹</Text></TouchableOpacity>
        {view === 'cart' ? <>
          <View style={styles.header}><Text style={styles.title}>Your Cart</Text><TouchableOpacity onPress={onClear} accessibilityRole="button"><Text style={styles.clear}>Clear Cart</Text></TouchableOpacity></View>
          <Text style={styles.subtitle}>{count === 0 ? 'No vehicles in the cart.' : `${count} vehicle${count === 1 ? '' : 's'} added to your cart.`}</Text>
          {items.map(vehicle => {
            const line = lines.find(item => String(item.vehicleId) === String(vehicle.id));
            const specs = [kindOf(vehicle), vehicle.fuel, vehicle.transmission].filter(Boolean).join(' • ');
            return (
              <View key={vehicle.id} style={styles.item}>
                <View style={styles.photo}>{imageOf(vehicle) ? <Image source={{ uri: imageOf(vehicle) }} style={styles.photoImage} /> : <Text>🛵</Text>}</View>
                <View style={styles.copy}>
                  <Text style={styles.name}>{vehicle.name}</Text>
                  {!!specs && <Text style={styles.meta}>{specs}</Text>}
                  {!!vehicle.registrationNumber && <Text style={styles.meta}>{vehicle.registrationNumber}</Text>}
                  <Text style={styles.meta}>{line ? money(line.rental) : `${money(vehicle.price || vehicle.pricePerDay)}/day`}</Text>
                </View>
                <TouchableOpacity onPress={() => onRemove?.(vehicle.id)} accessibilityRole="button" accessibilityLabel={`Remove ${vehicle.name}`}><Text style={styles.remove}>Remove</Text></TouchableOpacity>
              </View>
            );
          })}
          <Text style={styles.label}>Pickup date</Text>
          <TextInput value={pickupDate} onChangeText={setPickupDate} onEndEditing={saveDates} placeholder="YYYY-MM-DD" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.label}>Pickup time</Text>
          <TextInput value={pickupTime} onChangeText={setPickupTime} onEndEditing={saveDates} placeholder="HH:mm" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.label}>Return date</Text>
          <TextInput value={returnDate} onChangeText={setReturnDate} onEndEditing={saveDates} placeholder="YYYY-MM-DD" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.label}>Return time</Text>
          <TextInput value={returnTime} onChangeText={setReturnTime} onEndEditing={saveDates} placeholder="HH:mm" placeholderTextColor="#A0A7B1" style={styles.input} />
          <Text style={styles.label}>Pickup location</Text>
          <TextInput value={place} onChangeText={setPlace} onEndEditing={() => onLocation?.(place)} placeholder="Pickup location" placeholderTextColor="#A0A7B1" style={styles.input} />
          {!!quote && <View style={styles.card}>
            <Text style={styles.section}>Price Details</Text>
            <Line label={`Rental${days ? ` (${count} vehicles${days ? `, ${days} days` : ''})` : ''}`} value={money(quote.rentalSubtotal)} />
            <Line label="Security Deposit" value={money(quote.securityDeposit)} />
            <Line label="Delivery Fee" value={money(quote.deliveryFee)} />
            <Line label="Platform fee" value={money(quote.platformFee)} />
            <Line label="Total Amount" value={money(quote.total)} bold />
          </View>}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} disabled={busy || count < 2} onPress={() => { saveDates(); onLocation?.(place); onQuote?.(); }} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{count < 2 ? 'Add at least 2 vehicles' : 'Proceed to Checkout'}</Text>}
          </TouchableOpacity>
        </> : <>
          <Text style={styles.title}>Checkout</Text>
          <Text style={styles.subtitle}>Review the booking details and confirm.</Text>
          <Text style={styles.section}>Vehicles ({count})</Text>
          <TouchableOpacity onPress={onEditCart} accessibilityRole="button"><Text style={styles.link}>Edit Cart</Text></TouchableOpacity>
          {items.map(vehicle => {
            const line = lines.find(item => String(item.vehicleId) === String(vehicle.id));
            return (
              <View key={vehicle.id} style={styles.item}>
                <View style={styles.copy}>
                  <Text style={styles.name}>{vehicle.name}</Text>
                  <Text style={styles.meta}>{[kindOf(vehicle), vehicle.fuel].filter(Boolean).join(' • ')}</Text>
                  {!!vehicle.registrationNumber && <Text style={styles.meta}>{vehicle.registrationNumber}</Text>}
                </View>
                <Text style={styles.name}>{line ? money(line.total) : ''}</Text>
              </View>
            );
          })}
          <View style={styles.card}>
            <Text style={styles.section}>Pickup & Return</Text>
            <Text style={styles.name}>{location || 'Add a pickup location'}</Text>
            <Text style={styles.meta}>Pickup and return use this location.</Text>
          </View>
          {!!quote && <View style={styles.card}>
            <Line label="Rental Amount" value={money(quote.rentalSubtotal)} />
            <Line label="Security Deposit" value={money(quote.securityDeposit)} />
            <Line label="Delivery Fee" value={money(quote.deliveryFee)} />
            <Line label="Platform fee" value={money(quote.platformFee)} />
            <Line label="Total Amount" value={money(quote.total)} bold />
          </View>}
          <View style={styles.card}><Text style={styles.section}>Payment</Text><Text style={styles.meta}>Cashfree checkout collects the payment. RideOn confirms it after the provider verifies the payment.</Text></View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} disabled={busy || !quote} onPress={onPay} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Confirm & Pay {quote ? money(quote.total) : ''}</Text>}
          </TouchableOpacity>
        </>}
      </ScrollView>
    </View>
  );
}

function Line({ label, value, bold }) {
  return <View style={styles.line}><Text style={[styles.meta, bold && styles.bold]}>{label}</Text><Text style={[styles.name, bold && styles.bold]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFFFFF'},
  page:{padding:22,paddingBottom:36},
  back:{width:36,height:36,justifyContent:'center'},
  backMark:{fontSize:32,color:INK,lineHeight:34},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  title:{fontSize:30,fontWeight:'800',color:INK},
  clear:{color:'#D92D20',fontWeight:'800'},
  subtitle:{color:MUTED,marginTop:4,marginBottom:14},
  item:{flexDirection:'row',gap:10,alignItems:'center',borderWidth:1,borderColor:LINE,borderRadius:16,padding:12,marginBottom:10},
  photo:{width:64,height:48,borderRadius:8,backgroundColor:'#F4F6F8',alignItems:'center',justifyContent:'center',overflow:'hidden'},
  photoImage:{width:64,height:48},
  copy:{flex:1},
  name:{fontSize:15,fontWeight:'800',color:INK},
  meta:{color:MUTED,fontSize:13,marginTop:2},
  remove:{color:'#D92D20',fontWeight:'700'},
  label:{fontWeight:'700',color:INK,marginTop:8,marginBottom:6},
  input:{height:48,borderWidth:1,borderColor:LINE,borderRadius:12,paddingHorizontal:12,color:INK},
  card:{borderWidth:1,borderColor:LINE,borderRadius:16,padding:14,marginTop:12},
  section:{fontSize:16,fontWeight:'800',color:INK,marginBottom:6},
  line:{flexDirection:'row',justifyContent:'space-between',paddingVertical:3},
  bold:{color:INK,fontWeight:'800',fontSize:16},
  button:{height:54,borderRadius:14,backgroundColor:BUTTON,alignItems:'center',justifyContent:'center',marginTop:16},
  buttonText:{color:'#FFFFFF',fontWeight:'800',fontSize:16},
  error:{color:'#B42318',fontWeight:'700',marginTop:10},
  link:{color:GREEN,fontWeight:'800',marginBottom:8},
});
