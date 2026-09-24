import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authService, normalizeAuthError } from './authService';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',line:'#E8EAF0',white:'#FFFFFF'};

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
  const [accountType,setAccountType]=useState('customer');
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [serviceCity,setServiceCity]=useState('');
  const [email,setEmail]=useState('');
  const [otp,setOtp]=useState('');
  const [otpSent,setOtpSent]=useState(false);
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
    if(mode==='register'&&accountType==='vendor'&&!/^\+?[0-9]{10,15}$/.test(phone.trim())) return setError('Enter a valid phone number for vendor registration.');
    if(mode==='register'&&accountType==='vendor'&&serviceCity.trim().length<2) return setError('Enter your vendor service city.');
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
      console.log('[RideOnAuth][OTP_VERIFY_START]', JSON.stringify({ email: e, mode, accountType }));
      const session=await authService.verifyEmailOtp(e,otp.trim());
      console.log('[RideOnAuth][OTP_VERIFY_SUCCESS]', JSON.stringify({ hasAccessToken: Boolean(session?.access_token) }));
      let user;
      if(mode==='register'){
                const completed=await authService.completeRegistration({
          accessToken:session.access_token,
          accountType,
          fullName:name.trim(),
          phone:phone.trim() || undefined,
          serviceCity:serviceCity.trim() || undefined,
        });
        user=completed?.user;
      } else {
        user=await authService.currentUser();
      }
      if(!user?.id||!['customer','vendor'].includes(user.role)) throw new Error('We could not determine your RideOn account type.');
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
      scrollEventThrottle={16}
      onContentSizeChange={()=>{ if(otpSent && otp) return; }}
    >
      <Text style={s.brand}>ride<Text style={{color:C.orange}}>.on</Text></Text>
      <Text style={s.kicker}>SECURE ACCESS</Text>
      <Text style={s.title}>{otpSent?'Verify your email':'Welcome to RideOn'}</Text>
      <Text style={s.sub}>
        {otpSent?('Enter the 6-digit code sent to '+email+'.'):'Sign in or create your RideOn account with email verification.'}
      </Text>

      {!otpSent ? <>
        <View style={s.tabs}>
          <TouchableOpacity onPress={()=>setMode('login')} style={[s.tab,mode==='login'&&s.tabActive]}>
            <Text style={[s.tabText,mode==='login'&&s.tabTextActive]}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setMode('register')} style={[s.tab,mode==='register'&&s.tabActive]}>
            <Text style={[s.tabText,mode==='register'&&s.tabTextActive]}>Register</Text>
          </TouchableOpacity>
        </View>

        {mode==='register'&&<>
          <Text style={s.sectionTitle}>ACCOUNT TYPE</Text>
          <View style={s.tabs}>
            <TouchableOpacity onPress={()=>setAccountType('customer')} style={[s.tab,s.typeTab,accountType==='customer'&&s.tabActive]}>
              <Text style={[s.tabText,accountType==='customer'&&s.tabTextActive]}>Customer</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setAccountType('vendor')} style={[s.tab,s.typeTab,accountType==='vendor'&&s.tabActive]}>
              <Text style={[s.tabText,accountType==='vendor'&&s.tabTextActive]}>Vendor</Text>
            </TouchableOpacity>
          </View>
          <Field ref={nameRef} label="FULL NAME" value={name} onChangeText={setName} placeholder="Your full name" onFocus={()=>focusField(nameRef)} returnKeyType="next" onSubmitEditing={()=>focusField(phoneRef)}/>
          <Field ref={phoneRef} label="PHONE NUMBER" value={phone} onChangeText={setPhone} placeholder="+91 9876543210" keyboardType="phone-pad" onFocus={()=>focusField(phoneRef)} returnKeyType="next" onSubmitEditing={()=>focusField(emailRef)}/>
          {accountType==='vendor'&&<Field label="SERVICE CITY" value={serviceCity} onChangeText={setServiceCity} placeholder="e.g. Udaipur" onFocus={()=>focusField(emailRef)} returnKeyType="next" onSubmitEditing={()=>focusField(emailRef)}/>} 
        </>}

        <Field ref={emailRef} label="EMAIL ADDRESS" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" onFocus={()=>focusField(emailRef)} returnKeyType="done"/>
        <TouchableOpacity disabled={busy} onPress={sendOtp} style={[s.button,busy&&s.disabled]}>
          <Text style={s.buttonText}>{busy?'Sending…':'Send verification code'}</Text>
        </TouchableOpacity>
      </> : <>
        <Field ref={otpRef} label="VERIFICATION CODE" value={otp} onChangeText={v=>setOtp(v.replace(/\D/g,'').slice(0,6))} placeholder="123456" keyboardType="number-pad" onFocus={()=>focusField(otpRef)} returnKeyType="done"/>
        <TouchableOpacity disabled={busy} onPress={verifyOtp} style={[s.button,busy&&s.disabled]}>
          <Text style={s.buttonText}>{busy?'Verifying…':'Verify & continue'}</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={busy} onPress={()=>{setOtpSent(false);setOtp('');setError('');}}>
          <Text style={s.change}>Use a different email</Text>
        </TouchableOpacity>
      </>}

      {!!error&&<View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
      <Text style={s.note}>Authentication is handled by Supabase. RideOn stores only the session token required for authenticated API access.</Text>
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},
  keyboard:{flex:1},
  page:{padding:22,paddingTop:46,paddingBottom:40},
  brand:{fontSize:34,fontWeight:'900',letterSpacing:-1.8,color:C.ink},
  kicker:{fontSize:10,fontWeight:'900',letterSpacing:2,color:C.muted,marginTop:7},
  title:{fontSize:30,fontWeight:'900',letterSpacing:-.8,color:C.ink,marginTop:18},
  sub:{fontSize:13,color:C.muted,lineHeight:20,marginTop:7,marginBottom:22},
  tabs:{flexDirection:'row',gap:8,marginBottom:18,flexWrap:'wrap'},
  tab:{paddingHorizontal:18,paddingVertical:10,borderRadius:30,borderWidth:1,borderColor:C.line,backgroundColor:C.white},
  typeTab:{minWidth:110,alignItems:'center'},
  tabActive:{backgroundColor:C.ink,borderColor:C.ink},
  tabText:{fontSize:12,fontWeight:'800',color:C.muted},
  tabTextActive:{color:C.white},
  sectionTitle:{fontSize:11,fontWeight:'900',letterSpacing:1,color:'#596371',marginBottom:9},
  fieldWrap:{marginBottom:15},
  label:{fontSize:11,fontWeight:'900',letterSpacing:.6,color:'#596371',marginBottom:8},
  field:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:14,paddingHorizontal:14,paddingVertical:14,fontSize:16,lineHeight:22,color:C.ink,minHeight:54},
  button:{backgroundColor:C.orange,paddingVertical:15,borderRadius:15,alignItems:'center',marginTop:2},
  buttonText:{color:C.white,fontSize:14,fontWeight:'900'},
  change:{color:C.orange,fontSize:12,fontWeight:'800',textAlign:'center',marginTop:18},
  error:{backgroundColor:'#FFF0F0',borderWidth:1,borderColor:'#F4CCCC',borderRadius:13,padding:12,marginTop:14},
  errorText:{color:'#B23B3B',fontSize:12,lineHeight:18,fontWeight:'700'},
  note:{fontSize:10,color:C.muted,lineHeight:16,marginTop:22},
  disabled:{opacity:.55},
});
