import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Image, Linking, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as ImagePicker from 'expo-image-picker';
import { rideOnApi } from '../services/api';

const INK = '#12161C';
const MUTED = '#6B7280';
const GREEN = '#067A4A';
const BUTTON = '#07A574';
const LINE = '#E6E8EC';
const PALE = '#F4FBF7';

const cashfreeErrorText = (error, fallback) => {
  const details = error?.details || {};
  const serverMessage = String(error?.message || '').replace(/\s*\[[0-9]{3}\s+[^\]]+\]\s*$/, '').trim();
  const generic = /^Cashfree Secure ID rejected the verification request\.?$/i.test(serverMessage);
  if (serverMessage && !generic) return serverMessage;
  const exact = [details.providerStatus, details.providerCode, details.providerMessage].filter(part => part != null && part !== '').join(' — ');
  return exact || serverMessage || fallback;
};

const extractVerificationId = (url) => {
  const match = String(url || '').match(/[?&]verification_id=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
};

const isDigilockerReturn = (url) => {
  const value = String(url || '');
  return value.includes('/kyc/digilocker/callback') || value.startsWith('rideon://') || value.startsWith('exp://');
};

const showDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};

const toIsoDate = (value) => {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};

const latestOf = (documents, type) => (documents || []).find(item => item?.documentType === type) || null;

const statusLabel = (document) => {
  if (document?.documentStatus === 'APPROVED') return 'Verified';
  if (document?.documentStatus === 'PENDING') return 'In review';
  if (document?.documentStatus === 'REJECTED') return 'Not approved';
  return 'Not added';
};

function Back({ onPress }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
      <Text style={styles.backMark}>‹</Text>
    </TouchableOpacity>
  );
}

function Badge({ label }) {
  const good = label === 'Verified' || label === 'Added';
  const waiting = label === 'In review';
  return (
    <View style={[styles.badge, good && styles.badgeGood, waiting && styles.badgeWait]}>
      <Text style={[styles.badgeText, good && styles.badgeTextGood, waiting && styles.badgeTextWait]}>{good ? '✓ ' : waiting ? '◌ ' : '◌ '}{label}</Text>
    </View>
  );
}

function DocRow({ icon, title, subtitle, status, onPress }) {
  return (
    <TouchableOpacity style={styles.doc} onPress={onPress} accessibilityRole="button">
      <View style={styles.docIcon}><Text style={styles.docIconText}>{icon}</Text></View>
      <View style={styles.copy}>
        <Text style={styles.docTitle}>{title}</Text>
        <Text style={styles.docSub}>{subtitle}</Text>
      </View>
      <Badge label={status} />
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function Continue({ title, busy, disabled, onPress }) {
  return (
    <TouchableOpacity style={[styles.button, (busy || disabled) && styles.disabled]} disabled={busy || disabled} onPress={onPress} accessibilityRole="button">
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{title}</Text>}
    </TouchableOpacity>
  );
}

export default function DocumentsFlow({ start = 'list', onBack, onDone, onVerified, onNotice }) {
  const [view, setView] = useState(start === 'status' ? 'status' : 'list');
  const [documents, setDocuments] = useState([]);
  const [accountStatus, setAccountStatus] = useState('');
  const [licence, setLicence] = useState('');
  const [dob, setDob] = useState('');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [aadhaarMethod, setAadhaarMethod] = useState('NUMBER');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [seconds, setSeconds] = useState(0);
  const [verificationId, setVerificationId] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [verifiedDoc, setVerifiedDoc] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [digilockerUrl, setDigilockerUrl] = useState(null);
  const otpRefs = useRef([]);
  const pendingAadhaarId = useRef(null);
  const syncing = useRef(false);
  const closing = useRef(false);

  const load = async () => {
    try {
      const result = await rideOnApi.getKycStatus();
      setAccountStatus(result?.kyc?.status || '');
      setDocuments(result?.kyc?.documents || []);
    } catch (e) {
      setError(e?.message || 'We could not load your documents.');
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const applyDocument = (next) => {
    if (!next) return null;
    setDocuments(current => {
      const rest = current.filter(item => item.documentType !== next.documentType);
      return [...rest, next];
    });
    if (next.documentStatus === 'APPROVED') onVerified?.();
    return next;
  };

  const syncAadhaar = async (id) => {
    if (!id || syncing.current) return null;
    syncing.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await rideOnApi.syncAadhaarKyc(id);
      const next = applyDocument(result?.kyc);
      if (next?.documentStatus === 'APPROVED') {
        pendingAadhaarId.current = null;
        setVerifiedDoc(next);
        setView('verified');
      } else if (next?.documentStatus === 'REJECTED') {
        pendingAadhaarId.current = null;
        setError('Aadhaar verification was not approved. Start it again.');
        setView('aadhaar');
      } else {
        setError('DigiLocker is finished. RideOn is still waiting for Cashfree to confirm Aadhaar.');
      }
      return next;
    } catch (e) {
      setError(cashfreeErrorText(e, 'We could not update Aadhaar verification status.'));
      return null;
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    const handleUrl = ({ url }) => {
      const id = extractVerificationId(url);
      if (!id) return;
      pendingAadhaarId.current = id;
      syncAadhaar(id);
    };
    const subscription = Linking.addEventListener('url', handleUrl);
    const appSubscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && pendingAadhaarId.current) syncAadhaar(pendingAadhaarId.current);
    });
    return () => {
      subscription.remove();
      appSubscription.remove();
    };
  }, []);

  const submitLicence = async () => {
    const number = licence.trim().toUpperCase();
    const dateOfBirth = toIsoDate(dob);
    if (number.length < 6) return setError('Enter the driving licence number.');
    if (!dateOfBirth) return setError('Enter the date of birth as YYYY-MM-DD.');
    setBusy(true);
    setError('');
    try {
      const result = await rideOnApi.submitKycVerification({ documentType:'DRIVING_LICENSE', documentNumber:number, dateOfBirth });
      const next = applyDocument(result?.kyc);
      if (next?.documentStatus === 'APPROVED') onNotice?.('Driving licence verified.');
      else onNotice?.('Driving licence submitted. Booking stays locked until it is approved.');
      setView('list');
      load();
    } catch (e) {
      setError(e?.code === 'KYC_BLACKLISTED' ? 'Identity verification cannot be completed for this account.' : cashfreeErrorText(e, 'Driving licence verification could not be completed.'));
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    const digits = aadhaarNumber.replace(/\D/g, '');
    if (digits.length !== 12) return setError('Enter the 12-digit Aadhaar number.');
    setBusy(true);
    setError('');
    try {
      const result = await rideOnApi.startAadhaarNumberKyc(digits);
      setVerificationId(result.verificationId || '');
      setReferenceId(result.referenceId || '');
      setOtp(['', '', '', '', '', '']);
      setSeconds(30);
      setView('otp');
    } catch (e) {
      setError(cashfreeErrorText(e, 'Could not send the Aadhaar OTP.'));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    const code = otp.join('');
    if (!verificationId || !referenceId) return setError('Send the Aadhaar OTP again.');
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit OTP.');
    setBusy(true);
    setError('');
    try {
      const result = await rideOnApi.verifyAadhaarNumberKyc(verificationId, code);
      const next = applyDocument(result?.kyc);
      if (next?.documentStatus === 'APPROVED') {
        setVerifiedDoc(next);
        setView('verified');
      } else if (next?.documentStatus === 'REJECTED') {
        setError('Aadhaar verification was not approved. Start it again.');
      } else {
        setError('Aadhaar verification is still pending.');
      }
    } catch (e) {
      setError(cashfreeErrorText(e, 'Aadhaar OTP verification could not be completed.'));
    } finally {
      setBusy(false);
    }
  };

  const startDigilocker = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await rideOnApi.startAadhaarKyc();
      if (!result?.url || !result?.verificationId) throw new Error('Cashfree did not return a DigiLocker link.');
      pendingAadhaarId.current = result.verificationId;
      if (result.kyc) applyDocument(result.kyc);
      if (Platform.OS === 'web') await Linking.openURL(result.url);
      else {
        closing.current = false;
        setDigilockerUrl(result.url);
      }
    } catch (e) {
      setError(cashfreeErrorText(e, 'Could not start DigiLocker verification.'));
    } finally {
      if (!syncing.current) setBusy(false);
    }
  };

  const completeDigilocker = (url, force = false) => {
    if (!force && !isDigilockerReturn(url)) return false;
    if (closing.current) return true;
    closing.current = true;
    const id = extractVerificationId(url) || pendingAadhaarId.current;
    setDigilockerUrl(null);
    if (id) {
      pendingAadhaarId.current = id;
      syncAadhaar(id);
    }
    return true;
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError('Allow photo access to add a picture.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setPhoto(result.assets[0].uri);
      setError('');
    }
  };

  const changeOtp = (index, value) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length > 1) {
      const next = [...otp];
      digits.slice(0, 6).split('').forEach((digit, offset) => { if (index + offset < 6) next[index + offset] = digit; });
      setOtp(next);
      otpRefs.current[Math.min(5, index + digits.length)]?.focus();
      return;
    }
    const next = [...otp];
    next[index] = digits;
    setOtp(next);
    if (digits && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const licenceDoc = latestOf(documents, 'DRIVING_LICENSE');
  const aadhaarDoc = latestOf(documents, 'AADHAAR');
  const display = verifiedDoc?.display || aadhaarDoc?.display || {};
  const detailRows = [
    display.name ? ['Name', display.name] : null,
    display.maskedAadhaar ? ['Aadhaar number', display.maskedAadhaar] : null,
    display.dateOfBirth ? ['Date of birth', showDate(display.dateOfBirth)] : null,
  ].filter(Boolean);

  return (
    <View style={styles.screen}>
      <Modal visible={Boolean(digilockerUrl)} animationType="slide" onRequestClose={() => completeDigilocker(null, true)}>
        <View style={styles.browser}>
          <View style={styles.browserBar}>
            <Text style={styles.browserTitle}>DigiLocker</Text>
            <TouchableOpacity onPress={() => completeDigilocker(null, true)} accessibilityRole="button"><Text style={styles.browserClose}>Close</Text></TouchableOpacity>
          </View>
          {digilockerUrl ? <WebView source={{ uri: digilockerUrl }} originWhitelist={['*']} setSupportMultipleWindows={false} onShouldStartLoadWithRequest={(request) => !completeDigilocker(request?.url)} onNavigationStateChange={(state) => { completeDigilocker(state?.url); }} /> : null}
        </View>
      </Modal>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {view === 'list' && <>
          <Back onPress={onBack} />
          <Text style={styles.title}>My Documents</Text>
          <Text style={styles.subtitle}>Manage your documents for verification</Text>
          <DocRow icon="▣" title="Driving License" subtitle="Required for renting vehicles" status={statusLabel(licenceDoc)} onPress={() => { setError(''); setView('license'); }} />
          <DocRow icon="☀" title="Aadhaar (Optional)" subtitle="For faster verification" status={statusLabel(aadhaarDoc)} onPress={() => { setError(''); setView('aadhaar'); }} />
          <DocRow icon="☰" title="Photo" subtitle="Upload a clear photo" status={photo ? 'Added' : 'Not added'} onPress={() => { setError(''); setView('photo'); }} />
        </>}
        {view === 'license' && <>
          <Back onPress={() => setView('list')} />
          <Text style={styles.title}>Driving License</Text>
          <Text style={styles.subtitle}>Enter the licence number and date of birth. RideOn verifies them with Cashfree.</Text>
          <Text style={styles.label}>Licence number</Text>
          <TextInput value={licence} onChangeText={setLicence} autoCapitalize="characters" autoCorrect={false} placeholder="Driving licence number" placeholderTextColor="#A0A7B1" style={styles.input} editable={!busy} />
          <Text style={styles.label}>Date of birth</Text>
          <TextInput value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" placeholderTextColor="#A0A7B1" style={styles.input} editable={!busy} maxLength={10} />
          <View style={styles.note}>
            <Text style={styles.noteTitle}>Details must match the licence</Text>
            <Text style={styles.noteLine}>• Use the number printed on the licence</Text>
            <Text style={styles.noteLine}>• Date of birth must match the licence</Text>
            <Text style={styles.noteLine}>• Cashfree confirms the licence before booking</Text>
          </View>
          <Continue title="Continue" busy={busy} onPress={submitLicence} />
        </>}
        {view === 'aadhaar' && <>
          <Back onPress={() => setView('list')} />
          <Text style={styles.title}>Aadhaar Verification</Text>
          <Text style={styles.subtitle}>Verify your identity with Aadhaar for faster booking and secure rentals.</Text>
          <View style={styles.art}><Text style={styles.artMark}>Aadhaar</Text></View>
          <Text style={styles.section}>Select verification method</Text>
          <TouchableOpacity style={[styles.method, aadhaarMethod === 'NUMBER' && styles.methodOn]} onPress={() => setAadhaarMethod('NUMBER')} accessibilityRole="button">
            <Text style={styles.methodTitle}>Aadhaar OTP</Text>
            <Text style={styles.methodText}>Verify using OTP sent to your Aadhaar linked mobile number</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.method, aadhaarMethod === 'DIGILOCKER' && styles.methodOn]} onPress={() => setAadhaarMethod('DIGILOCKER')} accessibilityRole="button">
            <Text style={styles.methodTitle}>DigiLocker</Text>
            <Text style={styles.methodText}>Verify using your DigiLocker account</Text>
          </TouchableOpacity>
          {aadhaarMethod === 'NUMBER' && <>
            <Text style={styles.label}>Aadhaar number</Text>
            <TextInput value={aadhaarNumber} onChangeText={(value) => setAadhaarNumber(value.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" secureTextEntry placeholder="12-digit Aadhaar number" placeholderTextColor="#A0A7B1" style={styles.input} editable={!busy} maxLength={12} />
          </>}
          <View style={styles.note}><Text style={styles.noteLine}>Your information is used only for verification.</Text></View>
          <Continue title="Continue" busy={busy} onPress={aadhaarMethod === 'DIGILOCKER' ? startDigilocker : sendOtp} />
        </>}
        {view === 'otp' && <>
          <Back onPress={() => setView('aadhaar')} />
          <Text style={styles.title}>Enter OTP</Text>
          <Text style={styles.subtitle}>We've sent a 6-digit OTP to your Aadhaar linked mobile number.</Text>
          <View style={styles.otpRow}>
            {otp.map((digit, index) => (
              <TextInput key={index} ref={(node) => { otpRefs.current[index] = node; }} value={digit} onChangeText={(value) => changeOtp(index, value)} keyboardType="number-pad" maxLength={6} style={[styles.otp, index === otp.findIndex(item => !item) && styles.otpOn]} />
            ))}
          </View>
          {seconds > 0
            ? <Text style={styles.resend}>Resend OTP in 00:{String(seconds).padStart(2, '0')}</Text>
            : <TouchableOpacity onPress={sendOtp} disabled={busy} accessibilityRole="button"><Text style={styles.resend}>Resend OTP</Text></TouchableOpacity>}
          <Continue title="Verify OTP" busy={busy} onPress={verifyOtp} />
          <View style={styles.note}>
            <Text style={styles.noteTitle}>Your information is secure</Text>
            <Text style={styles.noteLine}>RideOn uses Cashfree Secure ID for this check.</Text>
          </View>
        </>}
        {view === 'verified' && <>
          <View style={styles.successMark}><Text style={styles.successTick}>✓</Text></View>
          <Text style={[styles.title, styles.center]}>Aadhaar Verified</Text>
          <Text style={[styles.subtitle, styles.center]}>Your identity has been successfully verified. You can now book and rent vehicles.</Text>
          <View style={styles.details}>
            <View style={styles.detailsHead}>
              <Text style={styles.detailsTitle}>Verified details</Text>
              <Badge label="Verified" />
            </View>
            {detailRows.map(([label, value]) => (
              <View key={label} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{label}</Text>
                <Text style={styles.detailValue}>{value}</Text>
              </View>
            ))}
            {detailRows.length === 0 && <Text style={styles.noteLine}>Cashfree confirmed Aadhaar. No extra identity fields were returned.</Text>}
          </View>
          <Continue title="Continue" onPress={() => setView('status')} />
        </>}
        {view === 'status' && <>
          <Back onPress={onBack} />
          <Text style={styles.title}>KYC Status</Text>
          <Text style={styles.subtitle}>Complete your verification to start booking vehicles.</Text>
          <DocRow icon="▣" title="Driving License" subtitle="Required for renting vehicles" status={statusLabel(licenceDoc)} onPress={() => setView('license')} />
          <DocRow icon="☀" title="Aadhaar" subtitle="Identity verification (Optional)" status={statusLabel(aadhaarDoc)} onPress={() => setView('aadhaar')} />
          <DocRow icon="☰" title="Photo" subtitle="Upload a clear photo" status={photo ? 'Added' : 'Not added'} onPress={() => setView('photo')} />
          <View style={styles.note}><Text style={styles.noteLine}>{accountStatus === 'VERIFIED' ? 'Your account can book RideOn vehicles.' : 'Booking stays locked until a required document is approved.'}</Text></View>
          <Continue title={accountStatus === 'VERIFIED' ? 'Continue to Home' : 'Back to documents'} onPress={accountStatus === 'VERIFIED' ? onDone : () => setView('list')} />
        </>}
        {view === 'photo' && <>
          <Back onPress={() => setView('list')} />
          <Text style={styles.title}>Photo</Text>
          <Text style={styles.subtitle}>Add a clear photo for this phone. RideOn does not mark it verified.</Text>
          <TouchableOpacity style={styles.upload} onPress={pickPhoto} accessibilityRole="button">
            {photo ? <Image source={{ uri: photo }} style={styles.preview} /> : <Text style={styles.uploadText}>Tap to choose a photo</Text>}
          </TouchableOpacity>
          <Continue title="Continue" disabled={!photo} onPress={() => setView('list')} />
        </>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFFFFF'},
  page:{padding:22,paddingBottom:40},
  back:{width:36,height:36,justifyContent:'center',marginBottom:8},
  backMark:{fontSize:32,color:INK,lineHeight:34},
  title:{fontSize:30,fontWeight:'800',color:INK,letterSpacing:-0.5},
  subtitle:{fontSize:15,lineHeight:22,color:MUTED,marginTop:6,marginBottom:18},
  center:{textAlign:'center'},
  doc:{flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:'#E7F3EC',backgroundColor:PALE,borderRadius:16,padding:14,marginBottom:12},
  docIcon:{width:42,height:42,borderRadius:12,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},
  docIconText:{fontSize:18,color:GREEN},
  copy:{flex:1},
  docTitle:{fontSize:16,fontWeight:'800',color:INK},
  docSub:{fontSize:12,color:MUTED,marginTop:2},
  badge:{borderRadius:14,backgroundColor:'#F3F4F6',paddingHorizontal:8,paddingVertical:5},
  badgeGood:{backgroundColor:'#E5F8EE'},
  badgeWait:{backgroundColor:'#FFF6E8'},
  badgeText:{fontSize:12,fontWeight:'700',color:'#6B7280'},
  badgeTextGood:{color:GREEN},
  badgeTextWait:{color:'#B7791F'},
  chevron:{fontSize:20,color:'#C5CAD1'},
  label:{fontSize:13,fontWeight:'700',color:INK,marginBottom:6,marginTop:8},
  input:{height:52,borderWidth:1,borderColor:LINE,borderRadius:14,paddingHorizontal:14,fontSize:16,color:INK,marginBottom:8},
  note:{backgroundColor:PALE,borderRadius:16,padding:14,marginTop:12,marginBottom:16},
  noteTitle:{fontSize:15,fontWeight:'800',color:INK,marginBottom:6},
  noteLine:{fontSize:13,color:MUTED,lineHeight:20},
  button:{height:54,borderRadius:14,backgroundColor:BUTTON,alignItems:'center',justifyContent:'center',marginTop:8},
  buttonText:{color:'#FFFFFF',fontSize:16,fontWeight:'800'},
  disabled:{opacity:0.55},
  art:{height:120,borderRadius:20,backgroundColor:'#F3FBF7',alignItems:'center',justifyContent:'center',marginBottom:16},
  artMark:{fontSize:16,fontWeight:'800',color:GREEN},
  section:{fontSize:16,fontWeight:'800',color:INK,marginBottom:10},
  method:{borderWidth:1,borderColor:LINE,borderRadius:16,padding:14,marginBottom:10},
  methodOn:{borderColor:GREEN,backgroundColor:PALE},
  methodTitle:{fontSize:16,fontWeight:'800',color:INK},
  methodText:{fontSize:13,color:MUTED,marginTop:3,lineHeight:18},
  otpRow:{flexDirection:'row',justifyContent:'space-between',marginVertical:18},
  otp:{width:46,height:54,borderWidth:1,borderColor:LINE,borderRadius:12,textAlign:'center',fontSize:20,fontWeight:'800',color:INK},
  otpOn:{borderColor:GREEN},
  resend:{textAlign:'center',color:GREEN,fontWeight:'700',marginBottom:16},
  successMark:{width:84,height:84,borderRadius:42,backgroundColor:'#E5F8EE',alignSelf:'center',alignItems:'center',justifyContent:'center',marginTop:24,marginBottom:12},
  successTick:{fontSize:36,color:GREEN,fontWeight:'800'},
  details:{borderWidth:1,borderColor:LINE,borderRadius:16,padding:14,marginBottom:16},
  detailsHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8},
  detailsTitle:{fontSize:16,fontWeight:'800',color:INK},
  detailRow:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:10,borderTopWidth:1,borderTopColor:'#F1F3F5'},
  detailLabel:{fontSize:14,color:MUTED},
  detailValue:{flex:1,textAlign:'right',fontSize:14,fontWeight:'700',color:INK},
  upload:{minHeight:160,borderWidth:1,borderStyle:'dashed',borderColor:'#D5D8DE',borderRadius:16,alignItems:'center',justifyContent:'center',marginBottom:16,overflow:'hidden'},
  uploadText:{color:INK,fontWeight:'700'},
  preview:{width:'100%',height:180},
  error:{color:'#B42318',fontWeight:'700',marginTop:12,lineHeight:18},
  browser:{flex:1,backgroundColor:'#FFFFFF',paddingTop:48},
  browserBar:{height:52,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:LINE},
  browserTitle:{fontSize:16,fontWeight:'800',color:INK},
  browserClose:{fontSize:16,fontWeight:'700',color:GREEN},
});
