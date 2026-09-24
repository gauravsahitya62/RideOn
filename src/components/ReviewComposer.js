import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',bg:'#F6F7F9',line:'#E8EAF0',white:'#FFFFFF',green:'#16845B',red:'#B23B3B'};

export default function ReviewComposer({visible,onClose,onSubmit,title='Rate your experience',subtitle='Your feedback helps keep RideOn trustworthy.',initialReview=null,busy=false,error=''}) {
  const [rating,setRating]=useState(initialReview?.rating||0);
  const [comment,setComment]=useState(initialReview?.comment||'');
  const inputRef=useRef(null);
  useEffect(()=>{if(visible){setRating(initialReview?.rating||0);setComment(initialReview?.comment||'');}},[visible,initialReview?.id,initialReview?.rating,initialReview?.comment]);
  const submit=()=>{if(!rating){return;}onSubmit?.({rating,comment:comment.trim()||null});};
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={busy?undefined:onClose}>
    <View style={S.shade}><KeyboardAvoidingView style={S.sheetWrap} behavior={Platform.OS==='ios'?'padding':undefined}>
      <View style={S.sheet}>
        <View style={S.handle}/>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={S.content}>
          <View style={S.head}><View style={{flex:1}}><Text style={S.title}>{title}</Text><Text style={S.sub}>{subtitle}</Text></View><TouchableOpacity disabled={busy} onPress={onClose} style={S.close}><Text style={S.closeText}>×</Text></TouchableOpacity></View>
          <Text style={S.label}>YOUR RATING</Text>
          <View style={S.stars}>{[1,2,3,4,5].map(value=><TouchableOpacity key={value} disabled={busy} onPress={()=>setRating(value)} accessibilityRole="button" accessibilityLabel={value+' star'+(value===1?'':'s')} style={S.starButton}><Text style={[S.star,value<=rating&&S.starOn]}>★</Text></TouchableOpacity>)}</View>
          <Text style={S.ratingHint}>{rating ? ['','Not for me','Could be better','Good experience','Very good','Excellent experience'][rating] : 'Tap a star to rate'}</Text>
          <Text style={S.label}>COMMENT <Text style={S.optional}>OPTIONAL</Text></Text>
          <TextInput ref={inputRef} value={comment} onChangeText={setComment} maxLength={1000} multiline editable={!busy} placeholder="Share a few words about your experience…" placeholderTextColor="#9AA2AD" style={S.input} textAlignVertical="top" returnKeyType="default" blurOnSubmit={false}/>
          <Text style={S.counter}>{comment.length}/1000</Text>
          {error?<View style={S.error}><Text style={S.errorText}>{error}</Text></View>:null}
          <TouchableOpacity disabled={busy||!rating} onPress={submit} style={[S.submit,(busy||!rating)&&S.disabled]}>{busy?<ActivityIndicator color={C.white}/>:<Text style={S.submitText}>{initialReview?'Save changes':'Submit review'}</Text>}</TouchableOpacity>
          <Text style={S.note}>Only verified completed bookings can be reviewed. Reviews are tied to this booking.</Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView></View>
  </Modal>;
}
const S=StyleSheet.create({shade:{flex:1,backgroundColor:'#10151F77',justifyContent:'flex-end'},sheetWrap:{width:'100%',maxHeight:'92%'},sheet:{backgroundColor:C.bg,borderTopLeftRadius:28,borderTopRightRadius:28,overflow:'hidden'},handle:{width:44,height:5,borderRadius:4,backgroundColor:'#D2D7DE',alignSelf:'center',marginTop:10},content:{padding:20,paddingBottom:34},head:{flexDirection:'row',alignItems:'flex-start',gap:12,marginTop:8,marginBottom:22},title:{fontSize:24,fontWeight:'900',color:C.ink,letterSpacing:-.5},sub:{fontSize:12,color:C.muted,lineHeight:18,marginTop:5},close:{width:36,height:36,borderRadius:18,backgroundColor:C.white,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},closeText:{fontSize:25,color:C.ink,lineHeight:28},label:{fontSize:10,fontWeight:'900',letterSpacing:1.4,color:'#596371',marginBottom:9,marginTop:8},optional:{fontSize:9,color:C.muted,letterSpacing:.5},stars:{flexDirection:'row',justifyContent:'center',gap:10,paddingVertical:5},starButton:{padding:4},star:{fontSize:40,color:'#D7DCE3'},starOn:{color:'#F5B940'},ratingHint:{textAlign:'center',fontSize:12,fontWeight:'800',color:C.muted,marginBottom:18},input:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:16,minHeight:120,padding:15,fontSize:14,color:C.ink,lineHeight:20},counter:{fontSize:10,color:C.muted,textAlign:'right',marginTop:6},error:{backgroundColor:'#FFF0F0',borderColor:'#F4CCCC',borderWidth:1,borderRadius:12,padding:11,marginTop:10},errorText:{color:C.red,fontSize:12,fontWeight:'700',lineHeight:17},submit:{height:54,borderRadius:16,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',marginTop:16},submitText:{color:C.white,fontSize:14,fontWeight:'900'},disabled:{opacity:.45},note:{fontSize:10,color:C.muted,lineHeight:15,textAlign:'center',marginTop:12}});
