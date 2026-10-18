import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const INK = '#12161C';
const MUTED = '#6B7280';
const GREEN = '#067A4A';
const LINE = '#EEF0F3';
const RED = '#E5484D';

const formatPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return String(phone || '').trim();
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
};

const initials = (name) => String(name || '').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

function Row({ icon, label, onPress, last }) {
  return (
    <TouchableOpacity style={[styles.row, !last && styles.rowLine]} onPress={onPress} accessibilityRole="button">
      <Text style={styles.rowIcon}>{icon}</Text>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ name, phone, email, photo, kycStatus, onEdit, onDocuments, onKyc, onAddresses, onPayments, onNotifications, onSupport, onTerms, onSettings, onLogout }) {
  const verified = kycStatus === 'VERIFIED';
  const pending = kycStatus === 'PENDING';
  const title = String(name || '').trim() || 'RideOn account';
  const phoneText = formatPhone(phone);
  const emailText = String(email || '').trim();
  const kycTitle = verified ? 'KYC Verified' : pending ? 'KYC in review' : 'KYC required';
  const kycText = verified
    ? 'You can now book and rent vehicles.'
    : pending
      ? 'RideOn is still confirming your documents.'
      : 'Complete verification before you book a vehicle.';
  const rows = [
    ['☰', 'My Documents', onDocuments],
    ['⌖', 'Saved Locations', onAddresses],
    ['▭', 'Payment Methods', onPayments],
    ['◔', 'Notifications', onNotifications],
    ['?', 'Help & Support', onSupport],
    ['≡', 'Terms & Policies', onTerms],
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={onSettings} accessibilityRole="button" accessibilityLabel="Settings" style={styles.gear}>
          <Text style={styles.gearText}>⚙</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.identity} onPress={onEdit} accessibilityRole="button">
        <View style={styles.avatar}>{photo ? <Image source={{ uri: photo }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initials(title) || 'R'}</Text>}</View>
        <View style={styles.identityCopy}>
          <Text style={styles.name}>{title}</Text>
          {!!phoneText && <Text style={styles.meta}>{phoneText}</Text>}
          {!!emailText && <Text style={styles.meta}>{emailText}</Text>}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.kyc, verified && styles.kycGood]} onPress={onKyc} accessibilityRole="button">
        <View style={[styles.shield, verified && styles.shieldGood]}><Text style={styles.shieldMark}>{verified ? '✓' : '!'}</Text></View>
        <View style={styles.identityCopy}>
          <Text style={styles.kycTitle}>{kycTitle}</Text>
          <Text style={styles.kycText}>{kycText}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
      <View style={styles.menu}>
        {rows.map(([icon, label, onPress], index) => <Row key={label} icon={icon} label={label} onPress={onPress} last={index === rows.length - 1} />)}
      </View>
      <TouchableOpacity style={styles.logout} onPress={onLogout} accessibilityRole="button">
        <Text style={styles.logoutIcon}>↪</Text>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFFFFF'},
  page:{paddingHorizontal:22,paddingTop:8,paddingBottom:28},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:22},
  title:{fontSize:32,fontWeight:'800',color:INK,letterSpacing:-0.6},
  gear:{width:40,height:40,alignItems:'center',justifyContent:'center'},
  gearText:{fontSize:22,color:INK},
  identity:{flexDirection:'row',alignItems:'center',gap:14,marginBottom:18},
  avatar:{width:64,height:64,borderRadius:32,backgroundColor:'#E7F6EF',alignItems:'center',justifyContent:'center'},
  avatarText:{fontSize:20,fontWeight:'800',color:GREEN},
  avatarImage:{width:64,height:64,borderRadius:32},
  identityCopy:{flex:1},
  name:{fontSize:18,fontWeight:'800',color:INK},
  meta:{fontSize:14,color:MUTED,marginTop:2},
  chevron:{fontSize:22,color:'#C5CAD1',fontWeight:'400'},
  kyc:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#F4FBF7',borderRadius:16,padding:14,borderWidth:1,borderColor:'#D9F0E4'},
  kycGood:{backgroundColor:'#F3FBF7'},
  shield:{width:42,height:42,borderRadius:21,backgroundColor:'#E8F7EF',alignItems:'center',justifyContent:'center'},
  shieldGood:{backgroundColor:'#DDF6EA'},
  shieldMark:{fontSize:18,fontWeight:'800',color:GREEN},
  kycTitle:{fontSize:16,fontWeight:'800',color:INK},
  kycText:{fontSize:13,color:MUTED,marginTop:2},
  menu:{marginTop:18},
  row:{flexDirection:'row',alignItems:'center',gap:14,paddingVertical:16},
  rowLine:{borderBottomWidth:1,borderBottomColor:LINE},
  rowIcon:{width:28,fontSize:18,color:'#3C4450',textAlign:'center'},
  rowLabel:{flex:1,fontSize:16,fontWeight:'600',color:INK},
  logout:{marginTop:18,height:52,borderRadius:14,borderWidth:1,borderColor:'#F3C7C9',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  logoutIcon:{fontSize:16,color:RED,fontWeight:'700'},
  logoutText:{fontSize:16,fontWeight:'700',color:RED},
});
