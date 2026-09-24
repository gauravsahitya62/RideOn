import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { rideOnApi } from './api';

export const DELIVERY_TRACKING_TASK = 'rideon-active-delivery-location';
const BOOKING_KEY='rideon_tracking_booking_id';

TaskManager.defineTask(DELIVERY_TRACKING_TASK, async ({data,error})=>{
  if(error)return;
  const locations=data?.locations||[];
  const latest=locations[locations.length-1];
  if(!latest?.coords)return;
  const bookingId=await SecureStore.getItemAsync(BOOKING_KEY);
  if(!bookingId)return;
  try{
    await rideOnApi.restoreAccessToken();
    await rideOnApi.updateDeliveryLocation(bookingId,{
      latitude:latest.coords.latitude,
      longitude:latest.coords.longitude,
      accuracyMeters:latest.coords.accuracy,
      recordedAt:new Date(latest.timestamp||Date.now()).toISOString(),
    });
  }catch(updateError){
    if(['TRACKING_SESSION_EXPIRED','TRACKING_NOT_ACTIVE','DELIVERY_COMPLETION_NOT_ALLOWED'].includes(updateError?.code))await stopDeliveryLocationTask();
    // Background tasks must never crash the location service because the API
    // is temporarily unavailable. The next GPS batch retries the update.
  }
});

export async function startDeliveryLocationTask(bookingId){
  await SecureStore.setItemAsync(BOOKING_KEY,String(bookingId));
  const registered=await TaskManager.isTaskRegisteredAsync(DELIVERY_TRACKING_TASK);
  if(registered)return;
  const permission=await Location.getBackgroundPermissionsAsync();
  if(permission.status!=='granted')throw new Error('Background location permission is required while delivering.');
  await Location.startLocationUpdatesAsync(DELIVERY_TRACKING_TASK,{
    accuracy:Location.Accuracy.Balanced,
    timeInterval:Math.max(5000,Number(process.env.EXPO_PUBLIC_TRACKING_INTERVAL_MS||10000)),
    distanceInterval:Math.max(20,Number(process.env.EXPO_PUBLIC_TRACKING_DISTANCE_METERS||50)),
    pausesUpdatesAutomatically:false,
    showsBackgroundLocationIndicator:true,
    foregroundService:{
      notificationTitle:'RideOn delivery is active',
      notificationBody:'Your vehicle delivery location is being shared with the customer.',
      notificationColor:'#E85D35',
    },
    activityType:Location.ActivityType.AutomotiveNavigation,
  });
}

export async function stopDeliveryLocationTask(){
  try{
    const registered=await TaskManager.isTaskRegisteredAsync(DELIVERY_TRACKING_TASK);
    if(registered)await Location.stopLocationUpdatesAsync(DELIVERY_TRACKING_TASK);
  }finally{
    await SecureStore.deleteItemAsync(BOOKING_KEY).catch(()=>{});
  }
}
