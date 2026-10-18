import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authService, normalizeAuthError } from './authService';
import AccountCreated from './AccountCreated';
import LocationAccess from './LocationAccess';

const GREEN = '#067A4A';
const BUTTON = '#07A574';
const INK = '#12161C';
const MUTED = '#6B7280';
const LINE = '#E6E8EC';

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('register');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [legal, setLegal] = useState('');
  const [createdUser, setCreatedUser] = useState(null);
  const [askLocation, setAskLocation] = useState(false);
  const scrollRef = useRef(null);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const emailRef = useRef(null);
  const otpRef = useRef(null);

  const focusField = (ref) => {
    requestAnimationFrame(() => {
      ref.current?.focus?.();
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 120);
    });
  };

  const sendOtp = async () => {
    const e = email.trim().toLowerCase();
    const digits = phone.replace(/\D/g, '').replace(/^91/, '').slice(0, 10);
    if (mode === 'register' && name.trim().length < 2) return setError('Enter your full name.');
    if (mode === 'register' && digits.length !== 10) return setError('Enter a 10-digit mobile number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setError('Enter the email address where we should send your code.');
    setBusy(true);
    setError('');
    try {
      await authService.sendEmailOtp({ email: e, fullName: mode === 'register' ? name.trim() : undefined });
      setPhone(digits);
      setEmail(e);
      setOtpSent(true);
      setOtp('');
    } catch (x) {
      console.error('[RideOnAuth][SCREEN_ERROR]', JSON.stringify({ status: x?.status, code: x?.code, path: x?.path, message: x?.message }));
      setError(normalizeAuthError(x));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    const e = email.trim().toLowerCase();
    if (!/^\d{6}$/.test(otp.trim())) return setError('Enter the 6-digit verification code.');
    setBusy(true);
    setError('');
    try {
      const session = await authService.verifyEmailOtp(e, otp.trim());
      let user;
      if (mode === 'register') {
        const completed = await authService.completeRegistration({
          accessToken: session.access_token,
          accountType: 'customer',
          fullName: name.trim(),
          phone: phone ? `+91${phone}` : undefined,
        });
        user = completed?.user;
      } else {
        user = await authService.currentUser();
      }
      if (!user?.id || !['customer', 'admin', 'support', 'vendor', 'delivery_staff'].includes(user.role)) throw new Error('We could not determine your RideOn account type.');
      const nextUser = { ...user, token: session.access_token };
      if (mode === 'register' && user.role === 'customer') { setCreatedUser(nextUser); return; }
      onAuthenticated(nextUser);
    } catch (x) {
      setError(normalizeAuthError(x));
    } finally {
      setBusy(false);
    }
  };

  const signingUp = mode === 'register';
  if (createdUser && askLocation) return <LocationAccess onBack={() => setAskLocation(false)} onDone={() => onAuthenticated(createdUser)} />;
  if (createdUser) return <AccountCreated onContinue={() => setAskLocation(true)} />;

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{otpSent ? 'Check your email' : signingUp ? <>Sign <Text style={styles.titleGreen}>Up</Text></> : <>Sign <Text style={styles.titleGreen}>In</Text></>}</Text>
              <Text style={styles.sub}>{otpSent ? `Enter the 6-digit code sent to ${email}.` : signingUp ? 'Enter your details to create an account' : 'Sign in with the email on your account'}</Text>
            </View>
            <View style={styles.mark}><ScooterMark /></View>
          </View>

          {!otpSent ? <>
            {signingUp && <>
              <Field ref={nameRef} icon={<PersonMark />} label="Full Name" value={name} onChangeText={setName} placeholder="Enter your full name" autoCapitalize="words" onFocus={() => focusField(nameRef)} returnKeyType="next" onSubmitEditing={() => focusField(phoneRef)} />
              <View style={styles.phoneBox}>
                <PhoneMark />
                <Text style={styles.flag}>🇮🇳</Text>
                <Text style={styles.code}>+91</Text>
                <Text style={styles.codeChevron}>▾</Text>
                <View style={styles.phoneRule} />
                <TextInput ref={phoneRef} value={phone} onChangeText={value => setPhone(value.replace(/\D/g, '').slice(0, 10))} placeholder="Mobile Number" placeholderTextColor="#9AA3AD" keyboardType="phone-pad" style={styles.phoneInput} onFocus={() => focusField(phoneRef)} returnKeyType="next" onSubmitEditing={() => focusField(emailRef)} />
              </View>
              <Text style={styles.hint}>Your mobile number is saved on the account. The verification code is sent to your email.</Text>
            </>}
            <Field ref={emailRef} icon={<MailMark />} label={signingUp ? 'Email Address' : 'Email Address'} value={email} onChangeText={setEmail} placeholder="Enter your email address" keyboardType="email-address" onFocus={() => focusField(emailRef)} returnKeyType="done" onSubmitEditing={sendOtp} />
            {signingUp && <Text style={styles.hint}>For booking receipts, and for the code that creates your account.</Text>}
            <TouchableOpacity disabled={busy} onPress={sendOtp} style={[styles.button, busy && styles.disabled]} accessibilityRole="button">
              <Text style={styles.buttonText}>{busy ? 'Sending code…' : signingUp ? 'Create Account' : 'Send sign-in code'}</Text>
              {!busy && <Text style={styles.buttonArrow}>→</Text>}
            </TouchableOpacity>
          </> : <>
            <Field ref={otpRef} icon={<MailMark />} label="Verification code" value={otp} onChangeText={value => setOtp(value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" keyboardType="number-pad" onFocus={() => focusField(otpRef)} returnKeyType="done" onSubmitEditing={verifyOtp} />
            <TouchableOpacity disabled={busy} onPress={verifyOtp} style={[styles.button, busy && styles.disabled]} accessibilityRole="button">
              <Text style={styles.buttonText}>{busy ? 'Verifying…' : 'Continue'}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => { setOtpSent(false); setOtp(''); setError(''); }} accessibilityRole="button">
              <Text style={styles.switchLink}>Use a different email</Text>
            </TouchableOpacity>
          </>}

          {!!error && <Text style={styles.error}>{error}</Text>}

          {signingUp && !otpSent && <Text style={styles.legal}>By creating an account, you agree to our <Text style={styles.legalLink} onPress={() => setLegal('terms')}>Terms & Conditions</Text> and <Text style={styles.legalLink} onPress={() => setLegal('privacy')}>Privacy Policy</Text></Text>}
          <Modal visible={!!legal} animationType="slide" onRequestClose={() => setLegal('')}>
            <SafeAreaView style={styles.legalSheet}>
              <Text style={styles.legalTitle}>{legal === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}</Text>
              <ScrollView>
                <Text style={styles.legalBody}>{legal === 'privacy'
                  ? 'RideOn stores your name, email and phone so we can create your account and send booking receipts. The verification code is emailed to you. Location is used only after you allow it, to show rides near you. Payment details are collected by Cashfree during checkout and are not stored in this app.'
                  : 'Creating an account lets you request a RideOn rental. A booking uses the price returned by RideOn, and payment is completed in Cashfree checkout. The booking stays unpaid until RideOn verifies the payment. Identity verification is required before you can pay. Security deposits shown on the quote are refundable after the vehicle is returned.'}</Text>
              </ScrollView>
              <TouchableOpacity style={styles.button} onPress={() => setLegal('')} accessibilityRole="button"><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
            </SafeAreaView>
          </Modal>
          {!otpSent && <TouchableOpacity onPress={() => { setMode(signingUp ? 'login' : 'register'); setError(''); setOtpSent(false); }} accessibilityRole="button">
            <Text style={styles.switchText}>{signingUp ? 'Already have an account? ' : 'New to RideOn? '}<Text style={styles.switchLink}>{signingUp ? 'Sign in' : 'Create an account'}</Text></Text>
          </TouchableOpacity>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const Field = React.forwardRef(({ icon, label, value, onChangeText, placeholder, keyboardType, autoCapitalize = 'none', onFocus, returnKeyType, onSubmitEditing }, ref) =>
  <View style={styles.field}>
    <View style={styles.fieldIcon}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput ref={ref} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#B0B7C0" keyboardType={keyboardType} autoCapitalize={autoCapitalize} autoCorrect={false} style={styles.input} onFocus={onFocus} returnKeyType={returnKeyType} onSubmitEditing={onSubmitEditing} />
    </View>
  </View>);
Field.displayName = 'Field';

function ScooterMark() {
  return <View style={styles.scooter}>
    <View style={styles.scooterBody} />
    <View style={styles.scooterBar} />
    <View style={[styles.wheel, { left: 1 }]} />
    <View style={[styles.wheel, { right: 1 }]} />
  </View>;
}
function PersonMark() {
  return <View style={styles.person}><View style={styles.personHead} /><View style={styles.personBody} /></View>;
}
function PhoneMark() {
  return <View style={styles.phoneIcon}><View style={styles.phoneEar} /></View>;
}
function MailMark() {
  return <View style={styles.mail}><View style={styles.mailFlap} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6F8' },
  keyboard: { flex: 1 },
  page: { padding: 18, paddingTop: 28, paddingBottom: 28 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 20, shadowColor: '#111827', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
  title: { color: INK, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  titleGreen: { color: GREEN, fontSize: 32, lineHeight: 36, fontWeight: '800' },
  sub: { color: MUTED, fontSize: 14, lineHeight: 20, marginTop: 6 },
  mark: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E7F8EC', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: LINE, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, minHeight: 64 },
  fieldIcon: { width: 28, alignItems: 'center', marginRight: 10 },
  fieldLabel: { color: INK, fontSize: 13, fontWeight: '700' },
  input: { color: INK, fontSize: 14, paddingVertical: 2, marginTop: 1 },
  phoneBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: LINE, borderRadius: 16, paddingHorizontal: 14, minHeight: 58, marginTop: 8 },
  flag: { fontSize: 16, marginLeft: 8 },
  code: { color: INK, fontSize: 15, fontWeight: '700', marginLeft: 6 },
  codeChevron: { color: MUTED, fontSize: 10, marginLeft: 4 },
  phoneRule: { width: 1, height: 22, backgroundColor: LINE, marginHorizontal: 10 },
  phoneInput: { flex: 1, color: INK, fontSize: 15, paddingVertical: 0 },
  hint: { color: '#8B949E', fontSize: 12, lineHeight: 16, marginTop: 6, marginBottom: 8, marginLeft: 4 },
  button: { marginTop: 10, height: 54, borderRadius: 27, backgroundColor: BUTTON, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  buttonArrow: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  legal: { textAlign: 'center', color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 18 },
  legalLink: { color: GREEN, fontWeight: '700' },
  legalSheet: { flex: 1, backgroundColor: '#FFFFFF', padding: 22 },
  legalTitle: { color: INK, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  legalBody: { color: '#3C4652', fontSize: 15, lineHeight: 22 },
  switchText: { textAlign: 'center', color: MUTED, fontSize: 14, marginTop: 14 },
  switchLink: { color: GREEN, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  error: { color: '#B23B3B', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 12 },
  disabled: { opacity: 0.55 },
  scooter: { width: 26, height: 16 },
  scooterBody: { position: 'absolute', left: 4, top: 4, width: 14, height: 6, borderWidth: 1.6, borderColor: GREEN, borderRadius: 3 },
  scooterBar: { position: 'absolute', right: 3, top: 0, width: 7, height: 8, borderLeftWidth: 1.6, borderBottomWidth: 1.6, borderColor: GREEN, transform: [{ rotate: '-24deg' }] },
  wheel: { position: 'absolute', bottom: 0, width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: GREEN },
  person: { width: 16, height: 18, alignItems: 'center' },
  personHead: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: '#66707A' },
  personBody: { width: 12, height: 7, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderWidth: 1.5, borderColor: '#66707A', marginTop: 2 },
  phoneIcon: { width: 14, height: 18, borderRadius: 3, borderWidth: 1.5, borderColor: '#66707A', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 },
  phoneEar: { width: 4, height: 1.5, backgroundColor: '#66707A' },
  mail: { width: 18, height: 13, borderRadius: 2, borderWidth: 1.5, borderColor: '#66707A', overflow: 'hidden' },
  mailFlap: { position: 'absolute', left: 2, right: 2, top: 1, height: 7, borderLeftWidth: 1.4, borderRightWidth: 1.4, borderBottomWidth: 1.4, borderColor: '#66707A', transform: [{ rotate: '0deg' }] },
});
