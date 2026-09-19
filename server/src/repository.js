import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const iso = (value) => value instanceof Date ? value.toISOString() : value;

export function createRepository({ databaseUrl, fleet }) {
  const useDatabase = Boolean(databaseUrl);
  const pool = useDatabase ? new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  }) : null;
  const memory = { customers:new Map(), bookings:new Map(), idempotency:new Map(), paymentEvents:new Map() };

  const mapCustomer = (row) => row && ({ id:String(row.id), fullName:row.full_name ?? row.fullName, phone:row.phone, email:row.email || undefined });
  const mapBooking = (row) => {
    if (!row) return null;
    const vehicle = row.vehicle || fleet.find((v) => v.id === row.vehicle_id);
    const startAt = iso(row.start_at ?? row.startAt);
    const endAt = iso(row.end_at ?? row.endAt);
    return {
      id:String(row.id),
      customerId:String(row.customer_id ?? row.customerId),
      vehicleId:String(row.vehicle_id ?? row.vehicleId),
      vehicle:vehicle ? { id:vehicle.id, name:vehicle.name, type:vehicle.type } : undefined,
      startAt, endAt,
      delivery:row.delivery_required ?? row.delivery,
      address:row.delivery_address ?? row.address,
      notes:row.customer_notes ?? row.notes,
      pricing:{
        days:row.days ?? Math.max(1, Math.ceil((new Date(endAt)-new Date(startAt))/86400000)),
        rental:Number(row.rental_total ?? row.rental_total_paise ?? 0),
        deliveryFee:Number(row.delivery_fee ?? row.delivery_fee_paise ?? 0),
        platformFee:Number(row.platform_fee ?? row.platform_fee_paise ?? 0),
        total:Number(row.total ?? row.total_paise ?? 0),
        currency:'INR'
      },
      status:row.status,
      paymentStatus:row.payment_status,
      paymentProviderReference:row.payment_provider_reference || undefined,
      createdAt:iso(row.created_at ?? row.createdAt),
      updatedAt:iso(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt)
    };
  };

  async function health() {
    if (!pool) return { mode:'memory', persistent:false };
    try { const r=await pool.query('select 1 as ok'); return { mode:'postgres', persistent:r.rows[0]?.ok===1, reachable:true }; }
    catch { return { mode:'postgres', persistent:false, reachable:false }; }
  }

  async function createCustomer({fullName,phone,email,passwordHash}) {
    if (useDatabase) {
      try {
        const {rows}=await pool.query('insert into customers (full_name, phone, email, password_hash) values ($1,$2,$3,$4) returning id,full_name,phone,email',[fullName,phone,email||null,passwordHash]);
        return mapCustomer(rows[0]);
      } catch(e) { if(e.code==='23505'){const x=new Error('customer exists');x.code='CUSTOMER_EXISTS';throw x;} throw e; }
    }
    if ([...memory.customers.values()].some(c=>c.phone===phone)){const x=new Error('customer exists');x.code='CUSTOMER_EXISTS';throw x;}
    const id=crypto.randomUUID(); memory.customers.set(id,{id,fullName,phone,email,passwordHash}); return {id,fullName,phone,email};
  }

  async function findCustomerByPhone(phone) {
    if (useDatabase) { const {rows}=await pool.query('select id,full_name,phone,email,password_hash from customers where phone=$1',[phone]); return rows[0]?{...mapCustomer(rows[0]),passwordHash:rows[0].password_hash}:null; }
    const c=[...memory.customers.values()].find(v=>v.phone===phone); return c?{id:c.id,fullName:c.fullName,phone:c.phone,email:c.email,passwordHash:c.passwordHash}:null;
  }

  async function isVehicleUnavailable(vehicleId,startAt,endAt) {
    if (!useDatabase) return [...memory.bookings.values()].some(b=>b.vehicleId===vehicleId&&['requested','confirmed','in_progress'].includes(b.status)&&new Date(startAt)<new Date(b.endAt)&&new Date(endAt)>new Date(b.startAt));
    const {rows}=await pool.query('select 1 from bookings where vehicle_id=$1 and status in (\'requested\',\'confirmed\',\'in_progress\') and start_at<$3 and end_at>$2 limit 1',[vehicleId,startAt,endAt]);
    return rows.length>0;
  }

  async function createBooking(input) {
    if (useDatabase) {
      const client=await pool.connect();
      try {
        await client.query('begin');
        if(input.idempotencyKey){
          const idem=await client.query('select b.* from booking_idempotency_keys i join bookings b on b.id=i.booking_id where i.customer_id=$1 and i.idempotency_key=$2 for share',[input.customerId,input.idempotencyKey]);
          if(idem.rows[0]){await client.query('commit');const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=mapBooking({...idem.rows[0],vehicle:fleet.find(v=>v.id===idem.rows[0].vehicle_id)});throw x;}
        }
        const {rows}=await client.query('insert into bookings (customer_id,vehicle_id,start_at,end_at,delivery_required,delivery_address,delivery_fee_paise,rental_total_paise,platform_fee_paise,total_paise,status,payment_status,customer_notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'requested\',\'unpaid\',$11) returning *',[input.customerId,input.vehicle.id,input.startAt,input.endAt,input.delivery,input.address,input.pricing.deliveryFee,input.pricing.rental,input.pricing.platformFee,input.pricing.total,input.notes||null]);
        if(input.idempotencyKey) await client.query('insert into booking_idempotency_keys (customer_id,idempotency_key,booking_id) values ($1,$2,$3)',[input.customerId,input.idempotencyKey,rows[0].id]);
        await client.query('insert into booking_status_events (booking_id,next_status,actor_type,actor_id) values ($1,\'requested\',\'customer\',$2)',[rows[0].id,input.customerId]);
        await client.query('commit');
        return mapBooking({...rows[0],vehicle:input.vehicle});
      } catch(e) {
        try{await client.query('rollback');}catch{}
        if(e.code==='23P01'){const x=new Error('vehicle unavailable');x.code='VEHICLE_UNAVAILABLE';throw x;}
        if(e.code==='23505'&&input.idempotencyKey){const {rows}=await client.query('select b.* from booking_idempotency_keys i join bookings b on b.id=i.booking_id where i.customer_id=$1 and i.idempotency_key=$2',[input.customerId,input.idempotencyKey]);if(rows[0]){const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=mapBooking({...rows[0],vehicle:fleet.find(v=>v.id===rows[0].vehicle_id)});throw x;}}
        throw e;
      } finally { client.release(); }
    }
    const key=input.idempotencyKey?`${input.customerId}:${input.idempotencyKey}`:null;
    if(key&&memory.idempotency.has(key)){const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=memory.idempotency.get(key);throw x;}
    if([...memory.bookings.values()].some(b=>b.vehicleId===input.vehicle.id&&['requested','confirmed','in_progress'].includes(b.status)&&new Date(input.startAt)<new Date(b.endAt)&&new Date(input.endAt)>new Date(b.startAt))){const x=new Error('vehicle unavailable');x.code='VEHICLE_UNAVAILABLE';throw x;}
    const id=crypto.randomUUID();const booking={id,customerId:input.customerId,vehicleId:input.vehicle.id,vehicle:input.vehicle,startAt:input.startAt,endAt:input.endAt,delivery:input.delivery,address:input.address,notes:input.notes,pricing:input.pricing,status:'requested',paymentStatus:'unpaid',createdAt:new Date().toISOString()};memory.bookings.set(id,booking);if(key)memory.idempotency.set(key,booking);return booking;
  }

  async function getBooking(id){if(!useDatabase)return memory.bookings.get(id)||null;const {rows}=await pool.query('select * from bookings where id=$1',[id]);return rows[0]?mapBooking({...rows[0],vehicle:fleet.find(v=>v.id===rows[0].vehicle_id)}):null;}
  async function listCustomerBookings({customerId,limit,offset}){if(!useDatabase)return [...memory.bookings.values()].filter(b=>b.customerId===customerId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(offset,offset+limit);const {rows}=await pool.query('select * from bookings where customer_id=$1 order by created_at desc limit $2 offset $3',[customerId,limit,offset]);return rows.map(r=>mapBooking({...r,vehicle:fleet.find(v=>v.id===r.vehicle_id)}));}
  async function cancelBooking(id,customerId){if(!useDatabase){const b=memory.bookings.get(id);if(!b||b.customerId!==customerId||!['requested','confirmed'].includes(b.status))return null;b.status='cancelled';b.updatedAt=new Date().toISOString();return b;}const {rows}=await pool.query('update bookings set status=\'cancelled\',updated_at=now() where id=$1 and customer_id=$2 and status in (\'requested\',\'confirmed\') returning *',[id,customerId]);if(!rows[0])return null;await pool.query('insert into booking_status_events (booking_id,previous_status,next_status,actor_type,actor_id) values ($1,\'requested\',\'cancelled\',\'customer\',$2)',[id,customerId]);return mapBooking({...rows[0],vehicle:fleet.find(v=>v.id===rows[0].vehicle_id)});}
  async function applyPaymentEvent(event){if(!useDatabase){if(memory.paymentEvents.has(event.eventId))return{applied:false,duplicate:true};memory.paymentEvents.set(event.eventId,event);const b=memory.bookings.get(event.bookingId);if(!b)return{applied:false,duplicate:false};b.paymentStatus=event.status;b.paymentProviderReference=event.providerReference;b.updatedAt=new Date().toISOString();return{applied:true,duplicate:false};}const client=await pool.connect();try{await client.query('begin');const ins=await client.query('insert into payment_events (provider_event_id,booking_id,status,provider_reference,received_at) values ($1,$2,$3,$4,now()) on conflict (provider_event_id) do nothing returning id',[event.eventId,event.bookingId,event.status,event.providerReference||null]);if(!ins.rows[0]){await client.query('commit');return{applied:false,duplicate:true};}const up=await client.query('update bookings set payment_status=$2,payment_provider_reference=$3,updated_at=now() where id=$1 and $2 in (\'pending\',\'paid\',\'failed\',\'refunded\') returning id',[event.bookingId,event.status,event.providerReference||null]);await client.query('commit');return{applied:up.rows.length>0,duplicate:false};}catch(e){await client.query('rollback');throw e;}finally{client.release();}}
  return {health,createCustomer,findCustomerByPhone,isVehicleUnavailable,createBooking,getBooking,listCustomerBookings,cancelBooking,applyPaymentEvent};
}
