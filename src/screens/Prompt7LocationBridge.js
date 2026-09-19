import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { LocationSelector, AddressForm, SavedAddressPicker, DeliverySelector } from '../components';

export default function Prompt7LocationBridge({selectedCity,onCityChange,cityOptions,cityLoading=false,cityError='',onRetryCities,addresses=[],address,onAddressChange,onSaveAddress,delivery,onDeliveryChange}){
 const [locationOpen,setLocationOpen]=useState(false);
 const [addressMode,setAddressMode]=useState(null);
 const [selectedAddressId,setSelectedAddressId]=useState(null);
 const selectedAddress=useMemo(()=>addresses.find(a=>a.id===selectedAddressId),[addresses,selectedAddressId]);
 const selectAddress=item=>{setSelectedAddressId(item.id);onAddressChange?.([item.street,item.area,item.city].filter(Boolean).join(', ')+(item.postalCode?` — ${item.postalCode}`:''));};
 return <View>
  <TouchableOpacity onPress={()=>setLocationOpen(true)}><Text>Change location: {selectedCity}</Text></TouchableOpacity>
  <LocationSelector visible={locationOpen} selectedCity={selectedCity} locations={cityOptions} loading={cityLoading} error={cityError} onRetry={onRetryCities} onCancel={()=>setLocationOpen(false)} onConfirm={city=>{onCityChange?.(city);setLocationOpen(false);}}/>
  <DeliverySelector value={delivery} onChange={onDeliveryChange} address={address} onEditAddress={()=>setAddressMode('edit')} onSelectSaved={()=>setAddressMode('select')}/>
  {delivery&&addressMode==='select'&&<View><SavedAddressPicker addresses={addresses} selectedId={selectedAddressId} onSelect={selectAddress} onAdd={()=>setAddressMode('add')}/><TouchableOpacity onPress={()=>setAddressMode(null)}><Text>Done</Text></TouchableOpacity></View>}
  {delivery&&(addressMode==='add'||addressMode==='edit')&&<AddressForm address={addressMode==='edit'?selectedAddress:null} onCancel={()=>setAddressMode(null)} onSave={next=>{onSaveAddress?.(next,addressMode==='edit'?selectedAddress:null);setAddressMode(null);}}/>}
  {delivery&&addresses.length?<ScrollView horizontal showsHorizontalScrollIndicator={false}>{addresses.map(item=><TouchableOpacity key={item.id} onPress={()=>selectAddress(item)}><Text>{item.label}{item.default?' · Default':''}</Text></TouchableOpacity>)}</ScrollView>:null}
 </View>;
}