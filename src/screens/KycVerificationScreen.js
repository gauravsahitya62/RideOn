import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { rideOnApi } from '../services/api';

const C = {
  bg:'#F6F4F0',
  white:'#FFFFFF',
  ink:'#17202D',
  muted:'#77818F',
  orange:'#E85D35',
  green:'#258565',
  line:'#E7E3DC',
  paleGreen:'#EEF8F3',
  danger:'#B23B3B',
};

const extractVerificationId = (url) => {
  const match = String(url || '').match(/[?&]verification_id=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
};

export default function KycVerificationScreen({ onBack, onVerified }) {
  const [method, setMethod] = useState('DRIVING_LICENSE');
  const [documentNumber, setDocumentNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [status, setStatus] = useState('UNVERIFIED');
  const [verification, setVerification] = useState(null);
  const [aadhaarVerificationId, setAadhaarVerificationId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const appState = useRef(AppState.currentState);

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
    if (!verificationId || busy) return null;
    try {
      setBusy(true);
      setError('');
      const result = await rideOnApi.syncAadhaarKyc(verificationId);
      const next = applyKyc(result?.kyc);
      if (next?.documentStatus === 'APPROVED') {
        Alert.alert('Aadhaar verified', 'Your Aadhaar identity has been verified through Cashfree Secure ID. You can now book RideOn vehicles.');
      } else if (next?.documentStatus === 'REJECTED') {
        setError('Aadhaar verification was not approved. Please start the verification again.');
      }
      return next;
    } catch (e) {
      if (e?.status !== 202) {
        setError(e?.message || 'We could not update Aadhaar verification status.');
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadStatus();

    const handleUrl = ({ url }) => {
      const id = extractVerificationId(url);
      if (id) {
        setAadhaarVerificationId(id);
        syncAadhaar(id);
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => {
      const id = extractVerificationId(url);
      if (id) {
        setAadhaarVerificationId(id);
        syncAadhaar(id);
      }
    }).catch(() => {});

    const appSubscription = AppState.addEventListener('change', (nextState) => {
      const wasBackgrounded = appState.current === 'background' || appState.current === 'inactive';
      appState.current = nextState;
      if (wasBackgrounded && nextState === 'active' && aadhaarVerificationId) {
        syncAadhaar(aadhaarVerificationId);
      }
    });

    return () => {
      subscription.remove();
      appSubscription.remove();
    };
  }, [aadhaarVerificationId]);

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
        Alert.alert('Identity verified', 'Your Driving Licence has been verified by Cashfree Secure ID. You can now book RideOn vehicles.');
      } else {
        Alert.alert('Verification submitted', 'RideOn is waiting for identity verification confirmation. Booking remains locked until verification is approved.');
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

  const startAadhaar = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await rideOnApi.startAadhaarKyc();
      if (!result?.url || !result?.verificationId) {
        throw new Error('Cashfree did not return an Aadhaar verification URL.');
      }
      setAadhaarVerificationId(result.verificationId);
      await Linking.openURL(result.url);
    } catch (e) {
      setError(e?.message || 'Could not start Aadhaar verification. Please try again.');
    } finally {
      setBusy(false);
    }
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
            <Text style={styles.section}>02 — AADHAAR VIA DIGILOCKER</Text>
            <View style={styles.aadhaarInfo}>
              <Text style={styles.aadhaarTitle}>Secure Aadhaar verification</Text>
              <Text style={styles.aadhaarText}>
                RideOn will open Cashfree Secure ID's DigiLocker journey. You sign in to DigiLocker, give consent to share Aadhaar, and return to RideOn. RideOn does not ask you to type or store your Aadhaar number.
              </Text>
            </View>
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
          onPress={method === 'AADHAAR' ? startAadhaar : submitDrivingLicence}
        >
          {busy ? <ActivityIndicator color={C.white} /> : (
            <Text style={styles.buttonText}>
              {method === 'AADHAAR' ? 'Continue with Aadhaar' : 'Verify Driving Licence'}
            </Text>
          )}
        </TouchableOpacity>

        {method === 'AADHAAR' && aadhaarVerificationId && status === 'PENDING' ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            disabled={busy}
            onPress={() => syncAadhaar(aadhaarVerificationId)}
          >
            <Text style={styles.secondaryButtonText}>Check Aadhaar verification status</Text>
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
  page:{padding:18,paddingBottom:48},
  header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line,marginBottom:22},
  back:{fontSize:36,color:C.ink,lineHeight:38},
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
