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
  const memory = { customers:new Map(), bookings:new Map(), idempotency:new Map(), paymentEvents:new Map(), payments:new Map(), vendors:new Map(), vehicles:new Map() };

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
        securityDeposit:Number(row.security_deposit ?? ((row.security_deposit_paise ?? 0) / 100)),
        total:Number(row.total ?? ((row.total_paise ?? 0) / 100)),
        currency:'INR'
      },
      status:row.status,
      paymentStatus:row.payment_status,
      paymentId:row.payment_id || undefined,
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
      return [...fleet, ...memory.vehicles.values()].filter((v) =>
        v.active !== false &&
        (!typeValue || typeValue === 'all' || String(v.type).toLowerCase() === typeValue) &&
        (!cityValue || String(v.city).toLowerCase() === cityValue) &&
        (!qValue || `${v.name} ${v.subtitle || ''} ${v.make || ''} ${v.model || ''}`.toLowerCase().includes(qValue))
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
      where.push(`(name ilike ${params.length}::text or coalesce(make, '') ilike ${params.length}::text or coalesce(model, '') ilike ${params.length}::text)`);
    }

    const { rows } = await pool.query(
      `select id, owner_id, type, name, make, model, year, city, daily_rate_paise, security_deposit_paise, active, transmission, fuel, seats, description, image_urls, delivery_available
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
      make: row.make || null,
      model: row.model || null,
      year: row.year == null ? null : Number(row.year),
      securityDeposit: Number(row.security_deposit_paise || 0) / 100,
      description: row.description || '',
      imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
      deliveryAvailable: row.delivery_available !== false,
      ownerId: row.owner_id ? String(row.owner_id) : null,
      seats: row.seats == null ? null : Number(row.seats),
      transmission: row.transmission || null,
      fuel: row.fuel || null,
      active: Boolean(row.active),
    }));
  }

  async function getVehicle(id) {
    if (!useDatabase) return [...fleet, ...memory.vehicles.values()].find((v) => v.id === id && v.active !== false) || null;
    const { rows } = await pool.query(
      'select id, owner_id, type, name, make, model, year, city, daily_rate_paise, security_deposit_paise, active, transmission, fuel, seats, description, image_urls, delivery_available from vehicles where id = $1 and active = true',
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
      make: row.make || null,
      model: row.model || null,
      year: row.year == null ? null : Number(row.year),
      securityDeposit: Number(row.security_deposit_paise || 0) / 100,
      description: row.description || '',
      imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
      deliveryAvailable: row.delivery_available !== false,
      ownerId: row.owner_id ? String(row.owner_id) : null,
      seats: row.seats == null ? null : Number(row.seats),
      transmission: row.transmission || null,
      fuel: row.fuel || null,
      active: Boolean(row.active),
    };
  }

  async function getVehicleState(id) {
    if (!useDatabase) {
      const vehicle = [...fleet, ...memory.vehicles.values()].find((v) => v.id === id);
      return vehicle ? { exists:true, active:vehicle.active !== false } : { exists:false, active:false };
    }
    const { rows } = await pool.query('select id, active from vehicles where id=$1',[id]);
    return rows[0] ? { exists:true, active:Boolean(rows[0].active) } : { exists:false, active:false };
  }

  const mapVendor = (row) => row && ({
    id: String(row.id),
    ownerCustomerId: String(row.owner_customer_id),
    businessName: row.business_name,
    contactName: row.contact_name,
    phone: row.phone || row.support_phone,
    email: row.email || row.support_email,
    address: row.address || row.service_city,
    status: row.status,
    serviceCity: row.service_city,
    serviceArea: row.service_area || {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

  const mapManagedVehicle = (row) => row && ({
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    type: String(row.type),
    name: row.name || [row.make, row.model].filter(Boolean).join(' ') || 'RideOn vehicle',
    make: row.make || '',
    model: row.model || '',
    year: row.year == null ? null : Number(row.year),
    city: row.city,
    dailyRate: Number(row.daily_rate_paise || 0) / 100,
    securityDeposit: Number(row.security_deposit_paise || 0) / 100,
    transmission: row.transmission || '',
    fuel: row.fuel || '',
    seats: row.seats == null ? null : Number(row.seats),
    registrationNumber: row.registration_number || '',
    description: row.description || '',
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
    deliveryAvailable: row.delivery_available !== false,
    active: Boolean(row.active),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

  async function findVendorByCustomerId(customerId) {
    if (!useDatabase) return memory.vendors?.get(customerId) || null;
    const { rows } = await pool.query(
      'select id,owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area,created_at,updated_at from vendors where owner_customer_id=$1',
      [customerId]
    );
    return rows[0] ? mapVendor(rows[0]) : null;
  }

  async function ensureVendorForCustomer(customerId, input = {}) {
    if (!useDatabase) {
      if (!memory.vendors) memory.vendors = new Map();
      const existing = memory.vendors.get(customerId);
      if (existing) return existing;
      const vendor = {
        id: crypto.randomUUID(),
        ownerCustomerId: String(customerId),
        businessName: input.businessName || 'RideOn Vendor',
        contactName: input.contactName || 'Vendor',
        phone: input.phone || '',
        email: input.email || '',
        address: input.address || input.serviceCity || '',
        status: 'active',
        serviceCity: input.serviceCity || 'Jaipur',
        serviceArea: input.serviceArea || {},
      };
      memory.vendors.set(customerId, vendor);
      return vendor;
    }
    const customer = await findCustomerById(customerId);
    if (!customer) return null;
    const { rows } = await pool.query(
      `insert into vendors(owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area)
       values($1,$2,$3,$4,$5,$6,$4,$5,'active',$7,$8)
       on conflict (owner_customer_id) do update set updated_at=now()
       returning id,owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area,created_at,updated_at`,
      [
        customerId,
        input.businessName || customer.fullName || 'RideOn Vendor',
        input.contactName || customer.fullName || 'Vendor',
        input.phone || (customer.phone?.startsWith('supabase-') ? '' : customer.phone) || '',
        input.email || customer.email || '',
        input.address || input.serviceCity || '',
        input.serviceCity || 'Jaipur',
        input.serviceArea || {},
      ]
    );
    return rows[0] ? mapVendor(rows[0]) : null;
  }

  async function updateVendor(customerId, input) {
    if (!useDatabase) {
      const vendor = await ensureVendorForCustomer(customerId, input);
      Object.assign(vendor, input);
      return vendor;
    }
    const vendor = await findVendorByCustomerId(customerId);
    if (!vendor) return null;
    const { rows } = await pool.query(
      `update vendors set business_name=coalesce($2,business_name), contact_name=coalesce($3,contact_name),
       phone=coalesce($4,phone), email=coalesce($5,email), address=coalesce($6,address),
       service_city=coalesce($7,service_city), service_area=coalesce($8,service_area), updated_at=now()
       where owner_customer_id=$1
       returning id,owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area,created_at,updated_at`,
      [customerId,input.businessName,input.contactName,input.phone,input.email,input.address,input.serviceCity,input.serviceArea]
    );
    return rows[0] ? mapVendor(rows[0]) : null;
  }

  async function listVendorVehicles(vendorId, { active } = {}) {
    if (!useDatabase) return [...(memory.vehicles?.values() || [])].filter(v => String(v.ownerId) === String(vendorId) && (active === undefined || v.active === active));
    const params=[vendorId];
    const where=['owner_id=$1'];
    if (active !== undefined) { params.push(active); where.push(`active=$${params.length}`); }
    const { rows } = await pool.query(
      `select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,active,created_at,updated_at
       from vehicles where ${where.join(' and ')} order by created_at desc`, params);
    return rows.map(mapManagedVehicle);
  }

  async function getVendorVehicle(vendorId, vehicleId) {
    if (!useDatabase) {
      const v = memory.vehicles?.get(vehicleId);
      return v && String(v.ownerId) === String(vendorId) ? v : null;
    }
    const { rows } = await pool.query(
      'select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,active,created_at,updated_at from vehicles where id=$1 and owner_id=$2',
      [vehicleId,vendorId]
    );
    return rows[0] ? mapManagedVehicle(rows[0]) : null;
  }

  async function createVendorVehicle(vendorId, input) {
    if (!useDatabase) {
      if (!memory.vehicles) memory.vehicles = new Map();
      const id = crypto.randomUUID();
      const vehicle = { id, ownerId: vendorId, ...input, active: input.active !== false, imageUrls: input.imageUrls || [] };
      memory.vehicles.set(id, vehicle);
      return vehicle;
    }
    const id = crypto.randomUUID();
    try {
      const { rows } = await pool.query(
        `insert into vehicles(id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,active,updated_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
         returning id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,active,created_at,updated_at`,
        [id,vendorId,input.type,input.name,input.make,input.model,input.year,input.city,
         Math.round(Number(input.dailyRate)*100),Math.round(Number(input.securityDeposit||0)*100),
         input.transmission || null,input.fuel || null,input.seats || null,input.registrationNumber || null,
         input.description || null,input.imageUrls || [],input.deliveryAvailable !== false,input.active !== false]
      );
      return mapManagedVehicle(rows[0]);
    } catch (error) {
      if (error.code === '23505' && input.registrationNumber) { const x=new Error('vehicle registration exists'); x.code='VEHICLE_EXISTS'; throw x; }
      throw error;
    }
  }

  async function updateVendorVehicle(vendorId, vehicleId, input) {
    if (!useDatabase) {
      const vehicle = await getVendorVehicle(vendorId, vehicleId);
      if (!vehicle) return null;
      Object.assign(vehicle, input);
      return vehicle;
    }
    const fields = [
      ['type',input.type],['name',input.name],['make',input.make],['model',input.model],['year',input.year],
      ['city',input.city],['daily_rate_paise',input.dailyRate == null ? undefined : Math.round(Number(input.dailyRate)*100)],
      ['security_deposit_paise',input.securityDeposit == null ? undefined : Math.round(Number(input.securityDeposit)*100)],
      ['transmission',input.transmission],['fuel',input.fuel],['seats',input.seats],
      ['registration_number',input.registrationNumber],['description',input.description],
      ['image_urls',input.imageUrls],['delivery_available',input.deliveryAvailable],['active',input.active]
    ];
    const sets=[]; const params=[vehicleId,vendorId];
    for (const [column,value] of fields) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column}=$${params.length}`);
    }
    if (!sets.length) return getVendorVehicle(vendorId, vehicleId);
    params.push(new Date());
    sets.push('updated_at=now()');
    try {
      const { rows } = await pool.query(
        `update vehicles set ${sets.join(', ')} where id=$1 and owner_id=$2
         returning id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,active,created_at,updated_at`,
        params.slice(0,-1)
      );
      return rows[0] ? mapManagedVehicle(rows[0]) : null;
    } catch (error) {
      if (error.code === '23505' && input.registrationNumber) { const x=new Error('vehicle registration exists'); x.code='VEHICLE_EXISTS'; throw x; }
      throw error;
    }
  }

  async function deactivateVendorVehicle(vendorId, vehicleId) {
    if (!useDatabase) {
      const vehicle = await getVendorVehicle(vendorId, vehicleId);
      if (!vehicle) return null;
      vehicle.active=false;
      return vehicle;
    }
    const { rows } = await pool.query(
      `update vehicles set active=false,updated_at=now() where id=$1 and owner_id=$2 returning id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,active,created_at,updated_at`,
      [vehicleId,vendorId]
    );
    return rows[0] ? mapManagedVehicle(rows[0]) : null;
  }

  async function listVendorBookings(vendorId, { limit=20, offset=0 } = {}) {
    if (!useDatabase) {
      return [...memory.bookings.values()]
        .filter(b => String(b.vendorId||'') === String(vendorId))
        .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
        .slice(offset, offset+limit);
    }
    const { rows } = await pool.query(
      `select b.*, v.name as v_name, v.type as v_type
       from bookings b join vehicles v on v.id=b.vehicle_id
       where v.owner_id=$1
       order by b.created_at desc limit $2 offset $3`,
      [vendorId,limit,offset]
    );
    return rows.map(r=>mapBooking({...r,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:{id:String(r.vehicle_id),name:r.v_name,type:String(r.v_type)}}));
  }

  async function getVendorBooking(vendorId, bookingId) {
    if (!useDatabase) {
      const b = memory.bookings.get(bookingId);
      return b && String(b.vendorId||'') === String(vendorId) ? b : null;
    }
    const { rows } = await pool.query(
      `select b.*, v.name as v_name, v.type as v_type
       from bookings b join vehicles v on v.id=b.vehicle_id
       where b.id=$1 and v.owner_id=$2`,
      [bookingId,vendorId]
    );
    if (!rows[0]) return null;
    return mapBooking({...rows[0],vehicle:{id:String(rows[0].vehicle_id),name:rows[0].v_name,type:String(rows[0].v_type)}});
  }

  async function updateVendorBookingStatus(vendorId, bookingId, nextStatus, note='') {
    const allowed = {
      requested: ['confirmed','rejected','cancelled'],
      confirmed: ['in_progress','cancelled'],
      in_progress: ['completed','cancelled'],
      rejected: [],
      completed: [],
      cancelled: [],
    };
    if (!allowed[nextStatus]) { const e=new Error('invalid status'); e.code='INVALID_BOOKING_STATUS'; throw e; }
    if (!useDatabase) {
      const b=await getVendorBooking(vendorId,bookingId);
      if(!b){const e=new Error('booking not found');e.code='BOOKING_NOT_FOUND';throw e;}
      if(!allowed[b.status]?.includes(nextStatus)){const e=new Error('invalid transition');e.code='INVALID_BOOKING_TRANSITION';throw e;}
      b.status=nextStatus;b.updatedAt=new Date().toISOString();return b;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select b.*, v.name as v_name, v.type as v_type from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1 and v.owner_id=$2 for update',[bookingId,vendorId]);
      if(!rows[0]){await client.query('rollback');const e=new Error('booking not found');e.code='BOOKING_NOT_FOUND';throw e;}
      const current=rows[0].status;
      if(!allowed[current]?.includes(nextStatus)){await client.query('rollback');const e=new Error('invalid transition');e.code='INVALID_BOOKING_TRANSITION';throw e;}
      const {rows:updated}=await client.query('update bookings set status=$2,updated_at=now() where id=$1 returning *',[bookingId,nextStatus]);
      await client.query('insert into booking_status_events(booking_id,previous_status,next_status,actor_type,actor_id,note) values($1,$2,$3,\'vendor\',$4,$5)',[bookingId,current,nextStatus,vendorId,note||null]);
      await client.query('commit');
      return mapBooking({...updated[0],vehicle:{id:String(updated[0].vehicle_id),name:rows[0].v_name,type:String(rows[0].v_type)}});
    } catch(error){try{await client.query('rollback');}catch{};throw error;}finally{client.release();}
  }


  async function createOrLinkCustomerFromSupabase({supabaseUserId,email,fullName,phone,role='customer'}) {
    if (!['customer','vendor'].includes(role)) { const e=new Error('Invalid RideOn account type.'); e.code='INVALID_ROLE'; throw e; }

    const placeholderPhone = () => 'supa-' + crypto.createHash('sha256').update(String(supabaseUserId)).digest('hex').slice(0,11);

    if (useDatabase) {
      const existingBySupabaseId = await findCustomerBySupabaseUserId(supabaseUserId);
      if (existingBySupabaseId) {
        if ((existingBySupabaseId.role || 'customer') !== role) {
          const e=new Error('A RideOn account already exists under a different account type.'); e.code='ACCOUNT_TYPE_CONFLICT'; throw e;
        }
        return existingBySupabaseId;
      }

      const existingByEmail = await findCustomerByEmail(email);
      if (existingByEmail) {
        if ((existingByEmail.role || 'customer') !== role) {
          const e=new Error('A RideOn account already exists with this email under a different account type.'); e.code='ACCOUNT_TYPE_CONFLICT'; throw e;
        }
        const resolvedPhone = phone || (existingByEmail.phone?.startsWith('supa-') ? placeholderPhone() : existingByEmail.phone);
        const { rows } = await pool.query(
          `update customers set supabase_user_id=$2,email=coalesce(email,$3),full_name=coalesce(full_name,$4),phone=$5
           where id=$1 returning id,full_name,phone,email,role,supabase_user_id`,
          [existingByEmail.id,supabaseUserId,email,fullName || existingByEmail.fullName,resolvedPhone]
        );
        return mapCustomer(rows[0]);
      }

      const resolvedPhone = phone || placeholderPhone();
      const { rows } = await pool.query(
        `insert into customers(full_name,phone,email,password_hash,supabase_user_id,role)
         values($1,$2,$3,$4,$5,$6)
         returning id,full_name,phone,email,role,supabase_user_id`,
        [fullName || email.split('@')[0],resolvedPhone,email,'supabase-auth-managed',supabaseUserId,role]
      );
      return mapCustomer(rows[0]);
    }

    const bySupabase=[...memory.customers.values()].find(v=>String(v.supabaseUserId||'')===String(supabaseUserId));
    if(bySupabase){
      if ((bySupabase.role||'customer')!==role) { const e=new Error('A RideOn account already exists under a different account type.'); e.code='ACCOUNT_TYPE_CONFLICT'; throw e; }
      return {...bySupabase};
    }
    const byEmail=[...memory.customers.values()].find(v=>String(v.email||'').toLowerCase()===String(email).toLowerCase());
    if(byEmail){
      if ((byEmail.role||'customer')!==role) { const e=new Error('A RideOn account already exists with this email under a different account type.'); e.code='ACCOUNT_TYPE_CONFLICT'; throw e; }
      byEmail.supabaseUserId=supabaseUserId;
      byEmail.email=email;
      byEmail.fullName=byEmail.fullName||fullName;
      if(phone && byEmail.phone?.startsWith('supa-')) byEmail.phone=phone;
      return {...byEmail};
    }
    const id=crypto.randomUUID();
    const resolvedPhone=phone || placeholderPhone();
    const customer={id,fullName:fullName||email.split('@')[0],phone:resolvedPhone,email,passwordHash:'supabase-auth-managed',supabaseUserId,role};
    memory.customers.set(id,customer);
    return {...customer};
  }

  async function findCustomerBySupabaseUserId(id) {
    if (!useDatabase) { const c=[...memory.customers.values()].find(v=>String(v.supabaseUserId||'')===String(id)); return c?{id:c.id,fullName:c.fullName,phone:c.phone,email:c.email,role:c.role||'customer',supabaseUserId:c.supabaseUserId}:null; }
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
    if (useDatabase) { const {rows}=await pool.query('select id,full_name,phone,email,password_hash from customers where phone=$1',[phone]); return rows[0]?{...mapCustomer(rows[0]),passwordHash:rows[0].password_hash}:null; }
    const c=[...memory.customers.values()].find(v=>v.phone===phone); return c?{id:c.id,fullName:c.fullName,phone:c.phone,email:c.email,passwordHash:c.passwordHash}:null;
  }

  async function isVehicleUnavailable(vehicleId,startAt,endAt) {
    return !(await checkVehicleAvailability(vehicleId,startAt,endAt)).available;
  }

  async function checkVehicleAvailability(vehicleId,startAt,endAt) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      const e = new Error('invalid booking window');
      e.code = 'INVALID_BOOKING_WINDOW';
      throw e;
    }
    if (!useDatabase) {
      const vehicle = memory.vehicles.get(vehicleId) || fleet.find(v => v.id === vehicleId);
      if (!vehicle) return { vehicleId:String(vehicleId), exists:false, active:false, available:false };
      if (vehicle.active === false) return { vehicleId:String(vehicleId), exists:true, active:false, available:false };
      const overlap = [...memory.bookings.values()].some(b => b.vehicleId===vehicleId && ['requested','confirmed','in_progress'].includes(b.status) && start < new Date(b.endAt) && end > new Date(b.startAt));
      return { vehicleId:String(vehicleId), exists:true, active:true, available:!overlap };
    }
    const vehicleResult = await pool.query('select id,active from vehicles where id=$1',[vehicleId]);
    if (!vehicleResult.rows[0]) return { vehicleId:String(vehicleId), exists:false, active:false, available:false };
    if (!vehicleResult.rows[0].active) return { vehicleId:String(vehicleId), exists:true, active:false, available:false };
    const bookingResult = await pool.query("select 1 from bookings where vehicle_id=$1 and status in ('requested','confirmed','in_progress') and start_at<$3 and end_at>$2 limit 1",[vehicleId,startAt,endAt]);
    return { vehicleId:String(vehicleId), exists:true, active:true, available:bookingResult.rowCount === 0 };
  }

  async function createBooking(input) {
    if (useDatabase) {
      const client=await pool.connect();
      try {
        await client.query('begin');
        if(input.idempotencyKey){
          await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))',[`${input.customerId}:${input.idempotencyKey}`]);
          const idem=await client.query('select b.* from booking_idempotency_keys i join bookings b on b.id=i.booking_id where i.customer_id=$1 and i.idempotency_key=$2 for share',[input.customerId,input.idempotencyKey]);
          if(idem.rows[0]){await client.query('commit');const x=new Error('idempotency replay');x.code='IDEMPOTENCY_REPLAY';x.booking=mapBooking({...idem.rows[0],vehicle:input.vehicle});throw x;}
        }
        const vehicleCheck = await client.query('select id, owner_id, active from vehicles where id=$1 for share',[input.vehicle.id]);
        if (!vehicleCheck.rows[0]) { const x=new Error('vehicle not found'); x.code='VEHICLE_NOT_FOUND'; throw x; }
        if (!vehicleCheck.rows[0].active) { const x=new Error('vehicle inactive'); x.code='VEHICLE_INACTIVE'; throw x; }
        const {rows}=await client.query('insert into bookings (customer_id,vehicle_id,vendor_id,start_at,end_at,delivery_required,delivery_address,delivery_fee_paise,rental_total_paise,platform_fee_paise,security_deposit_paise,total_paise,status,payment_status,customer_notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,\'requested\',\'unpaid\',$13) returning *',[input.customerId,input.vehicle.id,vehicleCheck.rows[0].owner_id||null,input.startAt,input.endAt,input.delivery,input.address,Math.round(input.pricing.deliveryFee * 100),Math.round(input.pricing.rental * 100),Math.round(input.pricing.platformFee * 100),Math.round((input.pricing.securityDeposit||0) * 100),Math.round(input.pricing.total * 100),input.notes||null]);
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
    const id=crypto.randomUUID();const booking={id,customerId:input.customerId,vehicleId:input.vehicle.id,vendorId:input.vehicle.ownerId||null,vehicle:input.vehicle,startAt:input.startAt,endAt:input.endAt,delivery:input.delivery,address:input.address,notes:input.notes,pricing:input.pricing,status:'requested',paymentStatus:'unpaid',createdAt:new Date().toISOString()};memory.bookings.set(id,booking);if(key)memory.idempotency.set(key,booking);return booking;
  }

  async function getBooking(id, customerId = null){
    if(!useDatabase){
      const booking=memory.bookings.get(id);
      return booking && (!customerId || booking.customerId===customerId) ? booking : null;
    }
    const {rows}=await pool.query(
      'select b.*, p.id as payment_id, v.id as v_id, v.type as v_type, v.name as v_name from bookings b left join payments p on p.booking_id=b.id and p.status in (\'unpaid\',\'pending\') left join vehicles v on v.id=b.vehicle_id where b.id=$1 and ($2::uuid is null or b.customer_id=$2)',
      [id, customerId]
    );
    if(!rows[0]) return null;
    const r=rows[0];
    return mapBooking({...r,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:undefined});
  }
  async function listCustomerBookings({customerId,limit,offset}){if(!useDatabase)return [...memory.bookings.values()].filter(b=>b.customerId===customerId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(offset,offset+limit);const {rows}=await pool.query('select b.*, p.id as payment_id, v.id as v_id, v.type as v_type, v.name as v_name from bookings b left join payments p on p.booking_id=b.id and p.status in (\'unpaid\',\'pending\') left join vehicles v on v.id=b.vehicle_id where b.customer_id=$1 order by b.created_at desc limit $2 offset $3',[customerId,limit,offset]);return rows.map(r=>mapBooking({...r,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:undefined}));}
  const canTransition = (current, next) => {
    if (current === next) return true;
    if (current === 'unpaid') return next === 'pending' || next === 'failed';
    if (current === 'pending') return next === 'paid' || next === 'failed';
    if (current === 'failed') return next === 'pending';
    if (current === 'paid') return next === 'refunded';
    return false;
  };

  async function cancelBooking(id,customerId){
    if(!useDatabase){
      const b=memory.bookings.get(id);
      if(!b||b.customerId!==customerId||!['requested','confirmed'].includes(b.status))return null;
      const previous=b.status;
      b.status='cancelled';b.updatedAt=new Date().toISOString();return b;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select * from bookings where id=$1 and customer_id=$2 for update',[id,customerId]);
      if(!rows[0]){await client.query('rollback');return null;}
      const previous=rows[0].status;
      if(!['requested','confirmed'].includes(previous)){await client.query('rollback');return null;}
      const {rows:updated}=await client.query('update bookings set status=\'cancelled\',updated_at=now() where id=$1 returning *',[id]);
      await client.query('insert into booking_status_events (booking_id,previous_status,next_status,actor_type,actor_id) values ($1,$2,\'cancelled\',\'customer\',$3)',[id,previous,customerId]);
      await client.query('commit');
      return mapBooking({...updated[0],vehicle:undefined});
    }catch(e){await client.query('rollback');throw e;}finally{client.release();}
  }
  async function applyPaymentEvent(event){
    if (!useDatabase) {
      if (memory.paymentEvents.has(event.eventId)) return { applied:false, duplicate:true };
      const payment = event.providerOrderId ? [...memory.payments.values()].find(p => p.providerOrderId === String(event.providerOrderId)) : (event.bookingId ? memory.payments.get(String(event.bookingId)) : null);
      const resolvedBookingId = event.bookingId || payment?.bookingId;
      const booking = resolvedBookingId ? memory.bookings.get(String(resolvedBookingId)) : null;
      if (!booking || !payment) return { applied:false, duplicate:false, invalid:true };
      // Persist the first valid event before mutating booking/payment state so a retry is a strict replay.

      if (event.providerOrderId && payment.providerOrderId !== String(event.providerOrderId)) return { applied:false, duplicate:false, invalid:true };
      const expectedPaise = Math.round(Number(booking.pricing?.total || 0) * 100);
      if (event.currency !== 'INR' || Number(event.amountPaise) !== expectedPaise || !event.providerReference || !canTransition(booking.paymentStatus || 'unpaid', event.status)) {
        return { applied:false, duplicate:false, invalid:true };
      }
      memory.paymentEvents.set(event.eventId, event);
      booking.paymentStatus = event.status;
      booking.paymentProviderReference = event.providerReference;
      const paymentRecord = event.providerOrderId
        ? [...memory.payments.values()].find(p => p.providerOrderId === String(event.providerOrderId))
        : memory.payments.get(String(resolvedBookingId));
      if (paymentRecord) {
        paymentRecord.status = event.status;
        paymentRecord.providerReference = event.providerReference;
        paymentRecord.providerPaymentId = event.providerReference;
        paymentRecord.updatedAt = new Date().toISOString();
      }
      booking.updatedAt = new Date().toISOString();
      return { applied:true, duplicate:false };
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const paymentResult = event.providerOrderId
        ? await client.query('select id,booking_id,provider_order_id,amount_paise,status from payments where provider_order_id=$1 for update',[event.providerOrderId])
        : event.bookingId
          ? await client.query('select id,booking_id,provider_order_id,amount_paise,status from payments where booking_id=$1 and status in (\'pending\',\'paid\',\'failed\') order by created_at desc limit 1 for update',[event.bookingId])
          : { rows: [] };
      if (!paymentResult.rows[0]) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
      const payment = paymentResult.rows[0];
      const resolvedBookingId = event.bookingId || String(payment.booking_id);
      if (event.providerOrderId && String(payment.provider_order_id) !== String(event.providerOrderId)) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
      const bookingResult = await client.query('select id,payment_status,total_paise from bookings where id=$1 for update',[resolvedBookingId]);
      if (!bookingResult.rows[0]) {
        await client.query('rollback');
        return { applied:false, duplicate:false, invalid:true };
      }
      const booking = bookingResult.rows[0];
      if (event.currency !== 'INR' || Number(event.amountPaise) !== Number(booking.total_paise) || Number(event.amountPaise) !== Number(payment.amount_paise) || !event.providerReference || !canTransition(booking.payment_status, event.status)) {
        await client.query('rollback');
        return { applied:false, duplicate:false, invalid:true };
      }
      const inserted = await client.query('insert into payment_events (provider_event_id,booking_id,status,provider_reference,amount_paise,currency,provider_order_id,received_at) values ($1,$2,$3,$4,$5,$6,$7,now()) on conflict (provider_event_id) do nothing returning id',[event.eventId,resolvedBookingId,event.status,event.providerReference,event.amountPaise,event.currency,event.providerOrderId||null]);
      if (!inserted.rows[0]) {
        await client.query('commit');
        return { applied:false, duplicate:true };
      }
      await client.query('update bookings set payment_status=$2,payment_provider_reference=$3,updated_at=now() where id=$1',[resolvedBookingId,event.status,event.providerReference]);
      await client.query('update payments set status=$2,provider_payment_id=coalesce(provider_payment_id,$3),provider_reference=$3,provider_order_id=coalesce(provider_order_id,$4),updated_at=now() where id=$1',[payment.id,event.status,event.providerReference,event.providerOrderId||null]);
      await client.query('commit');
      return { applied:true, duplicate:false };
    } catch(e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  const paymentLocks = new Map();

  async function withPaymentLock(key, fn) {
    const lockKey = String(key);
    if (!useDatabase) {
      const previous = paymentLocks.get(lockKey) || Promise.resolve();
      let release;
      const current = new Promise(resolve => { release = resolve; });
      paymentLocks.set(lockKey, previous.then(() => current));
      await previous;
      try { return await fn(); }
      finally {
        release();
        if (paymentLocks.get(lockKey) === current) paymentLocks.delete(lockKey);
      }
    }
    const client = await pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      return await fn();
    } finally {
      try { await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]); } finally { client.release(); }
    }
  }

  async function findPaymentById(paymentId, customerId) {
    if (!useDatabase) {
      const payment=memory.payments.get(String(paymentId));
      if (!payment || (customerId && String(payment.customerId)!==String(customerId))) return null;
      return payment;
    }
    const { rows } = await pool.query(
      'select p.id,p.booking_id,p.provider,p.provider_order_id,p.provider_payment_id,p.provider_reference,p.amount_paise,p.currency,p.status,p.idempotency_key,p.created_at,p.updated_at from payments p join bookings b on b.id=p.booking_id where p.id=$1 and b.customer_id=$2',
      [paymentId, customerId]
    );
    return rows[0] ? {
      id:String(rows[0].id), bookingId:String(rows[0].booking_id), provider:rows[0].provider,
      providerOrderId:rows[0].provider_order_id || undefined, providerPaymentId:rows[0].provider_payment_id || undefined,
      providerReference:rows[0].provider_reference || undefined, amountPaise:Number(rows[0].amount_paise),
      currency:rows[0].currency, status:rows[0].status, idempotencyKey:rows[0].idempotency_key || undefined,
      createdAt:iso(rows[0].created_at), updatedAt:iso(rows[0].updated_at || rows[0].created_at),
    } : null;
  }

  async function findPaymentByProviderOrder(providerOrderId) {
    if (!useDatabase) return [...memory.payments.values()].find(p => p.providerOrderId === String(providerOrderId)) || null;
    const { rows } = await pool.query(
      'select id,booking_id,provider,provider_order_id,provider_payment_id,provider_reference,amount_paise,currency,status,idempotency_key,created_at,updated_at from payments where provider_order_id=$1 order by created_at desc limit 1',
      [providerOrderId]
    );
    return rows[0] ? {
      id:String(rows[0].id), bookingId:String(rows[0].booking_id), provider:rows[0].provider,
      providerOrderId:rows[0].provider_order_id || undefined, providerPaymentId:rows[0].provider_payment_id || undefined,
      providerReference:rows[0].provider_reference || undefined, amountPaise:Number(rows[0].amount_paise),
      currency:rows[0].currency, status:rows[0].status, idempotencyKey:rows[0].idempotency_key || undefined,
      createdAt:iso(rows[0].created_at), updatedAt:iso(rows[0].updated_at || rows[0].created_at),
    } : null;
  }

  async function findPaymentByBooking(bookingId) {
    if (!useDatabase) return memory.payments?.get(String(bookingId)) || null;
    const { rows } = await pool.query(
      'select id,booking_id,provider,provider_order_id,provider_payment_id,provider_reference,amount_paise,currency,status,idempotency_key,created_at,updated_at from payments where booking_id=$1 order by created_at desc limit 1',
      [bookingId]
    );
    return rows[0] ? {
      id:String(rows[0].id), bookingId:String(rows[0].booking_id), provider:rows[0].provider,
      providerOrderId:rows[0].provider_order_id || undefined, providerPaymentId:rows[0].provider_payment_id || undefined,
      providerReference:rows[0].provider_reference || undefined, amountPaise:Number(rows[0].amount_paise),
      currency:rows[0].currency, status:rows[0].status, idempotencyKey:rows[0].idempotency_key || undefined,
      createdAt:iso(rows[0].created_at), updatedAt:iso(rows[0].updated_at || rows[0].created_at),
    } : null;
  }

  async function createOrGetPaymentOrder({ bookingId, customerId, provider, amountPaise, currency='INR', idempotencyKey, providerOrder }) {
    if (!Number.isSafeInteger(Number(amountPaise)) || Number(amountPaise) <= 0 || currency !== 'INR') {
      const e=new Error('Invalid payment amount or currency.'); e.code='PAYMENT_CREATION_FAILED'; throw e;
    }
    if (!useDatabase) {
      if (!memory.payments) memory.payments = new Map();
      const existing=memory.payments.get(String(bookingId));
      if (existing && ['unpaid','pending'].includes(existing.status) && existing.amountPaise===Number(amountPaise)) return { payment:existing, created:false };
      const payment={id:crypto.randomUUID(),bookingId:String(bookingId),customerId:String(customerId),provider,providerOrderId:providerOrder.id,amountPaise:Number(amountPaise),currency,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      memory.payments.set(String(bookingId),payment);
      return {payment,created:true};
    }
    const client=await pool.connect();
    try {
      await client.query('begin');
      const bookingResult=await client.query('select id,customer_id,total_paise,payment_status from bookings where id=$1 for update',[bookingId]);
      if(!bookingResult.rows[0]){const e=new Error('Payment not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const b=bookingResult.rows[0];
      if(String(b.customer_id)!==String(customerId)){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      if(Number(b.total_paise)!==Number(amountPaise)){const e=new Error('Booking amount changed.');e.code='PAYMENT_CREATION_FAILED';throw e;}
      if(b.payment_status==='paid'){const e=new Error('Booking is already paid.');e.code='PAYMENT_ALREADY_PAID';throw e;}
      const existing=await client.query("select id,booking_id,provider,provider_order_id,provider_payment_id,provider_reference,amount_paise,currency,status,idempotency_key,created_at,updated_at from payments where booking_id=$1 and status in ('unpaid','pending') order by created_at desc limit 1 for update",[bookingId]);
      if(existing.rows[0]){
        const row=existing.rows[0];
        await client.query('commit');
        return {created:false,payment:{id:String(row.id),bookingId:String(row.booking_id),provider:row.provider,providerOrderId:row.provider_order_id,providerPaymentId:row.provider_payment_id,providerReference:row.provider_reference||undefined,amountPaise:Number(row.amount_paise),currency:row.currency,status:row.status,idempotencyKey:row.idempotency_key||undefined,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}};
      }
      const inserted=await client.query(
        "insert into payments(booking_id,provider,provider_order_id,amount_paise,currency,status,idempotency_key) values($1,$2,$3,$4,$5,'pending',$6) returning id,booking_id,provider,provider_order_id,amount_paise,currency,status,idempotency_key,created_at,updated_at",
        [bookingId,provider,providerOrder.id,Number(amountPaise),currency,idempotencyKey||null]
      );
      await client.query("update bookings set payment_status='pending',payment_provider_reference=$2,updated_at=now() where id=$1 and payment_status='unpaid'",[bookingId,providerOrder.id]);
      await client.query('commit');
      const row=inserted.rows[0];
      return {created:true,payment:{id:String(row.id),bookingId:String(row.booking_id),provider:row.provider,providerOrderId:row.provider_order_id,amountPaise:Number(row.amount_paise),currency:row.currency,status:row.status,idempotencyKey:row.idempotency_key||undefined,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}};
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function verifyPayment({ paymentId, bookingId, customerId, providerPaymentId, providerOrderId, providerSignature }) {
    if (!useDatabase) {
      const p=[...(memory.payments?.values()||[])].find((candidate) =>
        candidate.id===String(paymentId) &&
        String(candidate.bookingId)===String(bookingId) &&
        String(candidate.customerId)===String(customerId)
      );
      if(!p || p.id!==String(paymentId) || p.providerOrderId!==String(providerOrderId)) {const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      p.providerPaymentId=String(providerPaymentId);p.providerReference=String(providerPaymentId);p.status='pending';p.updatedAt=new Date().toISOString();
      return p;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select p.*,b.customer_id,b.total_paise from payments p join bookings b on b.id=p.booking_id where p.id=$1 and p.booking_id=$2 and b.customer_id=$3 for update',[paymentId,bookingId,customerId]);
      if(!rows[0]){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      const p=rows[0];
      if(Number(p.amount_paise)!==Number(p.total_paise)) {const e=new Error('Payment amount mismatch.');e.code='PAYMENT_VERIFICATION_FAILED';throw e;}
      if(p.provider_order_id!==String(providerOrderId)) {const e=new Error('Payment order mismatch.');e.code='PAYMENT_VERIFICATION_FAILED';throw e;}
      await client.query('update payments set provider_payment_id=$2,provider_reference=$2,updated_at=now() where id=$1',[paymentId,providerPaymentId]);
      await client.query('commit');
      return {id:String(p.id),bookingId:String(p.booking_id),provider:p.provider,providerOrderId:p.provider_order_id,providerPaymentId:String(providerPaymentId),providerReference:String(providerPaymentId),amountPaise:Number(p.amount_paise),currency:p.currency,status:p.status};
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function submitPaymentReference({ paymentId, bookingId, customerId, providerReference }) {
    if (!providerReference || String(providerReference).trim().length < 4) {
      const e=new Error('A UPI transaction reference is required.');
      e.code='PAYMENT_VERIFICATION_FAILED';
      throw e;
    }
    if (!useDatabase) {
      const p=[...(memory.payments?.values()||[])].find((candidate) =>
        candidate.id===String(paymentId) &&
        String(candidate.bookingId)===String(bookingId) &&
        String(candidate.customerId)===String(customerId)
      );
      if(!p || p.id!==String(paymentId) || String(p.customerId)!==String(customerId)) {
        const e=new Error('Payment not found.'); e.code='PAYMENT_NOT_FOUND'; throw e;
      }
      p.providerReference=String(providerReference).trim();
      p.status='pending';
      p.updatedAt=new Date().toISOString();
      return p;
    }
    const client=await pool.connect();
    try {
      await client.query('begin');
      const {rows}=await client.query(
        'select p.*,b.customer_id,b.total_paise from payments p join bookings b on b.id=p.booking_id where p.id=$1 and p.booking_id=$2 and b.customer_id=$3 for update',
        [paymentId,bookingId,customerId]
      );
      if(!rows[0]){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      const p=rows[0];
      if(Number(p.amount_paise)!==Number(p.total_paise)) {
        const e=new Error('Payment amount mismatch.');e.code='PAYMENT_VERIFICATION_FAILED';throw e;
      }
      await client.query(
        'update payments set provider_payment_id=$2,provider_reference=$2,status=case when status=\'unpaid\' then \'pending\' else status end,updated_at=now() where id=$1',
        [paymentId,String(providerReference).trim()]
      );
      await client.query(
        'update bookings set payment_status=\'pending\',payment_provider_reference=$2,updated_at=now() where id=$1 and payment_status<>\'paid\'',
        [bookingId,String(providerReference).trim()]
      );
      await client.query('commit');
      return {
        id:String(p.id),bookingId:String(p.booking_id),provider:p.provider,
        providerOrderId:p.provider_order_id || undefined,
        providerPaymentId:String(providerReference).trim(),
        providerReference:String(providerReference).trim(),
        amountPaise:Number(p.amount_paise),currency:p.currency,status:'pending'
      };
    } catch(e) {
      try{await client.query('rollback')}catch{}
      throw e;
    } finally {
      client.release();
    }
  }

  async function refundPayment({ paymentId, customerId = null, providerReference, amountPaise, status='refunded' }) {
    if (!useDatabase) {
      const p=[...(memory.payments?.values()||[])].find(x=>x.id===String(paymentId));
      if(!p){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      p.status=status;p.updatedAt=new Date().toISOString();return p;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select p.*,b.customer_id from payments p join bookings b on b.id=p.booking_id where p.id=$1 and ($2::uuid is null or b.customer_id=$2) for update',[paymentId,customerId]);
      if(!rows[0]){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      if(rows[0].status!=='paid'){const e=new Error('Payment is not refundable in its current state.');e.code='INVALID_PAYMENT_STATE';throw e;}
      await client.query("update payments set status='refunded',provider_reference=$2,updated_at=now() where id=$1",[paymentId,providerReference]);
      await client.query("update bookings set payment_status='refunded',updated_at=now() where id=$1",[rows[0].booking_id]);
      await client.query('commit');
      return {id:String(rows[0].id),bookingId:String(rows[0].booking_id),provider:rows[0].provider,providerOrderId:rows[0].provider_order_id,providerPaymentId:rows[0].provider_payment_id,providerReference:providerReference,amountPaise:Number(rows[0].amount_paise),currency:rows[0].currency,status:'refunded'};
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function findCustomerByEmail(email) {
    if (useDatabase) {
      const { rows } = await pool.query('select id,full_name,phone,email,password_hash,role,supabase_user_id from customers where lower(email)=lower($1::text)', [email]);
      return rows[0] ? { ...mapCustomer(rows[0]), passwordHash: rows[0].password_hash } : null;
    }
    const c = [...memory.customers.values()].find(v => String(v.email || '').toLowerCase() === String(email).toLowerCase());
    return c ? { id:c.id, fullName:c.fullName, phone:c.phone, email:c.email, passwordHash:c.passwordHash, role:c.role || 'customer', supabaseUserId:c.supabaseUserId } : null;
  }

  async function findCustomerById(id) {
    if (useDatabase) {
      const { rows } = await pool.query('select id,full_name,phone,email,password_hash,role,supabase_user_id from customers where id=$1', [id]);
      return rows[0] ? { ...mapCustomer(rows[0]), passwordHash: rows[0].password_hash } : null;
    }
    const c = memory.customers.get(id);
    return c ? { id:c.id, fullName:c.fullName, phone:c.phone, email:c.email, passwordHash:c.passwordHash, role:c.role || 'customer', supabaseUserId:c.supabaseUserId } : null;
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

  async function seedMemoryVehicles(items = []) { if (useDatabase) return; for (const item of items) memory.vehicles.set(String(item.id), item); }

  return {health,close,listVehicles,getVehicle,createCustomer,createOrLinkCustomerFromSupabase,findCustomerBySupabaseUserId,findCustomerByPhone,findCustomerByEmail,findCustomerById,findVendorByCustomerId,ensureVendorForCustomer,updateVendor,listVendorVehicles,getVendorVehicle,createVendorVehicle,updateVendorVehicle,deactivateVendorVehicle,listVendorBookings,getVendorBooking,updateVendorBookingStatus,checkVehicleAvailability,getVehicleState,isVehicleUnavailable,createBooking,getBooking,listCustomerBookings,cancelBooking,applyPaymentEvent,withPaymentLock,findPaymentById,findPaymentByProviderOrder,findPaymentByBooking,createOrGetPaymentOrder,submitPaymentReference,verifyPayment,refundPayment,createOtp,consumeLatestOtp,incrementOtpAttempt,seedMemoryVehicles};
}
