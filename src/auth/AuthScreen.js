import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authService, normalizeAuthError } from './authService';

const C={ink:'#111827',muted:'#6B7280',orange:'#E56A3D',bg:'#F7F5F1',line:'#E7E2DA',white:'#FFFFFF'};

const Field=React.forwardRef(({label,value,onChangeText,placeholder,keyboardType,onFocus,returnKeyType,onSubmitEditing},ref)=>
  <View style={s.fieldWrap}>
    <Text style={s.label}>{label}</Text>
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor="#A0A7B1"
      style={s.field}
      onFocus={onFocus}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
    />
  </View>);
Field.displayName='Field';

export default function AuthScreen({onAuthenticated}) {
  const [mode,setMode]=useState('login');
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [email,setEmail]=useState('');
  const [otp,setOtp]=useState('');
  const [otpSent,setOtpSent]=useState(false);
  const [agreed,setAgreed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const scrollRef=useRef(null);
  const nameRef=useRef(null);
  const phoneRef=useRef(null);
  const emailRef=useRef(null);
  const otpRef=useRef(null);

  const focusField=(ref)=>{
    requestAnimationFrame(()=>{
      ref.current?.focus?.();
      setTimeout(()=>scrollRef.current?.scrollToEnd?.({animated:true}),120);
    });
  };

  const sendOtp=async()=>{
    const e=email.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setError('Enter a valid email address.');
    if(mode==='register'&&name.trim().length<2) return setError('Enter your full name.');
    if(mode==='register'&&phone.trim()&&!/^\+?[0-9]{10,15}$/.test(phone.trim())) return setError('Enter a valid phone number.');
    if(mode==='register'&&!agreed) return setError('Please agree to the terms to create an account.');
    setBusy(true);setError('');
    try{
      await authService.sendEmailOtp({email:e,fullName:mode==='register'?name.trim():undefined});
      setEmail(e);setOtpSent(true);setOtp('');
    }catch(x){
      console.error('[RideOnAuth][SCREEN_ERROR]', JSON.stringify({ status:x?.status, code:x?.code, path:x?.path, message:x?.message }));
      setError(normalizeAuthError(x));
    }
    finally{setBusy(false);}
  };

  const verifyOtp=async()=>{
    const e=email.trim().toLowerCase();
    if(!/^\d{6}$/.test(otp.trim())) return setError('Enter the 6-digit verification code.');
    setBusy(true);setError('');
    try{
      console.log('[RideOnAuth][OTP_VERIFY_START]', JSON.stringify({ email: e, mode }));
      const session=await authService.verifyEmailOtp(e,otp.trim());
      console.log('[RideOnAuth][OTP_VERIFY_SUCCESS]', JSON.stringify({ hasAccessToken: Boolean(session?.access_token) }));
      let user;
      if(mode==='register'){
                const completed=await authService.completeRegistration({
          accessToken:session.access_token,
          accountType:'customer',
          fullName:name.trim(),
          phone:phone.trim() || undefined,
        });
        user=completed?.user;
      } else {
        user=await authService.currentUser();
      }
      if(!user?.id||!['customer','admin','support','vendor','delivery_staff'].includes(user.role)) throw new Error('We could not determine your RideOn account type.');
      onAuthenticated({...user,token:session.access_token});
    }catch(x){setError(normalizeAuthError(x));}
    finally{setBusy(false);}
  };

  return <SafeAreaView style={s.safe} edges={['top','bottom']}>
    <KeyboardAvoidingView
      style={s.keyboard}
      behavior={Platform.OS==='ios'?'padding':undefined}
      keyboardVerticalOffset={Platform.OS==='ios'?12:0}
    >
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
    >
      <Text style={s.title}>{otpSent?'Check your email':mode==='register'?'Create your account':'Welcome back'}</Text>
      <Text style={s.cardSub}>{otpSent?('Enter the 6-digit code sent to '+email+'.'):mode==='register'?'Join RideOn and book a ride in your city.':'Sign in to continue your journey.'}</Text>

      {!otpSent ? <>
        {mode==='register'&&<>
          <Field ref={nameRef} label="Full name" value={name} onChangeText={setName} placeholder="Your full name" onFocus={()=>focusField(nameRef)} returnKeyType="next" onSubmitEditing={()=>focusField(phoneRef)}/>
          <Field ref={phoneRef} label="Phone number" value={phone} onChangeText={setPhone} placeholder="98765 43210" keyboardType="phone-pad" onFocus={()=>focusField(phoneRef)} returnKeyType="next" onSubmitEditing={()=>focusField(emailRef)}/>
        </>}
        <Field ref={emailRef} label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" onFocus={()=>focusField(emailRef)} returnKeyType="done"/>
        {mode==='register'&&<TouchableOpacity style={s.terms} onPress={()=>setAgreed(v=>!v)} accessibilityRole="checkbox" accessibilityState={{checked:agreed}}>
          <View style={[s.box,agreed&&s.boxOn]}>{agreed&&<Text style={s.boxTick}>✓</Text>}</View>
          <Text style={s.termsText}>I agree to the Terms and Conditions and Privacy Policy.</Text>
        </TouchableOpacity>}
        <TouchableOpacity disabled={busy} onPress={sendOtp} style={[s.button,busy&&s.disabled]}>
          <Text style={s.buttonText}>{busy?'Sending code…':mode==='register'?'Sign up':'Send sign-in code'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={()=>{setMode(mode==='register'?'login':'register');setError('');}} accessibilityRole="button">
          <Text style={s.switchText}>{mode==='register'?'Already have an account? ':'New to RideOn? '}<Text style={s.switchLink}>{mode==='register'?'Sign in':'Create an account'}</Text></Text>
        </TouchableOpacity>
      </> : <>
        <Field ref={otpRef} label="Verification code" value={otp} onChangeText={v=>setOtp(v.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code" keyboardType="number-pad" onFocus={()=>focusField(otpRef)} returnKeyType="done"/>
        <TouchableOpacity disabled={busy} onPress={verifyOtp} style={[s.button,busy&&s.disabled]}>
          <Text style={s.buttonText}>{busy?'Verifying…':'Continue'}</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={busy} onPress={()=>{setOtpSent(false);setOtp('');setError('');}}>
          <Text style={s.change}>Use a different email</Text>
        </TouchableOpacity>
      </>}

      {!!error&&<View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},
  keyboard:{flex:1},
  page:{padding:24,paddingTop:36,paddingBottom:36},
  title:{fontSize:30,lineHeight:36,fontWeight:'700',color:C.ink},
  cardSub:{fontSize:15,color:C.muted,lineHeight:22,marginTop:8,marginBottom:22},
  fieldWrap:{marginBottom:14},
  label:{fontSize:13,fontWeight:'700',color:C.ink,marginBottom:8},
  field:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:14,paddingHorizontal:16,paddingVertical:15,fontSize:16,lineHeight:22,color:C.ink,minHeight:54},
  terms:{flexDirection:'row',alignItems:'flex-start',gap:10,marginBottom:8},
  box:{width:22,height:22,borderRadius:6,borderWidth:1.5,borderColor:C.line,backgroundColor:C.white,alignItems:'center',justifyContent:'center',marginTop:1},
  boxOn:{backgroundColor:C.orange,borderColor:C.orange},
  boxTick:{color:C.white,fontSize:13,fontWeight:'700'},
  termsText:{flex:1,color:C.muted,fontSize:13,lineHeight:19},
  switchText:{textAlign:'center',color:C.muted,fontSize:14,marginTop:18},
  switchLink:{color:C.orange,fontWeight:'700'},
  button:{backgroundColor:C.orange,minHeight:54,borderRadius:16,alignItems:'center',justifyContent:'center',marginTop:4},
  buttonText:{color:C.white,fontSize:16,fontWeight:'800'},
  change:{color:C.orange,fontSize:14,fontWeight:'700',textAlign:'center',marginTop:16},
  error:{backgroundColor:'#FFF0F0',borderRadius:14,padding:12,marginTop:14},
  errorText:{color:'#B23B3B',fontSize:13,lineHeight:18,fontWeight:'700'},
  disabled:{opacity:.55},
});
