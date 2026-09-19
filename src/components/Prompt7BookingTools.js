import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { AddressForm, DeliverySelector, LocationSelector, SavedAddressPicker } from '.';

export default function Prompt7BookingTools({ selectedCity, onCityChange, cityOptions, cityLoading, cityError, onRetryCities, addresses, selectedAddressId, onSelectAddress, onAddAddress, onEditAddress, delivery, onDeliveryChange, address }) {
 const [locationOpen,setLocationOpen]=useState(false);
 const [addressFormOpen,setAddressFormOpen]=useState(false);
 const [editing,setEditing]=useState(null);
 const [savedOpen,setSavedOpen]=useState(false);
 const selected=useMemo(()=>addresses.find(x=>x.id===selectedAddressId)||null,[addresses,selectedAddressId]);
 return <View>
  <TouchableOpacity onPress={()=>setLocationOpen(true)}><Text>Change location · {selectedCity}</Text></TouchableOpacity>
  <LocationSelector visible={locationOpen} selectedCity={selectedCity} locations={cityOptions} loading={cityLoading} error={cityError} onRetry={onRetryCities} onCancel={()=>setLocationOpen(false)} onConfirm={city=>{onCityChange(city);setLocationOpen(false)}} />
  <DeliverySelector value={delivery} onChange={onDeliveryChange} address={address} onEditAddress={()=>{setEditing(selected);setAddressFormOpen(true)}} onSelectSaved={()=>setSavedOpen(v=>!v)} />
  {delivery&&savedOpen?<View style={{marginTop:10}}><SavedAddressPicker addresses={addresses} selectedId={selectedAddressId} onSelect={onSelectAddress} onAdd={()=>{setEditing(null);setAddressFormOpen(true);setSavedOpen(false)}}/></View>:null}
  {addressFormOpen?<AddressForm address={editing} onCancel={()=>{setAddressFormOpen(false);setEditing(null)}} onSave={next=>{onAddAddress(next,editing);setAddressFormOpen(false);setEditing(null)}}/>:null}
 </View>;
}
