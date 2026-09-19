import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF'};

export default function DeliverySelector({value,onChange,address,onEditAddress,onSelectSaved,disabled=false}){
  return <View>
    <View style={styles.row}>
      <TouchableOpacity disabled={disabled} onPress={()=>onChange?.(false)} style={[styles.choice,!value&&styles.active]} accessibilityRole="radio" accessibilityState={{selected:!value}}>
        <Text style={styles.icon}>⌂</Text><View style={{flex:1}}><Text style={styles.title}>Self pickup</Text><Text style={styles.sub}>Collect the vehicle yourself</Text></View><Text style={[styles.radio,!value&&styles.radioActive]}>{!value?'●':'○'}</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={disabled} onPress={()=>onChange?.(true)} style={[styles.choice,value&&styles.active]} accessibilityRole="radio" accessibilityState={{selected:value}}>
        <Text style={styles.icon}>⌖</Text><View style={{flex:1}}><Text style={styles.title}>Doorstep delivery</Text><Text style={styles.sub}>Uses the existing booking delivery flag</Text></View><Text style={[styles.radio,value&&styles.radioActive]}>{value?'●':'○'}</Text>
      </TouchableOpacity>
    </View>
    {value?<View style={styles.address}><View style={{flex:1}}><Text style={styles.label}>DELIVERY ADDRESS</Text><Text style={styles.addressText}>{address||'Enter a delivery address.'}</Text></View>{onEditAddress?<TouchableOpacity onPress={onEditAddress}><Text style={styles.link}>Edit</Text></TouchableOpacity>:null}{onSelectSaved?<TouchableOpacity onPress={onSelectSaved}><Text style={styles.link}>Saved</Text></TouchableOpacity>:null}</View>:null}
  </View>;
}

const styles=StyleSheet.create({
 row:{gap:8},choice:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,padding:13},active:{borderColor:C.orange,backgroundColor:'#FFF6F2'},icon:{fontSize:18,color:C.orange,width:24,textAlign:'center'},title:{fontSize:13,fontWeight:'900',color:C.ink},sub:{fontSize:10,color:C.muted,lineHeight:15,marginTop:2},radio:{fontSize:16,color:'#B4BAC4'},radioActive:{color:C.orange},address:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:15,padding:14,marginTop:9},label:{fontSize:9,fontWeight:'900',letterSpacing:.7,color:'#596371',marginBottom:4},addressText:{fontSize:12,color:C.ink,lineHeight:18},link:{fontSize:11,fontWeight:'900',color:C.orange,paddingVertical:5}
});