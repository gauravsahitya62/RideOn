import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  CameraRoll,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { launchCameraAsync, MediaTypeOptions } from 'expo-image-picker';
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
  paleOrange:'#FFF5EE',
  danger:'#B23B3B',
};

async function captureImage() {
  const result = await launchCameraAsync({
    mediaTypes: MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.7,
    base64: true,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]?.base64) return null;
  return {
    uri: result.assets[0].uri,
    base64: result.assets[0].base64,
  };
}

export default function KycVerificationScreen({ onBack, onVerified }) {
  const [documentType, setDocumentType] = useState('DRIVING_LICENSE');
  const [documentNumber, setDocumentNumber] = useState('');
  const [document, setDocument] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [status, setStatus] = useState('UNVERIFIED');
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState('');
  const [error, setError] = useState('');

  const loadStatus = async () => {
    try {
      const result = await rideOnApi.getKycStatus();
      setStatus(result?.kyc?.status || 'UNVERIFIED');
      setVerification(result?.kyc?.activeVerification || null);
    } catch (e) {
      setError(e?.message || 'We could not load your verification status.');
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const capture = async (kind) => {
    setError('');
    setCaptureBusy(kind);
    try {
      const image = await captureImage();
      if (!image) return;
      if (kind === 'document') setDocument(image);
      else setSelfie(image);
    } catch (e) {
      setError('Camera access was not completed. Please allow camera access and try again.');
    } finally {
      setCaptureBusy('');
    }
  };

  const submit = async () => {
    setError('');
    const number = documentNumber.trim();
    if (number.length < 6) return setError('Enter a valid document number.');
    if (!document?.base64) return setError('Capture your identity document first.');
    if (!selfie?.base64) return setError('Capture the live selfie before submitting.');
    setBusy(true);
    try {
      const result = await rideOnApi.submitKycVerification({
        documentType,
        documentNumber: number,
        documentImageBase64: document.base64,
        selfieImageBase64: selfie.base64,
      });
      const next = result?.kyc;
      setVerification(next || null);
      setStatus(next?.documentStatus || (result?.success ? 'PENDING' : 'UNVERIFIED'));
      if (next?.documentStatus === 'APPROVED') {
        Alert.alert('Identity verified', 'Your driver credentials have been verified. You can now book RideOn vehicles.');
        onVerified?.(next);
      } else {
        Alert.alert('Verification submitted', 'RideOn is waiting for provider confirmation. Booking remains locked until verification is approved.');
      }
    } catch (e) {
      setError(e?.code === 'KYC_BLACKLISTED'
        ? 'Identity verification cannot be completed for this account.'
        : e?.message || 'Identity verification could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = status === 'VERIFIED' || status === 'APPROVED'
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
          <View style={{ width: 28 }} />
        </View>

        <Text style={styles.kicker}>RIDEON KYC</Text>
        <Text style={styles.title}>Verify your driver credentials</Text>
        <Text style={styles.subtitle}>
          Complete identity verification once before booking a RideOn vehicle. Your document number is hashed for RideOn risk screening and is not stored as plain text.
        </Text>

        <View style={styles.statusCard}>
          <View style={[styles.statusDot, (status === 'VERIFIED' || status === 'APPROVED') && styles.statusDotGood]} />
          <View style={{ flex:1 }}>
            <Text style={styles.statusLabel}>{statusLabel}</Text>
            <Text style={styles.statusText}>
              {status === 'VERIFIED' || status === 'APPROVED'
                ? 'You are eligible to book RideOn vehicles.'
                : status === 'PENDING'
                  ? 'Provider confirmation is still pending.'
                  : 'Booking remains locked until verification is approved.'}
            </Text>
          </View>
        </View>

        <Text style={styles.section}>01 — IDENTITY DOCUMENT</Text>
        <View style={styles.choiceRow}>
          {[
            ['DRIVING_LICENSE','Driving licence'],
            ['AADHAAR','Aadhaar'],
          ].map(([value, label]) => (
            <TouchableOpacity
              key={value}
              disabled={busy}
              onPress={() => setDocumentType(value)}
              style={[styles.choice, documentType === value && styles.choiceActive]}
            >
              <Text style={[styles.choiceText, documentType === value && styles.choiceTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.inputLabel}>DOCUMENT NUMBER</Text>
        <View style={styles.input}>
          <Text style={styles.inputText}>{documentNumber || 'Enter your document number in the field above'}</Text>
        </View>
        <View style={styles.numberInputWrap}>
          <Text style={styles.numberPlaceholder}>{documentType === 'DRIVING_LICENSE' ? 'DL number' : 'Aadhaar number'}</Text>
          <TouchableOpacity style={styles.hiddenEntry} onPress={() => {}}>
            <Text style={styles.hiddenEntryText}>{documentNumber || 'Use the document number field in your keyboard input.'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.captureCard} onPress={() => capture('document')} disabled={Boolean(captureBusy) || busy}>
          <View style={styles.captureIcon}><Text style={styles.captureIconText}>ID</Text></View>
          <View style={{ flex:1 }}>
            <Text style={styles.captureTitle}>{document ? 'Document captured' : 'Capture document'}</Text>
            <Text style={styles.captureText}>
              {document ? 'Ready for secure verification.' : 'Place the complete document inside the camera frame.'}
            </Text>
          </View>
          {captureBusy === 'document' ? <ActivityIndicator color={C.orange} /> : <Text style={styles.chevron}>›</Text>}
        </TouchableOpacity>

        <Text style={styles.section}>02 — LIVE SELFIE</Text>
        <TouchableOpacity style={styles.captureCard} onPress={() => capture('selfie')} disabled={Boolean(captureBusy) || busy}>
          <View style={styles.captureIcon}><Text style={styles.captureIconText}>●</Text></View>
          <View style={{ flex:1 }}>
            <Text style={styles.captureTitle}>{selfie ? 'Live selfie captured' : 'Capture live selfie'}</Text>
            <Text style={styles.captureText}>
              {selfie ? 'Ready for face-match and liveness checks.' : 'Use the front camera with your face clearly visible.'}
            </Text>
          </View>
          {captureBusy === 'selfie' ? <ActivityIndicator color={C.orange} /> : <Text style={styles.chevron}>›</Text>}
        </TouchableOpacity>

        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.security}>
          <Text style={styles.securityTitle}>Secure verification</Text>
          <Text style={styles.securityText}>
            RideOn sends the captured images to the configured identity-verification provider. Images are not stored in the RideOn KYC database.
          </Text>
        </View>

        <TouchableOpacity style={[styles.button, busy && { opacity:0.55 }]} disabled={busy} onPress={submit}>
          {busy ? <ActivityIndicator color={C.white} /> : <Text style={styles.buttonText}>Submit for verification</Text>}
        </TouchableOpacity>

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
  section:{fontSize:10,fontWeight:'900',letterSpacing:1.4,color:C.muted,marginTop:7,marginBottom:10},
  choiceRow:{flexDirection:'row',gap:8,marginBottom:16},
  choice:{flex:1,padding:13,borderWidth:1,borderColor:C.line,borderRadius:14,backgroundColor:C.white,alignItems:'center'},
  choiceActive:{borderColor:C.orange,backgroundColor:'#FFF7F3'},
  choiceText:{fontSize:12,fontWeight:'800',color:C.muted},
  choiceTextActive:{color:C.ink},
  inputLabel:{fontSize:10,fontWeight:'900',letterSpacing:1,color:C.muted,marginBottom:7},
  input:{display:'none'},
  inputText:{fontSize:14},
  numberInputWrap:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,minHeight:52,justifyContent:'center',paddingHorizontal:15,marginBottom:12},
  numberPlaceholder:{fontSize:14,color:C.muted},
  hiddenEntry:{display:'none'},
  hiddenEntryText:{fontSize:14,color:C.ink},
  captureCard:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:14,flexDirection:'row',alignItems:'center',gap:12,marginBottom:20},
  captureIcon:{width:46,height:46,borderRadius:15,backgroundColor:'#FFF0E9',alignItems:'center',justifyContent:'center'},
  captureIconText:{fontSize:12,fontWeight:'900',color:C.orange},
  captureTitle:{fontSize:13,fontWeight:'900',color:C.ink},
  captureText:{fontSize:11,color:C.muted,lineHeight:16,marginTop:3},
  chevron:{fontSize:25,color:C.muted},
  security:{backgroundColor:C.paleGreen,borderWidth:1,borderColor:'#D6EDE2',borderRadius:15,padding:14,marginBottom:12},
  securityTitle:{fontSize:12,fontWeight:'900',color:C.ink,marginBottom:3},
  securityText:{fontSize:10,color:C.muted,lineHeight:15},
  error:{backgroundColor:'#FFF0F0',borderWidth:1,borderColor:'#F2CACA',borderRadius:14,padding:12,marginBottom:12},
  errorText:{fontSize:11,fontWeight:'800',color:C.danger,lineHeight:16},
  button:{height:54,borderRadius:17,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',marginTop:4},
  buttonText:{fontSize:14,fontWeight:'900',color:C.white},
  backButton:{height:52,borderRadius:17,borderWidth:1,borderColor:C.line,backgroundColor:C.white,alignItems:'center',justifyContent:'center',marginTop:10},
  backButtonText:{fontSize:13,fontWeight:'900',color:C.ink},
});
