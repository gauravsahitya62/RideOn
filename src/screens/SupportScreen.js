import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { rideOnApi } from '../services/api';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',line:'#E8EAF0',white:'#FFFFFF',navy:'#202B3B',green:'#258565',red:'#C94B4B'};
const categories=['Payment','Refund','Security Deposit','Booking','Vehicle','Delivery','Pickup/Return','Damage','Cancellation','Account','Technical Issue','Other'];
const priorities=['low','normal','high','urgent'];

const friendlySupportError=(error,fallback)=>{
  const status=Number(error?.status||0);
  const code=String(error?.code||'');
  if(status===401||code==='AUTH_REQUIRED'||code==='INVALID_TOKEN')return 'Your session has expired. Please sign in again.';
  if(status===403||code==='FORBIDDEN')return 'You do not have permission to access this support request.';
  if(code==='SUPPORT_TICKET_CLOSED')return 'This ticket is closed. Reopen it before sending another message.';
  if(code==='INVALID_SUPPORT_MESSAGE')return 'Please enter a message of up to 5000 characters.';
  if(code==='INVALID_SUPPORT_CATEGORY')return 'Please choose a valid issue category.';
  if(code==='INVALID_SUPPORT_DESCRIPTION')return 'Please describe the issue in at least 10 characters.';
  if(code==='INVALID_SUPPORT_TRANSITION')return 'That ticket status change is not available right now.';
  if(/network|unreachable|timed out|failed to fetch/i.test(String(error?.message||'')))return 'Please check your connection and try again.';
  return fallback;
};

const statusLabel=value=>String(value||'open').replace(/_/g,' ').replace(/\b\w/g,x=>x.toUpperCase());
const categoryForBooking=booking=>{
  if(!booking)return 'Booking';
  const status=String(booking.securityDepositStatus||'').toLowerCase();
  if(status&&['deducted','disputed','inspection_required'].includes(status))return 'Security Deposit';
  if(booking.cancellationReason)return 'Cancellation';
  if(String(booking.paymentStatus||'').toLowerCase()!=='paid')return 'Payment';
  if(booking.delivery)return 'Delivery';
  return 'Booking';
};

export default function SupportScreen({ booking=null, onBack, embedded=false }){
  const [tickets,setTickets]=useState([]);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [view,setView]=useState('list');
  const [selectedTicket,setSelectedTicket]=useState(null);
  const [messages,setMessages]=useState([]);
  const [messagesLoading,setMessagesLoading]=useState(false);
  const [detailError,setDetailError]=useState('');
  const [category,setCategory]=useState(categoryForBooking(booking));
  const [priority,setPriority]=useState('normal');
  const [subject,setSubject]=useState('');
  const [description,setDescription]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [createError,setCreateError]=useState('');
  const [toast,setToast]=useState('');
  const requestKeyRef=useRef(null);

  const loadTickets=useCallback(async({silent=false}={})=>{
    if(!silent)setLoading(true);
    setError('');
    try{
      const result=await rideOnApi.listSupportTickets();
      setTickets(Array.isArray(result?.tickets)?result.tickets:[]);
    }catch(e){setError(friendlySupportError(e,'We could not load your support tickets right now. Please retry.'));}
    finally{setLoading(false);setRefreshing(false);}
  },[]);

  const openTicket=async ticket=>{
    setSelectedTicket(ticket);setView('detail');setMessages([]);setDetailError('');setMessagesLoading(true);
    try{
      const [detail,msgResult]=await Promise.all([rideOnApi.getSupportTicket(ticket.id),rideOnApi.getSupportMessages(ticket.id)]);
      setSelectedTicket(detail?.ticket||ticket);setMessages(Array.isArray(msgResult?.messages)?msgResult.messages:[]);
    }catch(e){setDetailError(friendlySupportError(e,'We could not load this support conversation right now. Please retry.'));}
    finally{setMessagesLoading(false);}
  };

  const startCreate=nextBooking=>{
    setSelectedTicket(null);setView('create');setCategory(categoryForBooking(nextBooking));setPriority('normal');
    setSubject(nextBooking?'Help with booking '+nextBooking.id:'');setDescription('');setCreateError('');requestKeyRef.current=null;
  };

  const submitTicket=async()=>{
    if(busy)return;
    if(!subject.trim()||subject.trim().length<3){setCreateError('Please add a short subject.');return;}
    if(description.trim().length<10){setCreateError('Please describe the issue in at least 10 characters.');return;}
    setBusy(true);setCreateError('');
    if(!requestKeyRef.current)requestKeyRef.current='support:'+Date.now()+':'+Math.random().toString(36).slice(2,10);
    try{
      const result=await rideOnApi.createSupportTicket({
        bookingId:booking?.id||null,category,priority,subject:subject.trim(),description:description.trim()
      },requestKeyRef.current);
      const ticket=result?.ticket;
      requestKeyRef.current=null;
      setView('detail');setSelectedTicket(ticket);setToast(result?.idempotentReplay?'Your support request is already recorded.':'Support request created.');
      await loadTickets({silent:true});
      if(ticket)await openTicket(ticket);
    }catch(e){setCreateError(friendlySupportError(e,'We could not create the support request right now. Your details are still here; please retry.'));}
    finally{setBusy(false);}
  };

  const sendMessage=async()=>{
    if(busy||!selectedTicket?.id||!message.trim())return;
    const draft=message;
    setBusy(true);setDetailError('');
    try{
      const result=await rideOnApi.addSupportMessage(selectedTicket.id,draft);
      setMessages(old=>[...old,result.message]);
      setMessage('');
      const detail=await rideOnApi.getSupportTicket(selectedTicket.id);
      if(detail?.ticket)setSelectedTicket(detail.ticket);
      await loadTickets({silent:true});
    }catch(e){setDetailError(friendlySupportError(e,'We could not send your message. Your text is still here; please retry.'));}
    finally{setBusy(false);}
  };

  const closeTicket=async()=>{
    if(busy||!selectedTicket?.id)return;
    setBusy(true);setDetailError('');
    try{const result=await rideOnApi.closeSupportTicket(selectedTicket.id);setSelectedTicket(result?.ticket||selectedTicket);setToast('Ticket closed. You can reopen it if the issue returns.');await loadTickets({silent:true});}
    catch(e){setDetailError(friendlySupportError(e,'We could not close this ticket right now. Please retry.'));}
    finally{setBusy(false);}
  };

  const reopenTicket=async()=>{
    if(busy||!selectedTicket?.id)return;
    setBusy(true);setDetailError('');
    try{const result=await rideOnApi.reopenSupportTicket(selectedTicket.id);setSelectedTicket(result?.ticket||selectedTicket);setToast('Ticket reopened.');await loadTickets({silent:true});}
    catch(e){setDetailError(friendlySupportError(e,'We could not reopen this ticket right now. Please retry.'));}
    finally{setBusy(false);}
  };

  useEffect(()=>{loadTickets();},[loadTickets]);
  useEffect(()=>{if(booking){setView('create');setCategory(categoryForBooking(booking));setSubject('Help with booking '+booking.id);}},[booking?.id]);

  const header=<View style={S.header}>
    <TouchableOpacity onPress={()=>{if(view!=='list'){setView('list');setSelectedTicket(null);}else onBack?.();}}><Text style={S.back}>‹</Text></TouchableOpacity>
    <View style={{flex:1}}><Text style={S.title}>{view==='list'?'Help & support':view==='create'?'Report an issue':'Support ticket'}</Text><Text style={S.subtitle}>{view==='list'?'We keep booking and payment issues tied to the right record.':view==='create'?'Tell RideOn what happened. No financial action is taken automatically.':selectedTicket?.ticketNumber||'Ticket details'}</Text></View>
    {view==='list'&&<TouchableOpacity style={S.newButton} onPress={()=>startCreate(null)}><Text style={S.newButtonText}>New</Text></TouchableOpacity>}
  </View>;

  const bookingCard=booking&&<View style={S.contextCard}><View style={{flex:1}}><Text style={S.eyebrow}>BOOKING CONTEXT</Text><Text style={S.contextTitle}>{booking.vehicle||booking.vehicleName||'RideOn vehicle'}</Text><Text style={S.muted}>Booking {booking.id}</Text><Text style={S.muted}>{booking.status?statusLabel(booking.status):'Booking details loaded from RideOn'}</Text></View><Text style={S.contextIcon}>?</Text></View>;

  const createForm=<ScrollView contentContainerStyle={S.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" showsVerticalScrollIndicator={false}>
    {bookingCard}
    <View style={S.card}><Text style={S.section}>Issue category</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chips}>{categories.map(x=><TouchableOpacity key={x} onPress={()=>setCategory(x)} style={[S.chip,category===x&&S.chipActive]}><Text style={[S.chipText,category===x&&S.chipTextActive]}>{x}</Text></TouchableOpacity>)}</ScrollView>
      <Text style={S.section}>Priority</Text><View style={S.chips}>{priorities.map(x=><TouchableOpacity key={x} onPress={()=>setPriority(x)} style={[S.chip,priority===x&&S.chipActive]}><Text style={[S.chipText,priority===x&&S.chipTextActive]}>{x}</Text></TouchableOpacity>)}</View>
      <Text style={S.section}>Subject</Text><TextInput value={subject} onChangeText={setSubject} maxLength={160} placeholder="What do you need help with?" placeholderTextColor="#9AA3AF" style={S.input} returnKeyType="next" blurOnSubmit={false}/>
      <Text style={S.section}>Description</Text><TextInput value={description} onChangeText={setDescription} maxLength={5000} multiline blurOnSubmit={false} placeholder="Explain what happened and what you need from RideOn." placeholderTextColor="#9AA3AF" style={[S.input,S.textarea]} textAlignVertical="top" keyboardDismissMode="none"/>
      <Text style={S.counter}>{description.length}/5000</Text>
      {booking&&<Text style={S.note}>This request is linked to the selected booking. RideOn support will review the issue without changing payment, refund, deposit or damage records just because this ticket exists.</Text>}
      {!!createError&&<View style={S.error}><Text style={S.errorText}>{createError}</Text></View>}
      <TouchableOpacity disabled={busy} style={[S.primary,busy&&S.disabled]} onPress={submitTicket}><Text style={S.primaryText}>{busy?'Submitting…':'Create support request'}</Text></TouchableOpacity>
    </View>
  </ScrollView>;

  const detail=<KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?8:0}>
    <ScrollView contentContainerStyle={S.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="none" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);if(selectedTicket)openTicket(selectedTicket);else loadTickets();}}}>
      {selectedTicket&&<View style={S.card}><View style={S.row}><View style={{flex:1}}><Text style={S.eyebrow}>{selectedTicket.ticketNumber}</Text><Text style={S.contextTitle}>{selectedTicket.subject}</Text></View><View style={S.statusPill}><Text style={S.statusText}>{statusLabel(selectedTicket.status)}</Text></View></View><Text style={S.muted}>{selectedTicket.category} · {selectedTicket.priority}</Text>{selectedTicket.booking&&<View style={S.bookingMini}><Text style={S.section}>Booking</Text><Text style={S.body}>{selectedTicket.booking.vehicleName||'RideOn vehicle'} · {selectedTicket.booking.id}</Text><Text style={S.muted}>{selectedTicket.booking.status?statusLabel(selectedTicket.booking.status):''}{selectedTicket.booking.address?' · '+selectedTicket.booking.address:''}</Text></View>}<View style={S.description}><Text style={S.body}>{selectedTicket.description}</Text></View>{selectedTicket.resolution&&<View style={S.resolution}><Text style={S.section}>Resolution</Text><Text style={S.body}>{selectedTicket.resolution}</Text></View>}</View>}
      {messagesLoading?<View style={S.empty}><ActivityIndicator color={C.orange}/><Text style={S.muted}>Loading conversation…</Text></View>:messages.map(m=><View key={m.id} style={[S.message,m.senderUserId===selectedTicket?.raisedByUserId?S.userMessage:S.supportMessage]}><View style={S.row}><Text style={S.messageSender}>{m.senderName||'RideOn support'}</Text><Text style={S.messageDate}>{m.createdAt?new Date(m.createdAt).toLocaleString():''}</Text></View><Text style={S.messageText}>{m.message}</Text></View>)}
      {!!detailError&&<View style={S.error}><Text style={S.errorText}>{detailError}</Text></View>}
      {selectedTicket&&<><View style={S.replyCard}><TextInput value={message} onChangeText={setMessage} maxLength={5000} multiline blurOnSubmit={false} placeholder={selectedTicket.status==='closed'?'Reopen the ticket to reply':'Write a reply to RideOn support…'} placeholderTextColor="#9AA3AF" editable={selectedTicket.status!=='closed'&&!busy} style={S.replyInput} textAlignVertical="top" keyboardDismissMode="none"/><View style={S.replyFooter}><Text style={S.counter}>{message.length}/5000</Text><TouchableOpacity disabled={busy||!message.trim()||selectedTicket.status==='closed'} onPress={sendMessage} style={[S.send,busy&&S.disabled]}><Text style={S.sendText}>{busy?'Sending…':'Send'}</Text></TouchableOpacity></View></View><View style={S.actions}>{['open','in_progress','waiting_for_user','resolved'].includes(selectedTicket.status)&&<TouchableOpacity disabled={busy} onPress={closeTicket} style={S.secondary}><Text style={S.secondaryText}>Close ticket</Text></TouchableOpacity>}{['closed','resolved'].includes(selectedTicket.status)&&<TouchableOpacity disabled={busy} onPress={reopenTicket} style={S.primarySmall}><Text style={S.primaryText}>Reopen ticket</Text></TouchableOpacity>}</View></>}
    </ScrollView>
  </KeyboardAvoidingView>;

  const list=<ScrollView contentContainerStyle={S.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);loadTickets();}}}>
    <View style={S.hero}><Text style={S.heroIcon}>?</Text><View style={{flex:1}}><Text style={S.heroTitle}>RideOn support</Text><Text style={S.heroCopy}>Raise a booking issue, dispute or technical problem and keep the conversation in one place.</Text></View></View>
    {booking&&<TouchableOpacity onPress={()=>startCreate(booking)} style={S.getHelp}><View style={{flex:1}}><Text style={S.getHelpTitle}>Get help with this booking</Text><Text style={S.muted}>{booking.vehicle||'Selected booking'} · {booking.id}</Text></View><Text style={S.chevron}>›</Text></TouchableOpacity>}
    {loading?<View style={S.empty}><ActivityIndicator color={C.orange}/><Text style={S.muted}>Loading your tickets…</Text></View>:error?<View style={S.empty}><Text style={S.emptyIcon}>!</Text><Text style={S.body}>Support tickets are unavailable.</Text><Text style={S.muted}>{error}</Text><TouchableOpacity style={S.secondary} onPress={()=>loadTickets()}><Text style={S.secondaryText}>Retry</Text></TouchableOpacity></View>:tickets.length===0?<View style={S.empty}><Text style={S.emptyIcon}>◌</Text><Text style={S.body}>No support tickets yet</Text><Text style={S.muted}>If something goes wrong with a booking, payment, refund, deposit, delivery or vehicle, start a request here.</Text><TouchableOpacity style={S.primarySmall} onPress={()=>startCreate(null)}><Text style={S.primaryText}>Create a support request</Text></TouchableOpacity></View>:tickets.map(t=><TouchableOpacity key={t.id} style={S.ticket} onPress={()=>openTicket(t)}><View style={S.row}><View style={{flex:1}}><Text style={S.eyebrow}>{t.ticketNumber}</Text><Text style={S.ticketTitle}>{t.subject}</Text></View><View style={S.statusPill}><Text style={S.statusText}>{statusLabel(t.status)}</Text></View></View><Text style={S.muted}>{t.category} · {t.priority}{t.bookingId?' · Booking linked':''}</Text><Text numberOfLines={2} style={S.muted}>{t.description}</Text><Text style={S.updated}>Updated {t.updatedAt?new Date(t.updatedAt).toLocaleString():''} · Open →</Text></TouchableOpacity>)}
  </ScrollView>;

  return <View style={[S.safe,embedded&&{flex:1}]}>{header}{view==='list'?list:view==='create'?createForm:detail}{!!toast&&<TouchableOpacity style={S.toast} onPress={()=>setToast('')}><Text style={S.toastText}>{toast} ×</Text></TouchableOpacity>}</View>;
}

const S=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},header:{minHeight:68,paddingHorizontal:18,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:10,borderBottomWidth:1,borderBottomColor:C.line,backgroundColor:C.bg},back:{fontSize:35,lineHeight:38,color:C.ink},title:{fontSize:18,fontWeight:'900',color:C.ink},subtitle:{fontSize:10,color:C.muted,marginTop:2},newButton:{paddingHorizontal:13,paddingVertical:9,borderRadius:12,backgroundColor:C.ink},newButtonText:{color:C.white,fontWeight:'900',fontSize:12},page:{padding:17,paddingBottom:42,gap:12},hero:{backgroundColor:C.navy,borderRadius:22,padding:18,flexDirection:'row',gap:14,alignItems:'center'},heroIcon:{width:48,height:48,borderRadius:24,backgroundColor:'#FFF4EF',color:C.orange,fontSize:27,fontWeight:'900',textAlign:'center',textAlignVertical:'center'},heroTitle:{fontSize:20,fontWeight:'900',color:C.white},heroCopy:{fontSize:11,color:'#C6CDD6',lineHeight:17,marginTop:4},getHelp:{backgroundColor:C.white,borderWidth:1,borderColor:'#F1D7CE',borderRadius:18,padding:16,flexDirection:'row',alignItems:'center'},getHelpTitle:{fontSize:14,fontWeight:'900',color:C.ink},chevron:{fontSize:28,color:'#A0A7B1'},card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16},section:{fontSize:11,fontWeight:'900',letterSpacing:.5,color:C.ink,marginTop:8,marginBottom:8},chips:{flexDirection:'row',gap:8,paddingBottom:4,flexWrap:'wrap'},chip:{paddingHorizontal:11,paddingVertical:9,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:C.bg},chipActive:{backgroundColor:C.ink,borderColor:C.ink},chipText:{fontSize:10,fontWeight:'800',color:C.muted},chipTextActive:{color:C.white},input:{backgroundColor:C.bg,borderWidth:1,borderColor:C.line,borderRadius:14,paddingHorizontal:13,paddingVertical:13,fontSize:14,color:C.ink},textarea:{minHeight:150,paddingTop:14},counter:{fontSize:9,color:C.muted,alignSelf:'flex-end',marginTop:5},note:{fontSize:10,color:C.muted,lineHeight:15,backgroundColor:'#FFF8EE',borderRadius:12,padding:12,marginTop:8},primary:{backgroundColor:C.orange,borderRadius:15,paddingVertical:15,alignItems:'center',marginTop:10},primarySmall:{backgroundColor:C.orange,borderRadius:13,paddingVertical:12,paddingHorizontal:16,alignItems:'center'},primaryText:{color:C.white,fontSize:12,fontWeight:'900'},disabled:{opacity:.5},error:{backgroundColor:'#FFF0F0',borderWidth:1,borderColor:'#F4CCCC',borderRadius:12,padding:12,marginTop:8},errorText:{fontSize:11,color:C.red,fontWeight:'800',lineHeight:16},empty:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:24,alignItems:'center',gap:8},emptyIcon:{fontSize:32,color:C.orange},body:{fontSize:14,fontWeight:'800',color:C.ink},muted:{fontSize:11,color:C.muted,lineHeight:17},ticket:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:18,padding:16,gap:5},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},eyebrow:{fontSize:9,letterSpacing:1.2,fontWeight:'900',color:C.muted,marginBottom:4},ticketTitle:{fontSize:15,fontWeight:'900',color:C.ink},statusPill:{backgroundColor:'#EAF6F0',paddingHorizontal:9,paddingVertical:6,borderRadius:10},statusText:{fontSize:9,fontWeight:'900',color:C.green},updated:{fontSize:9,color:C.orange,fontWeight:'800',marginTop:5},contextCard:{backgroundColor:'#FFF4EF',borderWidth:1,borderColor:'#F3D5CA',borderRadius:18,padding:15,flexDirection:'row',alignItems:'center',gap:10},contextTitle:{fontSize:17,fontWeight:'900',color:C.ink},contextIcon:{width:42,height:42,borderRadius:21,backgroundColor:C.white,color:C.orange,fontSize:23,fontWeight:'900',textAlign:'center',textAlignVertical:'center'},bookingMini:{marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:C.line},description:{marginTop:13,paddingTop:13,borderTopWidth:1,borderTopColor:C.line},resolution:{marginTop:12,padding:12,borderRadius:12,backgroundColor:'#EEF9F4'},message:{padding:13,borderRadius:16,marginBottom:9,borderWidth:1,borderColor:C.line},userMessage:{backgroundColor:'#FFF4EF',marginLeft:24},supportMessage:{backgroundColor:C.white,marginRight:24},messageSender:{fontSize:10,fontWeight:'900',color:C.ink},messageDate:{fontSize:8,color:C.muted},messageText:{fontSize:13,color:C.ink,lineHeight:19,marginTop:7},replyCard:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:16,padding:12,marginTop:4},replyInput:{minHeight:90,maxHeight:180,fontSize:14,color:C.ink,padding:7},replyFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},send:{backgroundColor:C.ink,paddingHorizontal:18,paddingVertical:10,borderRadius:12},sendText:{color:C.white,fontSize:11,fontWeight:'900'},actions:{flexDirection:'row',gap:9},secondary:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:13,paddingVertical:12,paddingHorizontal:16,alignItems:'center'},secondaryText:{color:C.ink,fontSize:11,fontWeight:'900'},toast:{position:'absolute',left:18,right:18,bottom:22,backgroundColor:C.ink,padding:14,borderRadius:14,alignItems:'center'},toastText:{color:C.white,fontSize:11,fontWeight:'800'}
});
