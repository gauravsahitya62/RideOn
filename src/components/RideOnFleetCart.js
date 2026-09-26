import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const C={ink:'#17202D',muted:'#78818E',orange:'#E85D35',line:'#E8EAF0',white:'#FFFFFF',soft:'#F8F9FB'};
const money=v=>`₹${Number(v||0).toLocaleString('en-IN')}`;

export default function RideOnFleetCart({items=[],onRemove,onClear,onCheckout}){
  if(!items.length)return null;
  return <View style={styles.card}>
    <View style={styles.head}>
      <View><Text style={styles.kicker}>RIDEON FLEET CART</Text><Text style={styles.title}>{items.length} vehicle{items.length===1?'':'s'} selected</Text></View>
      <TouchableOpacity onPress={onClear}><Text style={styles.link}>Clear</Text></TouchableOpacity>
    </View>
    {items.map(vehicle=><View key={String(vehicle.id)} style={styles.row}>
      <View style={styles.thumb}>
        {vehicle.images?.[0] ? <Image source={{uri:vehicle.images[0]}} style={styles.image}/> : <Text style={styles.emoji}>{vehicle.type==='Scooter'?'🛵':'🏍️'}</Text>}
      </View>
      <View style={{flex:1,minWidth:0}}>
        <Text style={styles.vehicle} numberOfLines={1}>{vehicle.name}</Text>
        <Text style={styles.meta}>{vehicle.type} · {money(vehicle.price)} / day</Text>
      </View>
      <TouchableOpacity onPress={()=>onRemove?.(vehicle)} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${vehicle.name} from cart`}>
        <Text style={styles.removeText}>×</Text>
      </TouchableOpacity>
    </View>)}
    <TouchableOpacity onPress={onCheckout} style={styles.checkout}><Text style={styles.checkoutText}>Checkout {items.length} vehicles →</Text></TouchableOpacity>
  </View>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:C.white,borderWidth:1,borderColor:C.line,borderRadius:24,padding:16,marginVertical:12},
  head:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12},
  kicker:{fontSize:9,fontWeight:'900',letterSpacing:1.4,color:C.muted},
  title:{fontSize:18,fontWeight:'900',color:C.ink,marginTop:3},
  link:{fontSize:12,fontWeight:'800',color:C.orange},
  row:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.line},
  thumb:{width:58,height:46,borderRadius:13,backgroundColor:'#EEF1F5',overflow:'hidden',alignItems:'center',justifyContent:'center'},
  image:{width:'100%',height:'100%'},
  emoji:{fontSize:24},
  vehicle:{fontSize:14,fontWeight:'900',color:C.ink},
  meta:{fontSize:10,color:C.muted,marginTop:3},
  remove:{width:30,height:30,borderRadius:15,backgroundColor:'#F5F6F8',alignItems:'center',justifyContent:'center'},
  removeText:{fontSize:19,color:C.ink,lineHeight:21},
  checkout:{marginTop:13,borderRadius:15,backgroundColor:C.ink,paddingVertical:14,alignItems:'center'},
  checkoutText:{color:C.white,fontWeight:'900',fontSize:13}
});
