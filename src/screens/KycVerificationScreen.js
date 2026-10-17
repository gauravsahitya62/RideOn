import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { rideOnApi } from '../services/api';

const C = {
  bg:'#F7F5F1',
  white:'#FFFFFF',
  ink:'#111827',
  muted:'#6B7280',
  orange:'#E56A3D',
  green:'#218765',
  line:'#E7E2DA',
  paleGreen:'#EEF8F3',
  danger:'#B23B3B',
};

const extractVerificationId = (url) => {
  const match = String(url || '').match(/[?&]verification_id=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
};

const cashfreeErrorText = (error, fallback) => {
  const details = error?.details || {};
  const serverMessage = String(error?.message || '').replace(/\s*\[[0-9]{3}\s+[^\]]+\]\s*$/, '').trim();
  const generic = /^Cashfree Secure ID rejected the verification request\.?$/i.test(serverMessage);
  if (serverMessage && !generic) return serverMessage;
  const exact = [details.providerStatus, details.providerCode, details.providerMessage].filter((part) => part != null && part !== '').join(' — ');
  if (exact) return exact;
  return serverMessage || fallback;
};

const isDigilockerReturn = (url) => {
  const value = String(url || '');
  return value.includes('/kyc/digilocker/callback') || value.startsWith('rideon://') || value.startsWith('exp://');
};

export default function KycVerificationScreen({ onBack, onVerified, onNotice }) {
  const [method, setMethod] = useState('DRIVING_LICENSE');
  const [documentNumber, setDocumentNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [status, setStatus] = useState('UNVERIFIED');
  const [verification, setVerification] = useState(null);
  const [aadhaarVerificationId, setAadhaarVerificationId] = useState(null);
  const [aadhaarMethod, setAadhaarMethod] = useState('DIGILOCKER');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [aadhaarOtp, setAadhaarOtp] = useState('');
  const [aadhaarReferenceId, setAadhaarReferenceId] = useState(null);
  const [aadhaarOtpSent, setAadhaarOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [digilockerNote, setDigilockerNote] = useState('');
  const [digilockerUrl, setDigilockerUrl] = useState(null);
  const pendingAadhaarId = useRef(null);
  const syncingAadhaar = useRef(false);
  const syncAadhaarRef = useRef(async () => null);
  const closingDigilocker = useRef(false);

  const applyKyc = (next) => {
    setVerification(next || null);
    setStatus(next?.documentStatus || 'UNVERIFIED');
    if (next?.documentStatus === 'APPROVED') {
      onVerified?.(next);
    }
    return next;
  };

  const loadStatus = async () => {
    try {
      const result = await rideOnApi.getKycStatus();
      applyKyc(result?.kyc?.activeVerification || null);
    } catch (e) {
      setError(e?.message || 'We could not load your verification status.');
    }
  };

  const syncAadhaar = async (verificationId) => {
    const id = verificationId || pendingAadhaarId.current;
    if (!id || syncingAadhaar.current) return null;
    syncingAadhaar.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await rideOnApi.syncAadhaarKyc(id);
      const next = applyKyc(result?.kyc);
      if (next?.documentStatus === 'APPROVED') {
        pendingAadhaarId.current = null;
        setDigilockerNote('');
        onNotice?.('Aadhaar verified. You can book RideOn vehicles.');
        onVerified?.();
      } else if (next?.documentStatus === 'REJECTED') {
        pendingAadhaarId.current = null;
        setDigilockerNote('');
        setError('Aadhaar verification was not approved. Please start the verification again.');
      } else {
        setDigilockerNote('DigiLocker is finished. RideOn is still waiting for Cashfree to confirm Aadhaar. Tap Check DigiLocker status.');
      }
      return next;
    } catch (e) {
      console.warn('[RideOnKyc][CASHFREE_ERROR]', JSON.stringify({flow:'digilocker-sync',code:e?.code||null,status:e?.status||null,message:e?.message||null,details:e?.details||null}));
      setError(cashfreeErrorText(e, 'We could not update Aadhaar verification status.'));
      return null;
    } finally {
      syncingAadhaar.current = false;
      setBusy(false);
    }
  };
  syncAadhaarRef.current = syncAadhaar;

  useEffect(() => {
    loadStatus();

    const handleUrl = ({ url }) => {
      const id = extractVerificationId(url);
      if (!id) return;
      pendingAadhaarId.current = id;
      setAadhaarVerificationId(id);
      syncAadhaarRef.current(id);
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => {
      const id = extractVerificationId(url);
      if (!id) return;
      pendingAadhaarId.current = id;
      setAadhaarVerificationId(id);
      syncAadhaarRef.current(id);
    }).catch(() => {});

    const appSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && pendingAadhaarId.current) syncAadhaarRef.current(pendingAadhaarId.current);
    });

    return () => {
      subscription.remove();
      appSubscription.remove();
    };
  }, []);

  const submitDrivingLicence = async () => {
    setError('');
    const number = documentNumber.trim().toUpperCase();
    const dob = dateOfBirth.trim();

    if (number.length < 6) return setError('Enter a valid Driving Licence number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return setError('Enter your date of birth as YYYY-MM-DD.');

    setBusy(true);
    try {
      const result = await rideOnApi.submitKycVerification({
        documentType:'DRIVING_LICENSE',
        documentNumber:number,
        dateOfBirth:dob,
      });
      const next = applyKyc(result?.kyc);
      if (next?.documentStatus === 'APPROVED') {
        onNotice?.('Driving licence verified. You can book RideOn vehicles.');
        onVerified?.();
      } else {
        onNotice?.('Verification submitted. Booking stays locked until it is approved.');
      }
    } catch (e) {
      setError(
        e?.code === 'KYC_BLACKLISTED'
          ? 'Identity verification cannot be completed for this account.'
          : e?.message || 'Identity verification could not be completed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const startAadhaarDigiLocker = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await rideOnApi.startAadhaarKyc();
      if (!result?.url || !result?.verificationId) throw new Error('Cashfree did not return an Aadhaar verification URL.');
      pendingAadhaarId.current = result.verificationId;
      setAadhaarVerificationId(result.verificationId);
      if (result.kyc) applyKyc(result.kyc);
      setDigilockerNote('DigiLocker opens inside RideOn. When you finish, RideOn confirms Aadhaar without leaving the app.');
      if (Platform.OS === 'web') {
        await Linking.openURL(result.url);
      } else {
        closingDigilocker.current = false;
        setDigilockerUrl(result.url);
      }
    } catch (e) {
      console.warn('[RideOnKyc][CASHFREE_ERROR]', JSON.stringify({flow:'digilocker',code:e?.code||null,status:e?.status||null,message:e?.message||null,details:e?.details||null}));
      setError(cashfreeErrorText(e, 'Could not start Aadhaar DigiLocker verification. Please try again.'));
    } finally {
      if (!syncingAadhaar.current) setBusy(false);
    }
  };

  const sendAadhaarOtp = async () => {
    const digits=aadhaarNumber.replace(/\D/g,'');
    const shape={rawLength:aadhaarNumber.length,digitCount:digits.length};
    if (digits.length !== 12) {
      console.warn('[RideOnKyc][AADHAAR_REJECTED]', JSON.stringify({stage:'client',reason:digits.length<12?'too_few_digits':'too_many_digits',...shape}));
      setError('Enter a valid 12-digit Aadhaar number.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result=await rideOnApi.startAadhaarNumberKyc(digits);
      setAadhaarVerificationId(result.verificationId);
      setAadhaarReferenceId(result.referenceId);
      setAadhaarOtpSent(true);
      setAadhaarOtp('');
      onNotice?.('OTP sent to the mobile number linked with this Aadhaar.');
    } catch(e) {
      console.warn('[RideOnKyc][CASHFREE_ERROR]', JSON.stringify({flow:'aadhaar-otp',code:e?.code||null,status:e?.status||null,message:e?.message||null,details:e?.details||null}));
      setError(cashfreeErrorText(e, 'Could not send Aadhaar OTP. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const verifyAadhaarOtp = async () => {
    if (!aadhaarVerificationId || !aadhaarReferenceId) {
      setError('Start Aadhaar verification again.');
      return;
    }
    if (!/^\d{4,8}$/.test(aadhaarOtp.trim())) {
      setError('Enter the OTP sent to your Aadhaar-linked mobile number.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result=await rideOnApi.verifyAadhaarNumberKyc(aadhaarVerificationId,aadhaarOtp.trim());
      const next=applyKyc(result?.kyc);
      if(next?.documentStatus==='APPROVED') {
        onNotice?.('Aadhaar verified. You can book RideOn vehicles.');
        onVerified?.();
      } else if(next?.documentStatus==='REJECTED') {
        setError('Aadhaar verification was not approved. Please start again.');
      } else {
        setError('Aadhaar verification is still pending. Please check again.');
      }
    } catch(e) {
      setError(cashfreeErrorText(e, 'Aadhaar OTP verification could not be completed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const completeDigilocker = (url, force = false) => {
    if (!force && !isDigilockerReturn(url)) return false;
    if (closingDigilocker.current) return true;
    closingDigilocker.current = true;
    const id = extractVerificationId(url) || pendingAadhaarId.current;
    setDigilockerUrl(null);
    if (id) {
      pendingAadhaarId.current = id;
      setAadhaarVerificationId(id);
      syncAadhaar(id);
    }
    return true;
  };

  const verified = status === 'VERIFIED' || status === 'APPROVED';
  const statusLabel = verified
    ? 'VERIFIED'
    : status === 'PENDING'
      ? 'VERIFICATION IN PROGRESS'
      : status === 'REJECTED' || status === 'BLACKLISTED'
        ? 'VERIFICATION NOT APPROVED'
        : 'NOT VERIFIED';

  return (
    <View style={styles.safe}>
      <Modal visible={Boolean(digilockerUrl)} animationType="slide" onRequestClose={() => completeDigilocker(null, true)}>
        <View style={styles.browser}>
          <View style={styles.browserBar}>
            <Text style={styles.browserTitle}>DigiLocker</Text>
            <TouchableOpacity onPress={() => completeDigilocker(null, true)} accessibilityRole="button">
              <Text style={styles.browserClose}>Close</Text>
            </TouchableOpacity>
          </View>
          {digilockerUrl ? (
            <WebView
              source={{ uri: digilockerUrl }}
              originWhitelist={['*']}
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(request) => !completeDigilocker(request?.url)}
              onNavigationStateChange={(state) => { completeDigilocker(state?.url); }}
              startInLoadingState
              renderLoading={() => <ActivityIndicator color={C.orange} style={{ marginTop: 24 }} />}
            />
          ) : null}
        </View>
      </Modal>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} disabled={busy} accessibilityRole="button">
            <Text style={styles.back}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Identity verification</Text>
          <View style={{ width:28 }} />
        </View>

        <Text style={styles.kicker}>RIDEON KYC</Text>
        <Text style={styles.title}>Verify your driver credentials</Text>
        <Text style={styles.subtitle}>
          Complete one identity verification through Cashfree Secure ID before booking a RideOn vehicle.
        </Text>

        <View style={styles.statusCard}>
          <View style={[styles.statusDot, verified && styles.statusDotGood]} />
          <View style={{ flex:1 }}>
            <Text style={styles.statusLabel}>{statusLabel}</Text>
            <Text style={styles.statusText}>
              {verified
                ? 'You are eligible to book RideOn vehicles.'
                : status === 'PENDING'
                  ? 'Identity verification is still being processed.'
                  : 'Booking remains locked until verification is approved.'}
            </Text>
          </View>
        </View>

        <Text style={styles.section}>01 — CHOOSE VERIFICATION</Text>
        <View style={styles.methodRow}>
          <TouchableOpacity
            disabled={busy}
            onPress={() => { setMethod('DRIVING_LICENSE'); setError(''); }}
            style={[styles.method, method === 'DRIVING_LICENSE' && styles.methodActive]}
          >
            <Text style={[styles.methodTitle, method === 'DRIVING_LICENSE' && styles.methodTitleActive]}>Driving Licence</Text>
            <Text style={styles.methodText}>Licence number + DOB</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy}
            onPress={() => { setMethod('AADHAAR'); setError(''); }}
            style={[styles.method, method === 'AADHAAR' && styles.methodActive]}
          >
            <Text style={[styles.methodTitle, method === 'AADHAAR' && styles.methodTitleActive]}>Aadhaar</Text>
            <Text style={styles.methodText}>DigiLocker consent</Text>
          </TouchableOpacity>
        </View>

        {method === 'DRIVING_LICENSE' ? (
          <>
            <Text style={styles.section}>02 — DRIVING LICENCE</Text>
            <Text style={styles.inputLabel}>LICENCE NUMBER</Text>
            <TextInput
              value={documentNumber}
              onChangeText={setDocumentNumber}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="e.g. RJ1420200012345"
              placeholderTextColor="#A0A7B1"
              style={styles.input}
              editable={!busy}
              accessibilityLabel="Driving Licence number"
            />
            <Text style={styles.inputLabel}>DATE OF BIRTH</Text>
            <TextInput
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              keyboardType="numbers-and-punctuation"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#A0A7B1"
              style={styles.input}
              editable={!busy}
              maxLength={10}
              accessibilityLabel="Date of birth"
            />
          </>
        ) : (
          <>
            <Text style={styles.section}>02 — AADHAAR VERIFICATION</Text>
            <View style={styles.methodRow}>
              <TouchableOpacity disabled={busy} onPress={() => {setAadhaarMethod('DIGILOCKER');setError('');}} style={[styles.method, aadhaarMethod === 'DIGILOCKER' && styles.methodActive]}>
                <Text style={[styles.methodTitle, aadhaarMethod === 'DIGILOCKER' && styles.methodTitleActive]}>DigiLocker</Text>
                <Text style={styles.methodText}>Consent-based Aadhaar</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={busy} onPress={() => {setAadhaarMethod('NUMBER');setError('');}} style={[styles.method, aadhaarMethod === 'NUMBER' && styles.methodActive]}>
                <Text style={[styles.methodTitle, aadhaarMethod === 'NUMBER' && styles.methodTitleActive]}>Aadhaar number</Text>
                <Text style={styles.methodText}>OTP to linked mobile</Text>
              </TouchableOpacity>
            </View>
            {aadhaarMethod === 'DIGILOCKER' ? (
              <View style={styles.aadhaarInfo}>
                <Text style={styles.aadhaarTitle}>Secure Aadhaar verification</Text>
                <Text style={styles.aadhaarText}>
                  DigiLocker opens inside RideOn. Sign in, allow Aadhaar sharing, and RideOn confirms the result when Cashfree redirects back. This does not need the App Store app.
                </Text>
                {digilockerNote ? <Text style={styles.aadhaarText}>{digilockerNote}</Text> : null}
              </View>
            ) : (
              <>
                <Text style={styles.inputLabel}>AADHAAR NUMBER</Text>
                <TextInput
                  value={aadhaarNumber}
                  onChangeText={(v) => setAadhaarNumber(v.replace(/\D/g,'').slice(0,12))}
                  keyboardType="number-pad"
                  placeholder="12-digit Aadhaar number"
                  placeholderTextColor="#A0A7B1"
                  style={styles.input}
                  editable={!busy && !aadhaarOtpSent}
                  maxLength={12}
                  secureTextEntry
                />
                {aadhaarOtpSent ? (
                  <>
                    <Text style={styles.inputLabel}>OTP</Text>
                    <TextInput
                      value={aadhaarOtp}
                      onChangeText={(v) => setAadhaarOtp(v.replace(/\D/g,'').slice(0,8))}
                      keyboardType="number-pad"
                      placeholder="Enter OTP"
                      placeholderTextColor="#A0A7B1"
                      style={styles.input}
                      editable={!busy}
                      maxLength={8}
                    />
                  </>
                ) : null}
              </>
            )}
          </>
        )}

        {error ? (
          <View style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.security}>
          <Text style={styles.securityTitle}>Secure verification</Text>
          <Text style={styles.securityText}>
            Cashfree Secure ID credentials stay on the RideOn backend. RideOn stores verification status and limited references, not raw Aadhaar or licence numbers.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, busy && { opacity:0.55 }]}
          disabled={busy}
          onPress={
            method === 'AADHAAR'
              ? (aadhaarMethod === 'DIGILOCKER' ? startAadhaarDigiLocker : (aadhaarOtpSent ? verifyAadhaarOtp : sendAadhaarOtp))
              : submitDrivingLicence
          }
        >
          {busy ? <ActivityIndicator color={C.white} /> : (
            <Text style={styles.buttonText}>
              {method === 'AADHAAR'
                ? (aadhaarMethod === 'DIGILOCKER' ? 'Continue with DigiLocker' : (aadhaarOtpSent ? 'Verify Aadhaar OTP' : 'Send Aadhaar OTP'))
                : 'Verify Driving Licence'}
            </Text>
          )}
        </TouchableOpacity>

        {method === 'AADHAAR' && aadhaarMethod === 'DIGILOCKER' && aadhaarVerificationId && status !== 'APPROVED' ? (
          <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={() => syncAadhaar(aadhaarVerificationId)}>
            <Text style={styles.secondaryButtonText}>Check DigiLocker status</Text>
          </TouchableOpacity>
        ) : null}
        {method === 'AADHAAR' && aadhaarMethod === 'NUMBER' && aadhaarOtpSent ? (
          <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={() => {setAadhaarOtpSent(false);setAadhaarReferenceId(null);setAadhaarVerificationId(null);setAadhaarOtp('');}}>
            <Text style={styles.secondaryButtonText}>Use a different Aadhaar number</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={styles.backButton} disabled={busy} onPress={onBack}>
          <Text style={styles.backButtonText}>Back to profile</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},
  browser:{flex:1,backgroundColor:C.white,paddingTop:48},
  browserBar:{height:52,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line},
  browserTitle:{fontSize:16,fontWeight:'900',color:C.ink},
  browserClose:{fontSize:16,fontWeight:'800',color:C.orange},
  page:{padding:18,paddingBottom:48},
  header:{height:64,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8},
  back:{width:40,height:40,borderRadius:20,backgroundColor:C.white,textAlign:'center',textAlignVertical:'center',fontSize:28,color:C.ink,lineHeight:40,overflow:'hidden'},
  headerTitle:{fontSize:16,fontWeight:'900',color:C.ink},
  kicker:{fontSize:10,fontWeight:'900',letterSpacing:1.6,color:C.orange},
  title:{fontSize:30,fontWeight:'900',letterSpacing:-1,color:C.ink,marginTop:6},
  subtitle:{fontSize:13,color:C.muted,lineHeight:20,marginTop:8,marginBottom:18},
  statusCard:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:15,flexDirection:'row',gap:12,alignItems:'center',marginBottom:22},
  statusDot:{width:12,height:12,borderRadius:6,backgroundColor:C.orange},
  statusDotGood:{backgroundColor:C.green},
  statusLabel:{fontSize:11,fontWeight:'900',letterSpacing:.7,color:C.ink},
  statusText:{fontSize:11,color:C.muted,lineHeight:16,marginTop:3},
  section:{fontSize:10,fontWeight:'900',letterSpacing:1.4,color:C.muted,marginTop:14,marginBottom:10},
  methodRow:{flexDirection:'row',gap:10},
  method:{flex:1,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,padding:13},
  methodActive:{borderColor:C.orange,backgroundColor:'#FFF5F0'},
  methodTitle:{fontSize:12,fontWeight:'900',color:C.ink},
  methodTitleActive:{color:C.orange},
  methodText:{fontSize:10,color:C.muted,marginTop:4,lineHeight:14},
  inputLabel:{fontSize:10,fontWeight:'900',letterSpacing:1,color:C.muted,marginBottom:7,marginTop:10},
  input:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,minHeight:52,paddingHorizontal:15,fontSize:14,color:C.ink,marginBottom:6},
  aadhaarInfo:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:16,padding:15},
  aadhaarTitle:{fontSize:13,fontWeight:'900',color:C.ink},
  aadhaarText:{fontSize:11,color:C.muted,lineHeight:17,marginTop:5},
  security:{backgroundColor:C.paleGreen,borderWidth:1,borderColor:'#D6EDE2',borderRadius:15,padding:14,marginTop:14,marginBottom:12},
  securityTitle:{fontSize:12,fontWeight:'900',color:C.ink,marginBottom:3},
  securityText:{fontSize:10,color:C.muted,lineHeight:15},
  error:{backgroundColor:'#FFF0F0',borderWidth:1,borderColor:'#F2CACA',borderRadius:14,padding:12,marginTop:12},
  errorText:{fontSize:11,fontWeight:'800',color:C.danger,lineHeight:16},
  button:{height:54,borderRadius:17,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',marginTop:4},
  buttonText:{fontSize:14,fontWeight:'900',color:C.white},
  secondaryButton:{height:50,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:C.white,alignItems:'center',justifyContent:'center',marginTop:10},
  secondaryButtonText:{fontSize:12,fontWeight:'900',color:C.ink},
  backButton:{height:52,borderRadius:17,borderWidth:1,borderColor:C.line,backgroundColor:C.white,alignItems:'center',justifyContent:'center',marginTop:10},
  backButtonText:{fontSize:13,fontWeight:'900',color:C.ink},
});
