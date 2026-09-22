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

  const mapCustomer = (row) => row && ({ id:String(row.id), fullName:row.full_name ?? row.fullName, phone:row.phone, email:row.email || undefined, role:row.role || 'customer', supabaseUserId:row.supabase_user_id || row.supabaseUserId || undefined });
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
        rental:Number(row.rental_total ?? ((row.rental_total_paise ?? 0) / 100)),
        deliveryFee:Number(row.delivery_fee ?? ((row.delivery_fee_paise ?? 0) / 100)),
        platformFee:Number(row.platform_fee ?? ((row.platform_fee_paise ?? 0) / 100)),
        total:Number(row.total ?? ((row.total_paise ?? 0) / 100)),
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

  async function close() {
    if (pool) await pool.end();
  }

  async function listVehicles({ type, city, q } = {}) {
    if (!useDatabase) {
      const typeValue = type?.toLowerCase();
      const cityValue = city?.toLowerCase();
      const qValue = q?.toLowerCase();
      return fleet.filter((v) =>
        v.active &&
        (!typeValue || typeValue === 'all' || String(v.type).toLowerCase() === typeValue) &&
        (!cityValue || String(v.city).toLowerCase() === cityValue) &&
        (!qValue || `${v.name} ${v.subtitle || ''}`.toLowerCase().includes(qValue))
      );
    }

    const params = [];
    const where = ['active = true'];
    if (type && type.toLowerCase() !== 'all') {
      params.push(type.toLowerCase());
      where.push(`type = ${params.length}`);
    }
    if (city) {
      params.push(city);
      where.push(`lower(city) = lower(${params.length})`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(name ilike ${params.length} or coalesce(make, '') ilike ${params.length} or coalesce(model, '') ilike ${params.length})`);
    }

    const { rows } = await pool.query(
      `select id, type, name, city, daily_rate_paise, active, transmission, fuel, seats
       from vehicles
       where ${where.join(' and ')}
       order by name asc`,
      params
    );

    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      name: row.name,
      subtitle: [row.transmission, row.seats ? `${row.seats} seats` : null, row.fuel].filter(Boolean).join(' · '),
      pricePerDay: Number(row.daily_rate_paise || 0) / 100,
      city: row.city,
      seats: row.seats == null ? null : Number(row.seats),
      transmission: row.transmission || null,
      fuel: row.fuel || null,
      active: Boolean(row.active),
    }));
  }

  async function getVehicle(id) {
    if (!useDatabase) return fleet.find((v) => v.id === id && v.active) || null;
    const { rows } = await pool.query(
      'select id, type, name, city, daily_rate_paise, active, transmission, fuel, seats from vehicles where id = $1 and active = true',
      [id]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      type: String(row.type),
      name: row.name,
      subtitle: [row.transmission, row.seats ? `${row.seats} seats` : null, row.fuel].filter(Boolean).join(' · '),
      pricePerDay: Number(row.daily_rate_paise || 0) / 100,
      city: row.city,
      seats: row.seats == null ? null : Number(row.seats),
      transmission: row.transmission || null,
      fuel: row.fuel || null,
      active: Boolean(row.active),
    };
  }

  async function createOrLinkCustomerFromSupabase({supabaseUserId,email,fullName}) {
    if (useDatabase) {
      const existingByEmail = await findCustomerByEmail(email);
      if (existingByEmail) {
        await pool.query('update customers set supabase_user_id=$2, email=coalesce(email,$3), full_name=coalesce(full_name,$4), updated_at=now() where id=$1',[existingByEmail.id,supabaseUserId,email,fullName]);
        return { ...existingByEmail, supabaseUserId, role: existingByEmail.role || 'customer' };
      }
      const phone = 'supabase-' + supabaseUserId;
      const { rows } = await pool.query('insert into customers(full_name,phone,email,password_hash,supabase_user_id,role) values($1,$2,$3,$4,$5,'customer') returning id,full_name,phone,email,supabase_user_id,role',[fullName,phone,email,'supabase-auth-managed',supabaseUserId]);
      return mapCustomer(rows[0]);
    }
    const existing=[...memory.customers.values()].find(v=>String(v.supabaseUserId||'')===String(supabaseUserId)||String(v.email||'').toLowerCase()===String(email).toLowerCase());
    if(existing){existing.supabaseUserId=supabaseUserId;existing.email=email;existing.fullName=existing.fullName||fullName;return {id:existing.id,fullName:existing.fullName,phone:existing.phone,email:existing.email,role:existing.role||'customer',supabaseUserId};}
    const id=crypto.randomUUID(); const phone='supabase-'+supabaseUserId; memory.customers.set(id,{id,fullName,phone,email,passwordHash:'supabase-auth-managed',role:'customer',supabaseUserId}); return {id,fullName,phone,email,role:'customer',supabaseUserId};
  }

  async function findCustomerBySupabaseUserId(id) {
    if (!useDatabase) { const c=[...memory.customers.values()].find(v=>String(v.supabaseUserId||'')===String(id)); return c?{id:c.id,fullName:c.fullName,phone:c.phone,email:c.email,supabaseUserId:c.supabaseUserId}:null; }
    const { rows } = await pool.query('select id,full_name,phone,email,role,supabase_user_id from customers where supabase_user_id=$1',[id]);
    return rows[0]?mapCustomer(rows[0]):null;
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
    if (useDatabase) { const {rows}=await pool.query('select id,full_name,phone,email,password_hash,role from customers where phone=$1',[phone]); return rows[0]?{...mapCustomer(rows[0]),passwordHash:rows[0].password_hash}:null; }
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
        const vehicleCheck = await client.query('select id from vehicles where id=$1 and active=true for share',[input.vehicle.id]);
        if (!vehicleCheck.rows[0]) { const x=new Error('vehicle unavailable'); x.code='VEHICLE_UNAVAILABLE'; throw x; }
        if(input.idempotencyKey){
          await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))',[`${input.customerId}:${input.idempotencyKey}`]);
          const idem=await client.query('select b.* from booking_idempotency_keys i join bookings b on b.id=i.booking_id where i.customer_id=$1 and i.idempotency_key=$2 for share',[input.customerId,input.idempotencyKey]);
          if(idem.rows[0]){await client.query('commit');const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=mapBooking({...idem.rows[0],vehicle:input.vehicle});throw x;}
        }
        const {rows}=await client.query('insert into bookings (customer_id,vehicle_id,start_at,end_at,delivery_required,delivery_address,delivery_fee_paise,rental_total_paise,platform_fee_paise,total_paise,status,payment_status,customer_notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'requested\',\'unpaid\',$11) returning *',[input.customerId,input.vehicle.id,input.startAt,input.endAt,input.delivery,input.address,Math.round(input.pricing.deliveryFee * 100),Math.round(input.pricing.rental * 100),Math.round(input.pricing.platformFee * 100),Math.round(input.pricing.total * 100),input.notes||null]);
        if(input.idempotencyKey) await client.query('insert into booking_idempotency_keys (customer_id,idempotency_key,booking_id) values ($1,$2,$3)',[input.customerId,input.idempotencyKey,rows[0].id]);
        await client.query('insert into booking_status_events (booking_id,next_status,actor_type,actor_id) values ($1,\'requested\',\'customer\',$2)',[rows[0].id,input.customerId]);
        await client.query('commit');
        return mapBooking({...rows[0],vehicle:input.vehicle});
      } catch(e) {
        try{await client.query('rollback');}catch{}
        if(e.code==='23P01'){const x=new Error('vehicle unavailable');x.code='VEHICLE_UNAVAILABLE';throw x;}
        if(e.code==='23505'&&input.idempotencyKey){const {rows}=await client.query('select b.* from booking_idempotency_keys i join bookings b on b.id=i.booking_id where i.customer_id=$1 and i.idempotency_key=$2',[input.customerId,input.idempotencyKey]);if(rows[0]){const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=mapBooking({...rows[0],vehicle:input.vehicle});throw x;}}
        throw e;
      } finally { client.release(); }
    }
    const key=input.idempotencyKey?`${input.customerId}:${input.idempotencyKey}`:null;
    if(key&&memory.idempotency.has(key)){const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=memory.idempotency.get(key);throw x;}
    if([...memory.bookings.values()].some(b=>b.vehicleId===input.vehicle.id&&['requested','confirmed','in_progress'].includes(b.status)&&new Date(input.startAt)<new Date(b.endAt)&&new Date(input.endAt)>new Date(b.startAt))){const x=new Error('vehicle unavailable');x.code='VEHICLE_UNAVAILABLE';throw x;}
    const id=crypto.randomUUID();const booking={id,customerId:input.customerId,vehicleId:input.vehicle.id,vehicle:input.vehicle,startAt:input.startAt,endAt:input.endAt,delivery:input.delivery,address:input.address,notes:input.notes,pricing:input.pricing,status:'requested',paymentStatus:'unpaid',createdAt:new Date().toISOString()};memory.bookings.set(id,booking);if(key)memory.idempotency.set(key,booking);return booking;
  }

  async function getBooking(id, customerId = null){
    if(!useDatabase){
      const booking=memory.bookings.get(id);
      return booking && (!customerId || booking.customerId===customerId) ? booking : null;
    }
    const {rows}=await pool.query(
      'select b.*, v.id as v_id, v.type as v_type, v.name as v_name from bookings b left join vehicles v on v.id=b.vehicle_id where b.id=$1 and ($2::uuid is null or b.customer_id=$2)',
      [id, customerId]
    );
    if(!rows[0]) return null;
    const r=rows[0];
    return mapBooking({...r,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:undefined});
  }
  async function listCustomerBookings({customerId,limit,offset}){if(!useDatabase)return [...memory.bookings.values()].filter(b=>b.customerId===customerId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(offset,offset+limit);const {rows}=await pool.query('select b.*, v.id as v_id, v.type as v_type, v.name as v_name from bookings b left join vehicles v on v.id=b.vehicle_id where b.customer_id=$1 order by b.created_at desc limit $2 offset $3',[customerId,limit,offset]);return rows.map(r=>mapBooking({...r,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:undefined}));}
  async function cancelBooking(id,customerId){if(!useDatabase){const b=memory.bookings.get(id);if(!b||b.customerId!==customerId||!['requested','confirmed'].includes(b.status))return null;b.status='cancelled';b.updatedAt=new Date().toISOString();return b;}const {rows}=await pool.query('update bookings set status=\'cancelled\',updated_at=now() where id=$1 and customer_id=$2 and status in (\'requested\',\'confirmed\') returning *',[id,customerId]);if(!rows[0])return null;await pool.query('insert into booking_status_events (booking_id,previous_status,next_status,actor_type,actor_id) values ($1,\'requested\',\'cancelled\',\'customer\',$2)',[id,customerId]);return mapBooking({...rows[0],vehicle:undefined});}
  async function applyPaymentEvent(event){
    const canTransition = (current, next) => {
      if (current === next) return true;
      if (current === 'unpaid') return next === 'pending' || next === 'failed';
      if (current === 'pending') return next === 'paid' || next === 'failed';
      if (current === 'failed') return next === 'pending';
      if (current === 'paid') return next === 'refunded';
      return false;
    };
    if (!useDatabase) {
      if (memory.paymentEvents.has(event.eventId)) return { applied:false, duplicate:true };
      const booking = memory.bookings.get(event.bookingId);
      if (!booking) return { applied:false, duplicate:false, invalid:true };
      const expectedPaise = Math.round(Number(booking.pricing?.total || 0) * 100);
      if (event.currency !== 'INR' || Number(event.amountPaise) !== expectedPaise || !event.providerReference || !canTransition(booking.paymentStatus || 'unpaid', event.status)) {
        return { applied:false, duplicate:false, invalid:true };
      }
      memory.paymentEvents.set(event.eventId, event);
      booking.paymentStatus = event.status;
      booking.paymentProviderReference = event.providerReference;
      booking.updatedAt = new Date().toISOString();
      return { applied:true, duplicate:false };
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const bookingResult = await client.query('select id,payment_status,total_paise from bookings where id=$1 for update',[event.bookingId]);
      if (!bookingResult.rows[0]) {
        await client.query('rollback');
        return { applied:false, duplicate:false, invalid:true };
      }
      const booking = bookingResult.rows[0];
      if (event.currency !== 'INR' || Number(event.amountPaise) !== Number(booking.total_paise) || !event.providerReference || !canTransition(booking.payment_status, event.status)) {
        await client.query('rollback');
        return { applied:false, duplicate:false, invalid:true };
      }
      const inserted = await client.query('insert into payment_events (provider_event_id,booking_id,status,provider_reference,received_at) values ($1,$2,$3,$4,now()) on conflict (provider_event_id) do nothing returning id',[event.eventId,event.bookingId,event.status,event.providerReference]);
      if (!inserted.rows[0]) {
        await client.query('commit');
        return { applied:false, duplicate:true };
      }
      await client.query('update bookings set payment_status=$2,payment_provider_reference=$3,updated_at=now() where id=$1',[event.bookingId,event.status,event.providerReference]);
      await client.query('commit');
      return { applied:true, duplicate:false };
    } catch(e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async function findCustomerByEmail(email) {
    if (useDatabase) {
      const { rows } = await pool.query('select id,full_name,phone,email,password_hash,role from customers where lower(email)=lower($1)', [email]);
      return rows[0] ? { ...mapCustomer(rows[0]), passwordHash: rows[0].password_hash } : null;
    }
    const c = [...memory.customers.values()].find(v => String(v.email || '').toLowerCase() === String(email).toLowerCase());
    return c ? { id:c.id, fullName:c.fullName, phone:c.phone, email:c.email, passwordHash:c.passwordHash } : null;
  }

  async function findCustomerById(id) {
    if (useDatabase) {
      const { rows } = await pool.query(`select c.id,c.full_name,c.phone,c.email,c.password_hash,c.role,
        case when v.id is not null then json_build_object('id',v.id,'businessName',v.business_name,'status',v.status,'serviceCity',v.service_city) end as vendor
        from customers c left join vendors v on v.owner_customer_id=c.id where c.id=$1`, [id]);
      return rows[0] ? { ...mapCustomer(rows[0]), passwordHash: rows[0].password_hash, vendor: rows[0].vendor || undefined } : null;
    }
    const c = memory.customers.get(id);
    return c ? { id:c.id, fullName:c.fullName, phone:c.phone, email:c.email, role:c.role||'customer', passwordHash:c.passwordHash, vendor:c.vendor } : null;
  }

  async function findVendorByCustomerId(customerId) {
    if (useDatabase) {
      const { rows } = await pool.query('select id,owner_customer_id,business_name,contact_name,support_phone,support_email,status,service_city,service_area from vendors where owner_customer_id=$1',[customerId]);
      if (!rows[0]) return null;
      const r=rows[0];
      return {id:String(r.id),ownerCustomerId:String(r.owner_customer_id),businessName:r.business_name,contactName:r.contact_name,supportPhone:r.support_phone,supportEmail:r.support_email,status:r.status,serviceCity:r.service_city,serviceArea:r.service_area};
    }
    return memory.customers.get(customerId)?.vendor || null;
  }

  async function createOtp({ customerId = null, channel, destination, codeHash, expiresAt }) {
    if (!useDatabase) return { id:crypto.randomUUID(), customerId, channel, destination, codeHash, expiresAt, attempts:0, consumedAt:null };
    await pool.query("update auth_otps set consumed_at=coalesce(consumed_at, now()) where destination=$1 and channel=$2 and consumed_at is null", [destination, channel]);
    const { rows } = await pool.query('insert into auth_otps(customer_id,channel,destination,code_hash,expires_at) values($1,$2,$3,$4,$5) returning id,expires_at', [customerId, channel, destination, codeHash, expiresAt]);
    return rows[0];
  }

  async function consumeLatestOtp({ channel, destination }) {
    if (!useDatabase) return null;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query("select * from auth_otps where channel=$1 and destination=$2 and consumed_at is null order by created_at desc limit 1 for update", [channel, destination]);
      if (!rows[0]) { await client.query('commit'); return null; }
      const row=rows[0];
      if (new Date(row.expires_at) <= new Date() || Number(row.attempts)>=5) { await client.query('update auth_otps set consumed_at=coalesce(consumed_at,now()) where id=$1',[row.id]); await client.query('commit'); return null; }
      await client.query('update auth_otps set consumed_at=now() where id=$1',[row.id]);
      await client.query('commit');
      return row;
    } catch(e){ await client.query('rollback'); throw e; } finally { client.release(); }
  }

  async function incrementOtpAttempt(id) {
    if (useDatabase) await pool.query('update auth_otps set attempts=attempts+1 where id=$1 and consumed_at is null', [id]);
  }

  return {health,close,listVehicles,getVehicle,createCustomer,createOrLinkCustomerFromSupabase,findCustomerBySupabaseUserId,findCustomerByPhone,findCustomerByEmail,findCustomerById,findVendorByCustomerId,isVehicleUnavailable,createBooking,getBooking,listCustomerBookings,cancelBooking,applyPaymentEvent,createOtp,consumeLatestOtp,incrementOtpAttempt};
}
