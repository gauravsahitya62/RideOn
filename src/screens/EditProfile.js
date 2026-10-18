import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const MUTED = '#6B7280';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const LINE = '#E6E8EC';
const FIELD = '#F7F8FA';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const digitsOf = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const formatPhone = (value) => {
  const local = digitsOf(value);
  if (!local) return '';
  if (local.length <= 5) return `+91 ${local}`;
  return `+91 ${local.slice(0, 5)} ${local.slice(5, 10)}`;
};

const showDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

export default function EditProfile({ name, phone, email, dateOfBirth, phoneVerified, photo, onBack, onPhoto, onSave }) {
  const [fullName, setFullName] = useState(name || '');
  const [mobile, setMobile] = useState(formatPhone(phone));
  const [dob, setDob] = useState(dateOfBirth || '');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = new Date();
  const initial = String(dob || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [year, setYear] = useState(initial ? Number(initial[1]) : today.getFullYear() - 25);
  const [month, setMonth] = useState(initial ? Number(initial[2]) : today.getMonth() + 1);
  const [day, setDay] = useState(initial ? Number(initial[3]) : 1);
  const originalDigits = digitsOf(phone);
  const currentDigits = digitsOf(mobile);
  const verified = Boolean(phoneVerified) && currentDigits.length === 10 && currentDigits === originalDigits;

  useEffect(() => {
    if (dateOfBirth) return undefined;
    let active = true;
    rideOnApi.getKycStatus().then((result) => {
      if (!active) return;
      const found = (result?.kyc?.documents || []).map(item => item?.display?.dateOfBirth).find(Boolean);
      if (found) setDob(found);
    }).catch(() => {});
    return () => { active = false; };
  }, [dateOfBirth]);

  const changePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError('Allow photo access to change your photo.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]?.uri) {
      onPhoto?.(result.assets[0].uri);
      setError('');
    }
  };

  const confirmDate = () => {
    const max = daysInMonth(year, month);
    const safeDay = Math.min(day, max);
    const next = `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    const chosen = new Date(`${next}T00:00:00`);
    if (Number.isNaN(chosen.getTime()) || chosen > today) return setError('Choose a date of birth that is not in the future.');
    setDob(next);
    setPicker(false);
    setError('');
  };

  const save = async () => {
    if (fullName.trim().length < 2) return setError('Enter your full name.');
    if (currentDigits.length !== 10) return setError('Enter a 10-digit mobile number.');
    setBusy(true);
    setError('');
    try {
      await onSave?.({ name: fullName.trim(), phone: currentDigits, dateOfBirth: dob });
    } catch (e) {
      setError(e?.message || 'Profile could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const years = [];
  for (let value = today.getFullYear(); value >= 1940; value -= 1) years.push(value);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}><Text style={styles.backMark}>‹</Text></TouchableOpacity>
        <Text style={styles.title}>Edit Profile</Text>
        <Text style={styles.subtitle}>Update your personal information.</Text>
        <View style={styles.photoWrap}>
          <View style={styles.avatar}>
            {photo ? <Image source={{ uri: photo }} style={styles.avatarImage} /> : <View style={styles.person}><View style={styles.head} /><View style={styles.shoulders} /></View>}
            <TouchableOpacity style={styles.camera} onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change photo"><Text style={styles.cameraMark}>▣</Text></TouchableOpacity>
          </View>
          <TouchableOpacity onPress={changePhoto} accessibilityRole="button"><Text style={styles.change}>Change Photo</Text></TouchableOpacity>
        </View>
        <Text style={styles.label}>Full Name</Text>
        <View style={styles.field}><Text style={styles.icon}>☺</Text><TextInput value={fullName} onChangeText={setFullName} placeholder="Full name" placeholderTextColor="#A0A7B1" style={styles.input} autoCapitalize="words" /></View>
        <Text style={styles.label}>Mobile Number</Text>
        <View style={styles.field}>
          <Text style={styles.icon}>☎</Text>
          <TextInput value={mobile} onChangeText={(value) => setMobile(formatPhone(value))} placeholder="+91 mobile number" placeholderTextColor="#A0A7B1" keyboardType="phone-pad" style={styles.input} maxLength={16} />
          {verified && <View style={styles.verified}><Text style={styles.verifiedText}>✓ Verified</Text></View>}
        </View>
        <Text style={styles.label}>Email Address</Text>
        <View style={styles.field}><Text style={styles.icon}>✉</Text><Text style={[styles.input, styles.locked]}>{email || 'No email on this account'}</Text></View>
        <Text style={styles.label}>Date of Birth</Text>
        <TouchableOpacity style={styles.field} onPress={() => setPicker(true)} accessibilityRole="button">
          <Text style={styles.icon}>▦</Text>
          <Text style={[styles.input, !dob && styles.placeholder]}>{showDate(dob) || 'Add date of birth'}</Text>
          <Text style={styles.chevron}>⌄</Text>
        </TouchableOpacity>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={save} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Save Changes</Text>}
        </TouchableOpacity>
      </ScrollView>
      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <View style={styles.modal}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Date of birth</Text>
            <Text style={styles.sheetLabel}>Year</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
              {years.map(value => <TouchableOpacity key={value} style={[styles.choice, year === value && styles.choiceOn]} onPress={() => setYear(value)}><Text style={[styles.choiceText, year === value && styles.choiceTextOn]}>{value}</Text></TouchableOpacity>)}
            </ScrollView>
            <Text style={styles.sheetLabel}>Month</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
              {MONTHS.map((label, index) => <TouchableOpacity key={label} style={[styles.choice, month === index + 1 && styles.choiceOn]} onPress={() => setMonth(index + 1)}><Text style={[styles.choiceText, month === index + 1 && styles.choiceTextOn]}>{label.slice(0, 3)}</Text></TouchableOpacity>)}
            </ScrollView>
            <Text style={styles.sheetLabel}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
              {Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1).map(value => <TouchableOpacity key={value} style={[styles.choice, day === value && styles.choiceOn]} onPress={() => setDay(value)}><Text style={[styles.choiceText, day === value && styles.choiceTextOn]}>{value}</Text></TouchableOpacity>)}
            </ScrollView>
            <TouchableOpacity style={styles.button} onPress={confirmDate} accessibilityRole="button"><Text style={styles.buttonText}>Use this date</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFFFFF'},
  page:{padding:22,paddingBottom:40},
  back:{width:36,height:36,justifyContent:'center'},
  backMark:{fontSize:32,color:INK,lineHeight:34},
  title:{fontSize:32,fontWeight:'800',color:INK,letterSpacing:-0.6,marginTop:8},
  subtitle:{fontSize:15,color:MUTED,marginTop:6},
  photoWrap:{alignItems:'center',marginVertical:22},
  avatar:{width:108,height:108,borderRadius:54,backgroundColor:'#E7F6EF',alignItems:'center',justifyContent:'center'},
  avatarImage:{width:108,height:108,borderRadius:54},
  person:{alignItems:'center',justifyContent:'flex-end',height:72},
  head:{width:28,height:28,borderRadius:14,backgroundColor:'#8ED4B4'},
  shoulders:{width:52,height:26,borderTopLeftRadius:26,borderTopRightRadius:26,backgroundColor:'#7DCEAA',marginTop:6},
  camera:{position:'absolute',right:2,bottom:2,width:32,height:32,borderRadius:16,backgroundColor:BUTTON,alignItems:'center',justifyContent:'center',borderWidth:3,borderColor:'#FFFFFF'},
  cameraMark:{color:'#FFFFFF',fontSize:14,fontWeight:'800'},
  change:{color:GREEN,fontWeight:'700',marginTop:10},
  label:{fontSize:15,fontWeight:'800',color:INK,marginBottom:8,marginTop:12},
  field:{minHeight:54,borderWidth:1,borderColor:LINE,backgroundColor:FIELD,borderRadius:14,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:10},
  icon:{width:18,color:MUTED,fontSize:16,textAlign:'center'},
  input:{flex:1,color:INK,fontSize:16,paddingVertical:12},
  locked:{color:INK},
  placeholder:{color:'#A0A7B1'},
  verified:{backgroundColor:'#E5F8EE',borderRadius:12,paddingHorizontal:8,paddingVertical:4},
  verifiedText:{color:GREEN,fontSize:12,fontWeight:'800'},
  chevron:{color:'#9AA3AD',fontSize:18},
  error:{color:'#B42318',fontWeight:'700',marginTop:12},
  button:{height:54,borderRadius:14,backgroundColor:BUTTON,alignItems:'center',justifyContent:'center',marginTop:22},
  buttonText:{color:'#FFFFFF',fontSize:16,fontWeight:'800'},
  disabled:{opacity:0.6},
  modal:{flex:1,backgroundColor:'rgba(17,24,39,0.35)',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#FFFFFF',borderTopLeftRadius:20,borderTopRightRadius:20,padding:18,paddingBottom:28},
  sheetTitle:{fontSize:18,fontWeight:'800',color:INK},
  sheetLabel:{fontSize:12,fontWeight:'700',color:MUTED,marginTop:12,marginBottom:8},
  choices:{gap:8,paddingRight:12},
  choice:{borderWidth:1,borderColor:LINE,borderRadius:12,paddingHorizontal:12,paddingVertical:8},
  choiceOn:{backgroundColor:'#E7F6EF',borderColor:GREEN},
  choiceText:{color:INK,fontWeight:'700'},
  choiceTextOn:{color:GREEN},
});
