import crypto from 'node:crypto';
import pg from 'pg';
import { calculateCancellation } from './lifecycle.js';
import { createPricingService } from './pricing.js';

const { Pool } = pg;

const iso = (value) => value instanceof Date ? value.toISOString() : value;

export function createRepository({ databaseUrl, fleet }) {
  const useDatabase = Boolean(databaseUrl);
  const pool = useDatabase ? new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  }) : null;
  const pricingService = createPricingService();
  const memory = { customers:new Map(), bookings:new Map(), idempotency:new Map(), paymentEvents:new Map(), payments:new Map(), financialTransactions:new Map(), vendors:new Map(), vehicles:new Map(), securityDeposits:new Map(),trackingSessions:new Map(),reviews:new Map(),supportTickets:new Map(),supportMessages:new Map(),vehicleReservations:new Map() };

  const mapPaymentRow = (row) => row && ({
    id:String(row.id),
    bookingId:String(row.booking_id),
    provider:row.provider,
    providerOrderId:row.provider_order_id,
    providerPaymentId:row.provider_payment_id || undefined,
    providerReference:row.provider_reference || undefined,
    amountPaise:Number(row.amount_paise),
    amount:Number(row.amount_paise)/100,
    currency:row.currency || 'INR',
    status:row.status,
    idempotencyKey:row.idempotency_key || undefined,
    createdAt:iso(row.created_at),
    updatedAt:iso(row.updated_at)
  });

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
      cancellationFee:Number(row.cancellation_fee_paise || 0) / 100,
      refundAmount:Number(row.refund_amount_paise || 0) / 100,
      cancelledAt:iso(row.cancelled_at),
      cancellationReason:row.cancellation_reason || undefined,
      tax:Number(row.tax_paise || 0) / 100,
      discount:Number(row.discount_paise || 0) / 100,
      securityDepositStatus:row.security_deposit_status || undefined,
      securityDepositRefundable:Number(row.security_deposit_refundable_paise || 0) / 100,
      securityDepositDeduction:Number(row.security_deposit_deduction_paise || 0) / 100,
      securityDepositReason:row.security_deposit_reason || undefined,
      securityDepositEvidence:row.security_deposit_evidence || undefined,
      securityDepositRefundReference:row.security_deposit_refund_reference || undefined,
      securityDepositInspectedAt:iso(row.security_deposit_inspected_at),
      securityDepositInspectedBy:row.security_deposit_inspected_by ? String(row.security_deposit_inspected_by) : undefined,
      lifecycleState:String(row.lifecycle_state || (row.status === 'completed' ? 'COMPLETED' : row.status === 'in_progress' ? 'ACTIVE_RENTAL' : row.status === 'confirmed' ? 'CONFIRMED' : 'CONFIRMED')).toUpperCase(),
      fleetOrderId:row.fleet_order_id ? String(row.fleet_order_id) : undefined,
      pickupConfirmedAt:iso(row.pickup_confirmed_at),
      returnRequestedAt:iso(row.return_requested_at),
      returnReceivedAt:iso(row.return_received_at),
      overdueAt:iso(row.overdue_at),
      rejectionReason:row.cancellation_reason && row.status==='rejected' ? row.cancellation_reason : undefined,
      deliveryLatitude:row.delivery_latitude == null ? null : Number(row.delivery_latitude),
      deliveryLongitude:row.delivery_longitude == null ? null : Number(row.delivery_longitude),
      vendorServiceLatitude:row.vendor_service_latitude == null ? null : Number(row.vendor_service_latitude),
      vendorServiceLongitude:row.vendor_service_longitude == null ? null : Number(row.vendor_service_longitude),
      routeDistanceMeters:row.route_distance_meters == null ? null : Number(row.route_distance_meters),
      routeDurationSeconds:row.route_duration_seconds == null ? null : Number(row.route_duration_seconds),
      routeProvider:row.route_provider || undefined,
      deliveryStatus:row.delivery_status || 'scheduled',
      deliveryStartedAt:iso(row.delivery_started_at),
      deliveredAt:iso(row.delivered_at),
      deliveryFinalLatitude:row.delivery_final_latitude == null ? null : Number(row.delivery_final_latitude),
      deliveryFinalLongitude:row.delivery_final_longitude == null ? null : Number(row.delivery_final_longitude),
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
    const typeValue=type?.toLowerCase(),cityValue=city?.trim().toLowerCase(),qValue=q?.trim().toLowerCase();
    if(!useDatabase)return [...memory.vehicles.values(),...fleet].filter(v=>v.ownerId==null&&v.active!==false&&String(v.type||'').toLowerCase()!=='car'&&['bike','scooter'].includes(String(v.fleetVehicleClass||v.vehicleClass||'bike').toLowerCase())&&String(v.operationalState||'AVAILABLE').toUpperCase()==='AVAILABLE'&&v.maintenanceRequired!==true&&v.pricingActive!==false&&(!typeValue||typeValue==='all'||String(v.fleetVehicleClass||v.vehicleClass||v.type||'').toLowerCase()===typeValue)&&(!cityValue||String(v.city||'').trim().toLowerCase()===cityValue)&&(!qValue||`${v.name||''} ${v.subtitle||''} ${v.make||''} ${v.model||''}`.toLowerCase().includes(qValue)));
    const params=[],where=["owner_id is null","active=true","coalesce(type::text,'') <> 'car'","coalesce(fleet_vehicle_class,'bike') in ('bike','scooter')","coalesce(operational_state,'AVAILABLE')='AVAILABLE'","coalesce(maintenance_required,false)=false","coalesce(rideon_pricing_active,true)=true"];
    if(typeValue&&typeValue!=='all'){params.push(typeValue);where.push(`lower(coalesce(fleet_vehicle_class,'bike'))=$${params.length}`);}
    if(cityValue){params.push(cityValue);where.push(`lower(trim(coalesce(city,'')))=lower(trim($${params.length}))`);}
    if(qValue){params.push(`%${qValue}%`);where.push(`(lower(coalesce(name,'')) ilike $${params.length} or lower(coalesce(make,'')) ilike $${params.length} or lower(coalesce(model,'')) ilike $${params.length})`);}
    const {rows}=await pool.query(`select id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,active,transmission,fuel,seats,description,image_urls,delivery_available,owner_id,variant,color,pickup_location,pickup_latitude,pickup_longitude,service_area,fleet_vehicle_class,operational_state,maintenance_required,current_odometer,current_fuel_battery from vehicles where ${where.join(' and ')} order by name asc`,params);
    return rows.map(mapManagedVehicle);
  }
  async function listLocations() {
    // Locations are derived from the active fleet. There is no global service-city
    // restriction: a vendor's primary service city does not limit where its
    // individual vehicles can be listed.
    if (!useDatabase) {
      return [...new Set([...fleet, ...memory.vehicles.values()]
        .filter(v => v.active !== false)
        .map(v => String(v.city || '').trim())
        .filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b));
    }
    const { rows } = await pool.query(
      "select distinct trim(city) as city from vehicles where active=true and trim(city) <> '' order by trim(city) asc"
    );
    return rows.map(row => row.city).filter(Boolean);
  }

  async function getVehicle(id) {
    if(!useDatabase)return [...memory.vehicles.values(),...fleet].find(v=>String(v.id)===String(id)&&v.ownerId==null&&v.active!==false&&String(v.type||'').toLowerCase()!=='car'&&['bike','scooter'].includes(String(v.fleetVehicleClass||v.vehicleClass||'bike').toLowerCase())&&String(v.operationalState||'AVAILABLE').toUpperCase()==='AVAILABLE'&&v.maintenanceRequired!==true&&v.pricingActive!==false)||null;
    const {rows}=await pool.query("select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,active,transmission,fuel,seats,description,image_urls,delivery_available,variant,color,pickup_location,pickup_latitude,pickup_longitude,service_area,fleet_vehicle_class,operational_state,maintenance_required,current_odometer,current_fuel_battery from vehicles where id=$1 and owner_id is null and active=true and type::text<>'car' and coalesce(fleet_vehicle_class,'bike') in ('bike','scooter') and coalesce(operational_state,'AVAILABLE')='AVAILABLE' and coalesce(maintenance_required,false)=false and coalesce(rideon_pricing_active,true)=true",[id]);
    return rows[0]?mapManagedVehicle(rows[0]):null;
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
    serviceLatitude: row.service_latitude == null ? null : Number(row.service_latitude),
    serviceLongitude: row.service_longitude == null ? null : Number(row.service_longitude),
    serviceAddress: row.service_address || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

  const mapManagedVehicle = (row) => row && ({
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    variant: row.variant || '',
    color: row.color || '',
    fleetVehicleClass: row.fleet_vehicle_class || '',
    pickupLocation: row.pickup_location || null,
    pickupLatitude: row.pickup_latitude == null ? null : Number(row.pickup_latitude),
    pickupLongitude: row.pickup_longitude == null ? null : Number(row.pickup_longitude),
    serviceArea: row.service_area || {},
    operationalState: row.operational_state || 'AVAILABLE',
    maintenanceRequired: Boolean(row.maintenance_required),
    currentOdometer: row.current_odometer == null ? null : Number(row.current_odometer),
    currentFuelBattery: row.current_fuel_battery == null ? null : Number(row.current_fuel_battery),
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
      'select id,owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area,service_latitude,service_longitude,service_address,created_at,updated_at from vendors where owner_customer_id=$1',
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
        input.phone || (customer.phone?.startsWith('supa-') ? '' : customer.phone) || '',
        input.email || customer.email || '',
        input.address || input.serviceCity || '',
        input.serviceCity || 'Jaipur',
        input.serviceArea || {},
      ]
    );
    return rows[0] ? mapVendor(rows[0]) : null;
  }

  async function updateVendorServiceLocation(customerId, input = {}) {
    const latitude = input.latitude == null || input.latitude === '' ? null : Number(input.latitude);
    const longitude = input.longitude == null || input.longitude === '' ? null : Number(input.longitude);
    if ((latitude == null) !== (longitude == null)) {
      const e = new Error('Provide both service latitude and longitude, or leave both empty.');
      e.code = 'INVALID_SERVICE_LOCATION';
      throw e;
    }
    if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
      const e = new Error('Service latitude must be between -90 and 90.');
      e.code = 'INVALID_SERVICE_LOCATION';
      throw e;
    }
    if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
      const e = new Error('Service longitude must be between -180 and 180.');
      e.code = 'INVALID_SERVICE_LOCATION';
      throw e;
    }
    const address = input.address == null ? undefined : String(input.address).trim().slice(0, 300);
    const serviceCity = input.serviceCity == null ? undefined : String(input.serviceCity).trim().slice(0, 100);
    if (!useDatabase) {
      const vendor = await ensureVendorForCustomer(customerId, {});
      if (address !== undefined) vendor.serviceAddress = address;
      if (serviceCity !== undefined) vendor.serviceCity = serviceCity;
      vendor.serviceLatitude = latitude;
      vendor.serviceLongitude = longitude;
      vendor.updatedAt = new Date().toISOString();
      return vendor;
    }
    const vendor = await findVendorByCustomerId(customerId);
    if (!vendor) return null;
    const { rows } = await pool.query(
      `update vendors
       set service_latitude=$2, service_longitude=$3,
           service_address=case when $4::text is null then service_address else $4 end,
           service_city=case when $5::text is null then service_city else $5 end,
           updated_at=now()
       where owner_customer_id=$1
       returning id,owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area,service_latitude,service_longitude,service_address,created_at,updated_at`,
      [customerId, latitude, longitude, address ?? null, serviceCity ?? null]
    );
    return rows[0] ? mapVendor(rows[0]) : null;
  }

  async function getVendorServiceLocation(customerId) {
    const vendor = await findVendorByCustomerId(customerId);
    if (!vendor) return null;
    return {
      vendorId: vendor.id,
      businessName: vendor.businessName,
      serviceCity: vendor.serviceCity || null,
      address: vendor.serviceAddress || vendor.address || null,
      latitude: vendor.serviceLatitude ?? null,
      longitude: vendor.serviceLongitude ?? null,
    };
  }

  async function listMarketplaceVendors({ city } = {}) {
    if (!useDatabase) {
      const entries = [...(memory.vendors?.values() || [])]
        .filter(v => v.serviceLatitude != null && v.serviceLongitude != null)
        .filter(v => !city || String(v.serviceCity || '').toLowerCase() === String(city).trim().toLowerCase());
      const counts = new Map();
      for (const vehicle of [...fleet, ...memory.vehicles.values()]) {
        if (vehicle.active === false || !vehicle.ownerId) continue;
        const key = String(vehicle.ownerId);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return entries.map(v => ({
        vendorId: v.id,
        businessName: v.businessName,
        serviceCity: v.serviceCity || null,
        address: v.serviceAddress || v.address || null,
        latitude: Number(v.serviceLatitude),
        longitude: Number(v.serviceLongitude),
        availableVehicleCount: counts.get(String(v.id)) || 0,
      }));
    }
    const params=[];
    const where=[`v.status='active'`, 'v.service_latitude is not null', 'v.service_longitude is not null'];
    if(city && String(city).trim()) {
      params.push(String(city).trim());
      where.push(`lower(trim(v.service_city)) = lower(trim($${params.length}))`);
    }
    const { rows } = await pool.query(
      `select v.id, v.business_name, v.service_city, v.service_address,
              v.service_latitude, v.service_longitude, count(ve.id)::int as available_vehicle_count
       from vendors v
       left join vehicles ve on ve.owner_id=v.id and ve.active=true
       where ${where.join(' and ')}
       group by v.id, v.business_name, v.service_city, v.service_address, v.service_latitude, v.service_longitude
       order by v.business_name asc`,
      params
    );
    return rows.map(v => ({
      vendorId:String(v.id),
      businessName:v.business_name,
      serviceCity:v.service_city || null,
      address:v.service_address || null,
      latitude:Number(v.service_latitude),
      longitude:Number(v.service_longitude),
      availableVehicleCount:Number(v.available_vehicle_count || 0),
    }));
  }

  async function listRideOnFleet({q='',type='',brand='',model='',city='',minPrice=null,maxPrice=null,sort='recommended',limit=50,offset=0}={}) {
    const safeLimit=Math.max(1,Math.min(100,Number(limit)||50)),safeOffset=Math.max(0,Number(offset)||0);
    const query=String(q||'').trim().toLowerCase();
    const typeFilter=String(type||'').trim().toLowerCase();
    const brandFilter=String(brand||'').trim().toLowerCase();
    const modelFilter=String(model||'').trim().toLowerCase();
    const cityFilter=String(city||'').trim().toLowerCase();
    const min=minPrice==null||minPrice===''?null:Number(minPrice);
    const max=maxPrice==null||maxPrice===''?null:Number(maxPrice);
    const sortValue=String(sort||'recommended').toLowerCase();
    const classFilter=typeFilter==='scooter'?'scooter':typeFilter==='bike'?'bike':'';
    if(!useDatabase){
      let rows=[...memory.vehicles.values(),...fleet].filter(v=>v.active!==false);
      rows=rows.filter(v=>{
        const vehicleClass=String(v.fleetVehicleClass||v.vehicleClass||((/activa|access|scooty|scooter/i.test(String(v.name||'')+' '+String(v.model||'')))?'scooter':'bike')).toLowerCase();
        const sourceType=String(v.type||'').toLowerCase();
        const text=[v.name,v.make,v.model,v.variant,v.city].filter(Boolean).join(' ').toLowerCase();
        const price=Number(v.pricePerDay??v.dailyRate??0);
        return (!query||text.includes(query))&&(!classFilter||vehicleClass===classFilter)&&sourceType!=='car'&&(!brandFilter||String(v.make||'').toLowerCase()===brandFilter)&&(!modelFilter||String(v.model||'').toLowerCase()===modelFilter)&&(!cityFilter||String(v.city||'').toLowerCase()===cityFilter)&&(min==null||price>=min)&&(max==null||price<=max)&&String(v.operationalState||'AVAILABLE').toUpperCase()!=='MAINTENANCE'&&String(v.operationalState||'AVAILABLE').toUpperCase()!=='INACTIVE'&&v.maintenanceRequired!==true;
      });
      if(sortValue==='price_asc')rows.sort((a,b)=>Number(a.pricePerDay??a.dailyRate)-Number(b.pricePerDay??b.dailyRate));else if(sortValue==='price_desc')rows.sort((a,b)=>Number(b.pricePerDay??b.dailyRate)-Number(a.pricePerDay??a.dailyRate));else rows.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
      return rows.slice(safeOffset,safeOffset+safeLimit);
    }
    const params=[];const where=["v.active=true","v.owner_id is null","coalesce(v.type::text,'') <> 'car'","coalesce(v.fleet_vehicle_class,'bike') in ('bike','scooter')","coalesce(v.operational_state,'AVAILABLE') not in ('MAINTENANCE','INACTIVE')","coalesce(v.maintenance_required,false)=false","coalesce(v.rideon_pricing_active,true)=true"];
    if(query){params.push('%'+query+'%');where.push("lower(coalesce(v.name,'') || ' ' || coalesce(v.make,'') || ' ' || coalesce(v.model,'') || ' ' || coalesce(v.variant,'')) like $"+params.length);}
    if(classFilter){params.push(classFilter);where.push("lower(coalesce(v.fleet_vehicle_class,'bike'))=$"+params.length);}
    if(brandFilter){params.push(brandFilter);where.push("lower(coalesce(v.make,''))=$"+params.length);}
    if(modelFilter){params.push(modelFilter);where.push("lower(coalesce(v.model,''))=$"+params.length);}
    if(cityFilter){params.push(cityFilter);where.push("lower(trim(coalesce(v.city,'')))=lower(trim($"+params.length+"))");}
    if(min!=null&&Number.isFinite(min)){params.push(Math.round(min*100));where.push('v.daily_rate_paise>=
    if(!useDatabase){
      const v=[...memory.vehicles.values(),...fleet].find(x=>String(x.id)===String(vehicleId)&&x.ownerId==null&&x.active!==false&&x.pricingActive!==false&&String(x.type||'').toLowerCase()!=='car'&&String(x.operationalState||'AVAILABLE').toUpperCase()!=='MAINTENANCE'&&String(x.operationalState||'AVAILABLE').toUpperCase()!=='INACTIVE'&&x.maintenanceRequired!==true);
      return v||null;
    }
    const {rows}=await pool.query("select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,variant,color,pickup_location,service_area,fleet_vehicle_class,operational_state,maintenance_required,description,image_urls,delivery_available,active,created_at,updated_at from vehicles where id=$1 and owner_id is null and active=true and type::text<>'car' and coalesce(fleet_vehicle_class,'bike') in ('bike','scooter') and coalesce(operational_state,'AVAILABLE') not in ('MAINTENANCE','INACTIVE') and coalesce(maintenance_required,false)=false and coalesce(rideon_pricing_active,true)=true",[vehicleId]);
    return rows[0]?mapManagedVehicle(rows[0]):null;
  }

  async function getPublicVendorProfile(vendorId) {
    if (!useDatabase) {
      const vendor = [...memory.vendors.values()].find(v => String(v.id) === String(vendorId) && v.status === 'active');
      if (!vendor) return null;
      const vehicles = [...memory.vehicles.values()].filter(v => String(v.ownerId) === String(vendor.id) && v.active !== false);
      return { id:String(vendor.id), businessName:vendor.businessName, serviceCity:vendor.serviceCity || null, address:vendor.serviceAddress || vendor.address || null, latitude:vendor.serviceLatitude ?? null, longitude:vendor.serviceLongitude ?? null, rating:0, reviewCount:0, availableVehicleCount:vehicles.length };
    }
    const result = await pool.query(`select v.id,v.business_name,v.service_city,v.service_address,v.service_latitude,v.service_longitude,count(ve.id)::int as available_vehicle_count from vendors v left join vehicles ve on ve.owner_id=v.id and ve.active=true where v.id=$1 and v.status='active' group by v.id,v.business_name,v.service_city,v.service_address,v.service_latitude,v.service_longitude`, [vendorId]);
    if (!result.rows[0]) return null;
    const reviewRows = await pool.query(`select r.rating from reviews r join bookings b on b.id=r.booking_id join vehicles ve on ve.id=b.vehicle_id where r.review_type='customer_to_vendor' and coalesce(b.vendor_id,ve.owner_id)=$1`, [vendorId]);
    const ratings = reviewRows.rows.map(x => Number(x.rating)).filter(Number.isFinite);
    return { id:String(result.rows[0].id), businessName:result.rows[0].business_name, serviceCity:result.rows[0].service_city || null, address:result.rows[0].service_address || null, latitude:result.rows[0].service_latitude == null ? null : Number(result.rows[0].service_latitude), longitude:result.rows[0].service_longitude == null ? null : Number(result.rows[0].service_longitude), rating:ratings.length ? Number((ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(2)) : 0, reviewCount:ratings.length, availableVehicleCount:Number(result.rows[0].available_vehicle_count || 0) };
  }

  async function listPublicVendorVehicles(vendorId, {limit=50,offset=0}={}) {
    const safeLimit=Math.max(1,Math.min(100,Number(limit)||50));
    const safeOffset=Math.max(0,Number(offset)||0);
    if (!useDatabase) return [...memory.vehicles.values()].filter(v=>String(v.ownerId)===String(vendorId)&&v.active!==false).slice(safeOffset,safeOffset+safeLimit);
    const {rows}=await pool.query(`select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,description,image_urls,delivery_available,active,created_at,updated_at from vehicles where owner_id=$1 and active=true order by name asc,created_at desc limit $2 offset $3`,[vendorId,safeLimit,safeOffset]);
    return rows.map(mapManagedVehicle);
  }

  async function quoteMultiVehicle({customerId,vehicleIds,startAt,endAt,delivery=true,address='',deliveryLatitude=null,deliveryLongitude=null}={}) {
    void customerId;
    const ids=[...new Set((vehicleIds||[]).map(v=>String(v).trim()).filter(Boolean))];
    if(ids.length<2||ids.length>10)throw Object.assign(new Error('Select between 2 and 10 vehicles.'),{code:'INVALID_MULTI_CART'});
    const parsed=pricingService.parseWindow(startAt,endAt);
    const lat=delivery&&deliveryLatitude!=null&&deliveryLatitude!==''?Number(deliveryLatitude):null;
    const lon=delivery&&deliveryLongitude!=null&&deliveryLongitude!==''?Number(deliveryLongitude):null;
    if(delivery&&((lat==null)!==(lon==null)||lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90)||lon!=null&&(!Number.isFinite(lon)||lon<-180||lon>180)))throw Object.assign(new Error('A valid delivery location is required.'),{code:'INVALID_DELIVERY_LOCATION'});
    const vehicles=useDatabase
      ? (await pool.query(`select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,description,image_urls,delivery_available,active,operational_state,maintenance_required,fleet_vehicle_class from vehicles where active=true and owner_id is null and id::text=any($1::text[]) and type::text<>'car' and coalesce(fleet_vehicle_class,'bike') in ('bike','scooter') and coalesce(operational_state,'AVAILABLE')='AVAILABLE' and coalesce(maintenance_required,false)=false and coalesce(rideon_pricing_active,true)=true`,[ids])).rows.map(mapManagedVehicle)
      : [...memory.vehicles.values(),...fleet].filter(v=>v.ownerId==null&&v.active!==false&&ids.includes(String(v.id))&&String(v.type||'').toLowerCase()!=='car'&&['bike','scooter'].includes(String(v.fleetVehicleClass||v.vehicleClass||'bike').toLowerCase())&&String(v.operationalState||'AVAILABLE').toUpperCase()==='AVAILABLE'&&v.maintenanceRequired!==true&&v.pricingActive!==false);
    if(vehicles.length!==ids.length)throw Object.assign(new Error('One or more selected RideOn vehicles are unavailable.'),{code:'MULTI_VEHICLE_ACCESS_DENIED'});
    const availability=await Promise.all(vehicles.map(v=>checkVehicleAvailability(v.id,parsed.start.toISOString(),parsed.end.toISOString())));
    const unavailable=availability.filter(x=>!x.available).map(x=>String(x.vehicleId));
    if(unavailable.length)throw Object.assign(new Error('One or more selected vehicles became unavailable.'),{code:'MULTI_VEHICLE_UNAVAILABLE',vehicleIds:unavailable});
    const quote=pricingService.calculateMultiVehicle({vehicles,startAt:parsed.start.toISOString(),endAt:parsed.end.toISOString(),delivery});
    const items=quote.items.map((item)=>({
      ...item,
      rental:item.rentalSubtotal,
      total:item.totalPayable,
      deliveryFee:item.deliveryFee,
      platformFee:item.platformFee,
      securityDeposit:item.securityDeposit,
      tax:item.tax,
      discount:item.discount,
    }));
    return {
      fleetOwner:'rideon', vehicleIds:ids, startAt:parsed.start.toISOString(), endAt:parsed.end.toISOString(),
      delivery:Boolean(delivery), address:String(address||'').trim().slice(0,300),
      deliveryLatitude:lat,deliveryLongitude:lon,items,
      rentalSubtotal:quote.rentalSubtotal,deliveryFee:quote.deliveryFee,platformFee:quote.platformFee,
      tax:quote.tax,discount:quote.discount,securityDeposit:quote.securityDeposit,
      payableExcludingDeposit:quote.payableExcludingDeposit,total:quote.totalPayable,
      totalPayable:quote.totalPayable,refundableSecurityDeposit:quote.refundableSecurityDeposit,
      currency:'INR',quoteExpiresAt:quote.quoteExpiresAt,pricingConfigVersion:quote.pricingConfigVersion
    };
  }

  async function createVehicleReservation({vehicleIds,customerId,startAt,endAt,expiresAt,idempotencyKey=null}={}) {
    const ids=[...new Set((vehicleIds||[]).map(v=>String(v).trim()).filter(Boolean))];
    if(!ids.length||ids.length>10)throw Object.assign(new Error('Select between 1 and 10 vehicles.'),{code:'INVALID_RESERVATION'});
    const key=idempotencyKey?String(idempotencyKey).trim():null;
    if(ids.length>1&&!key)throw Object.assign(new Error('An Idempotency-Key is required for multi-vehicle reservations.'),{code:'INVALID_IDEMPOTENCY_KEY'});
    const parsed=pricingService.parseWindow(startAt,endAt);
    const expiry=expiresAt?new Date(expiresAt):new Date(pricingService.reservationExpiry());
    if(Number.isNaN(expiry.getTime())||expiry<=new Date())throw Object.assign(new Error('Reservation expiry is invalid.'),{code:'INVALID_RESERVATION'});
    const now=new Date();
    if(!useDatabase){
      for(const r of memory.vehicleReservations.values()){
        if(r.status==='active'&&new Date(r.expiresAt)<=now)r.status='expired';
      }
      if(key){
        const replay=[...memory.vehicleReservations.values()].filter(r=>String(r.customerId)===String(customerId)&&r.idempotencyKey===key);
        if(replay.length)return {...replay[0],vehicleIds:replay.map(r=>String(r.vehicleId)),id:replay[0].groupId||replay[0].id};
      }
      for(const id of ids){
        const vehicle=[...memory.vehicles.values(),...fleet].find(v=>String(v.id)===id&&v.ownerId==null&&v.active!==false&&String(v.type||'').toLowerCase()!=='car'&&['bike','scooter'].includes(String(v.fleetVehicleClass||v.vehicleClass||'bike').toLowerCase()));
        if(!vehicle)throw Object.assign(new Error('One or more vehicles are unavailable.'),{code:'VEHICLE_UNAVAILABLE'});
        const state=String(vehicle.operationalState||'AVAILABLE').toUpperCase();
        if(state!=='AVAILABLE'||vehicle.maintenanceRequired===true||vehicle.pricingActive===false)throw Object.assign(new Error('One or more vehicles are unavailable.'),{code:'VEHICLE_UNAVAILABLE'});
        const conflict=[...memory.vehicleReservations.values()].some(r=>String(r.vehicleId)===id&&r.status==='active'&&new Date(r.expiresAt)>now&&new Date(r.startAt)<parsed.end&&new Date(r.endAt)>parsed.start);
        const bookingConflict=[...memory.bookings.values()].some(b=>String(b.vehicleId)===id&&['requested','confirmed','in_progress'].includes(String(b.status))&&new Date(b.startAt)<parsed.end&&new Date(b.endAt)>parsed.start);
        if(conflict||bookingConflict)throw Object.assign(new Error('Vehicle is temporarily unavailable.'),{code:'VEHICLE_UNAVAILABLE'});
      }
      const groupId=crypto.randomUUID();
      for(const id of ids){
        const reservation={id:crypto.randomUUID(),groupId,vehicleId:id,customerId:String(customerId),startAt:parsed.start.toISOString(),endAt:parsed.end.toISOString(),expiresAt:expiry.toISOString(),status:'active',idempotencyKey:key};
        memory.vehicleReservations.set(reservation.id,reservation);
      }
      const first=[...memory.vehicleReservations.values()].find(r=>r.groupId===groupId);
      return {id:first.id,groupId,vehicleIds:ids,customerId:String(customerId),startAt:parsed.start.toISOString(),endAt:parsed.end.toISOString(),expiresAt:expiry.toISOString(),status:'active',idempotencyKey:key};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      if(key){
        const existing=await client.query("select * from rideon_vehicle_reservations where customer_id=$1 and idempotency_key=$2 order by created_at for update",[customerId,key]);
        if(existing.rows.length){
          await client.query('commit');
          return {id:String(existing.rows[0].id),groupId:existing.rows[0].reservation_group_id?String(existing.rows[0].reservation_group_id):String(existing.rows[0].id),vehicleIds:existing.rows.map(r=>String(r.vehicle_id)),customerId:String(customerId),startAt:iso(existing.rows[0].start_at),endAt:iso(existing.rows[0].end_at),expiresAt:iso(existing.rows[0].expires_at),status:existing.rows.every(r=>r.status==='active')?'active':existing.rows[0].status,idempotencyKey:key};
        }
      }
      const locked=await client.query("select id from vehicles where id::text=any($1::text[]) and owner_id is null and active=true and type::text<>'car' and coalesce(fleet_vehicle_class,'bike') in ('bike','scooter') and coalesce(operational_state,'AVAILABLE')='AVAILABLE' and coalesce(maintenance_required,false)=false and coalesce(rideon_pricing_active,true)=true for update",[ids]);
      if(locked.rows.length!==ids.length)throw Object.assign(new Error('One or more vehicles are unavailable.'),{code:'VEHICLE_UNAVAILABLE'});
      await client.query("update rideon_vehicle_reservations set status='expired',updated_at=now() where status='active' and expires_at<=now()");
      const conflicts=await client.query(`select 1 from rideon_vehicle_reservations where vehicle_id::text=any($1::text[]) and status='active' and start_at<$3 and end_at>$2 and expires_at>now() limit 1`,[ids,parsed.start.toISOString(),parsed.end.toISOString()]);
      if(conflicts.rows[0])throw Object.assign(new Error('Vehicle is temporarily reserved by another checkout.'),{code:'VEHICLE_UNAVAILABLE'});
      const bookingConflict=await client.query(`select 1 from bookings where vehicle_id::text=any($1::text[]) and status in ('requested','confirmed','in_progress') and start_at<$3 and end_at>$2 limit 1`,[ids,parsed.start.toISOString(),parsed.end.toISOString()]);
      if(bookingConflict.rows[0])throw Object.assign(new Error('Vehicle is already booked for those dates.'),{code:'VEHICLE_UNAVAILABLE'});
      const groupId=crypto.randomUUID(),rows=[];
      for(const id of ids){
        const q=await client.query(`insert into rideon_vehicle_reservations(vehicle_id,customer_id,start_at,end_at,status,expires_at,idempotency_key,reservation_group_id) values($1,$2,$3,$4,'active',$5,$6,$7) returning *`,[id,customerId,parsed.start.toISOString(),parsed.end.toISOString(),expiry.toISOString(),key,groupId]);
        rows.push(q.rows[0]);
      }
      await client.query('commit');
      return {id:String(rows[0].id),groupId,vehicleIds:ids,customerId:String(customerId),startAt:parsed.start.toISOString(),endAt:parsed.end.toISOString(),expiresAt:expiry.toISOString(),status:'active',idempotencyKey:key};
    }catch(error){try{await client.query('rollback')}catch{}throw error;}finally{client.release();}
  }

  async function releaseVehicleReservation(reservationId,{customerId=null,status='released'}={}) {
    if(!['released','expired','converted'].includes(status))throw Object.assign(new Error('Invalid reservation state.'),{code:'INVALID_RESERVATION'});
    if(!useDatabase){
      const first=memory.vehicleReservations.get(String(reservationId));
      if(!first||customerId&&String(first.customerId)!==String(customerId))return null;
      const group=first.groupId||first.id;
      let representative=null;
      for(const r of memory.vehicleReservations.values()){
        if((r.groupId||r.id)===group&&String(r.customerId)===String(first.customerId)&&r.status==='active'){r.status=status;r.updatedAt=new Date().toISOString();representative=representative||r;}
      }
      return representative?{...representative,groupId:group,vehicleIds:[...memory.vehicleReservations.values()].filter(r=>(r.groupId||r.id)===group).map(r=>String(r.vehicleId))}:null;
    }
    const first=await pool.query("select id,customer_id,idempotency_key,reservation_group_id from rideon_vehicle_reservations where id=$1",[reservationId]);
    if(!first.rows[0]||customerId&&String(first.rows[0].customer_id)!==String(customerId))return null;
    const row=first.rows[0];
    const predicate=row.reservation_group_id
      ? ["reservation_group_id=$1", [row.reservation_group_id]]
      : row.idempotency_key
        ? ["customer_id=$1 and idempotency_key=$2", [row.customer_id,row.idempotency_key]]
        : ["id=$1", [row.id]];
    const values=row.reservation_group_id?[row.reservation_group_id]:row.idempotency_key?[row.customer_id,row.idempotency_key]:[row.id];
    const q=await pool.query(`update rideon_vehicle_reservations set status=$${values.length+1},updated_at=now() where ${predicate[0]} and status='active' returning *`,[...values,status]);
    return q.rows[0]||null;
  }
  async function recalculateFleetOrderPricing(orderId, customerId) {
    if(!useDatabase){
      const order=memory.fleetOrders?.get(String(orderId));
      if(!order||String(order.customerId)!==String(customerId))return {code:'FLEET_ORDER_NOT_FOUND'};
      if(new Date(order.quoteExpiresAt)<=new Date())return {code:'QUOTE_STALE'};
      const vehicles=order.items.map(item=>item.vehicle);
      const availability=await Promise.all(order.items.map(item=>checkVehicleAvailability(item.vehicleId,order.startAt,order.endAt)));
      if(availability.some(x=>!x.available))return {code:'VEHICLE_UNAVAILABLE'};
      const quote=pricingService.calculateMultiVehicle({vehicles,startAt:order.startAt,endAt:order.endAt,delivery:Boolean(order.delivery)});
      const freshTotal=Math.round(quote.totalPayable*100);
      const storedTotal=Math.round(Number(order.total||0)*100);
      if(freshTotal!==storedTotal||Math.round(Number(order.rentalSubtotal||0)*100)!==Math.round(quote.rentalSubtotal*100)||Math.round(Number(order.deliveryFee||0)*100)!==Math.round(quote.deliveryFee*100)||Math.round(Number(order.platformFee||0)*100)!==Math.round(quote.platformFee*100)||Math.round(Number(order.securityDeposit||0)*100)!==Math.round(quote.securityDeposit*100))return {code:'QUOTE_STALE'};
      return {code:'OK',totalPaise:freshTotal,quote};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const oq=await client.query('select * from fleet_orders where id=$1 and customer_id=$2 for update',[orderId,customerId]);
      if(!oq.rows[0]){await client.query('rollback');return {code:'FLEET_ORDER_NOT_FOUND'};}
      const order=oq.rows[0];
      if(!order.quote_expires_at||new Date(order.quote_expires_at)<=new Date()){await client.query('rollback');return {code:'QUOTE_STALE'};}
      const items=await client.query(`select b.*,v.id as v_id,v.name as v_name,v.type as v_type,v.daily_rate_paise,v.security_deposit_paise,v.active,v.owner_id,v.operational_state,v.maintenance_required,v.fleet_vehicle_class from bookings b join vehicles v on v.id=b.vehicle_id where b.fleet_order_id=$1 order by b.id`,[orderId]);
      if(!items.rows.length){await client.query('rollback');return {code:'FLEET_ORDER_NOT_FOUND'};}
      for(const row of items.rows){
        if(row.owner_id||String(row.type||'').toLowerCase()==='car'||!row.active||row.maintenance_required||String(row.operational_state||'AVAILABLE')!=='AVAILABLE'){await client.query('rollback');return {code:'VEHICLE_UNAVAILABLE'};}
        const conflict=await client.query("select 1 from bookings where vehicle_id=$1 and id<>$2 and status in ('requested','confirmed','in_progress') and start_at<$4 and end_at>$3 limit 1",[row.vehicle_id,row.id,order.start_at,order.end_at]);
        if(conflict.rows[0]){await client.query('rollback');return {code:'VEHICLE_UNAVAILABLE'};}
        const reservation=await client.query("select 1 from rideon_vehicle_reservations where vehicle_id=$1 and status='active' and expires_at>now() and start_at<$3 and end_at>$2 and customer_id<>$4 limit 1",[row.vehicle_id,order.start_at,order.end_at,customerId]);
        if(reservation.rows[0]){await client.query('rollback');return {code:'VEHICLE_UNAVAILABLE'};}
      }
      const vehicles=items.rows.map(row=>({id:String(row.v_id),name:row.v_name,type:row.v_type,pricePerDay:Number(row.daily_rate_paise||0)/100,securityDeposit:Number(row.security_deposit_paise||0)/100}));
      const quote=pricingService.calculateMultiVehicle({vehicles,startAt:order.start_at,endAt:order.end_at,delivery:Boolean(order.delivery_required)});
      const fresh={rental:Number(quote.rentalSubtotal),deliveryFee:Number(quote.deliveryFee),platformFee:Number(quote.platformFee),tax:Number(quote.tax),discount:Number(quote.discount),securityDeposit:Number(quote.securityDeposit),total:Number(quote.totalPayable)};
      const stale=Number(order.rental_total_paise)!==Math.round(fresh.rental*100)||Number(order.delivery_fee_paise)!==Math.round(fresh.deliveryFee*100)||Number(order.platform_fee_paise)!==Math.round(fresh.platformFee*100)||Number(order.tax_paise||0)!==Math.round(fresh.tax*100)||Number(order.discount_paise||0)!==Math.round(fresh.discount*100)||Number(order.security_deposit_paise)!==Math.round(fresh.securityDeposit*100)||Number(order.total_paise)!==Math.round(fresh.total*100);
      await client.query('commit');
      return stale?{code:'QUOTE_STALE'}:{code:'OK',totalPaise:Math.round(fresh.total*100),quote:fresh};
    }catch(error){try{await client.query('rollback')}catch{}finally{client.release();}throw error;}
  }

  async function getAuthoritativeBookingPrice(bookingId, customerId=null) {
    if(!useDatabase){const b=memory.bookings.get(String(bookingId));if(!b||(customerId&&String(b.customerId)!==String(customerId)))return null;return {vehicleId:String(b.vehicleId),days:Number(b.pricing?.days||1),rentalSubtotal:Number(b.pricing?.rental||0),deliveryFee:Number(b.pricing?.deliveryFee||0),platformFee:Number(b.pricing?.platformFee||0),tax:Number(b.pricing?.tax||0),discount:Number(b.pricing?.discount||0),securityDeposit:Number(b.pricing?.securityDeposit||0),totalPayable:Number(b.pricing?.totalPayable??b.pricing?.total??0),refundableSecurityDeposit:Number(b.pricing?.refundableSecurityDeposit??b.pricing?.securityDeposit??0),payableExcludingDeposit:Number(b.pricing?.payableExcludingDeposit??(Number(b.pricing?.total??0)-Number(b.pricing?.securityDeposit??0))),currency:'INR',pricingSnapshot:true};}
    const {rows}=await pool.query('select id,vehicle_id,start_at,end_at,rental_total_paise,delivery_fee_paise,platform_fee_paise,tax_paise,discount_paise,security_deposit_paise,total_paise from bookings where id=$1 and ($2::uuid is null or customer_id=$2)',[bookingId,customerId]);const row=rows[0];if(!row)return null;
    const rental=Number(row.rental_total_paise||0)/100,deliveryFee=Number(row.delivery_fee_paise||0)/100,platformFee=Number(row.platform_fee_paise||0)/100,tax=Number(row.tax_paise||0)/100,discount=Number(row.discount_paise||0)/100,securityDeposit=Number(row.security_deposit_paise||0)/100,totalPayable=Number(row.total_paise||0)/100;
    return {vehicleId:String(row.vehicle_id),days:Math.max(1,Math.ceil((new Date(row.end_at)-new Date(row.start_at))/86400000)),rentalSubtotal:rental,deliveryFee,platformFee,tax,discount,securityDeposit,totalPayable,refundableSecurityDeposit:securityDeposit,payableExcludingDeposit:Math.max(0,totalPayable-securityDeposit),currency:'INR',pricingSnapshot:true};
  }
  async function recalculateFleetOrderPricing(orderId, customerId) {
    if(!useDatabase){
      const order=memory.fleetOrders?.get(String(orderId));
      if(!order||String(order.customerId)!==String(customerId))return {code:'FLEET_ORDER_NOT_FOUND'};
      if(new Date(order.quoteExpiresAt)<=new Date())return {code:'QUOTE_STALE'};
      const vehicles=order.items.map(item=>item.vehicle);
      const availability=await Promise.all(order.items.map(item=>checkVehicleAvailability(item.vehicleId,order.startAt,order.endAt)));
      if(availability.some(x=>!x.available))return {code:'VEHICLE_UNAVAILABLE'};
      const quote=pricingService.calculateMultiVehicle({vehicles,startAt:order.startAt,endAt:order.endAt,delivery:Boolean(order.delivery)});
      const freshTotal=Math.round(quote.totalPayable*100);
      const storedTotal=Math.round(Number(order.total||0)*100);
      if(freshTotal!==storedTotal||Math.round(Number(order.rentalSubtotal||0)*100)!==Math.round(quote.rentalSubtotal*100)||Math.round(Number(order.deliveryFee||0)*100)!==Math.round(quote.deliveryFee*100)||Math.round(Number(order.platformFee||0)*100)!==Math.round(quote.platformFee*100)||Math.round(Number(order.securityDeposit||0)*100)!==Math.round(quote.securityDeposit*100))return {code:'QUOTE_STALE'};
      return {code:'OK',totalPaise:freshTotal,quote};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const oq=await client.query('select * from fleet_orders where id=$1 and customer_id=$2 for update',[orderId,customerId]);
      if(!oq.rows[0]){await client.query('rollback');return {code:'FLEET_ORDER_NOT_FOUND'};}
      const order=oq.rows[0];
      if(!order.quote_expires_at||new Date(order.quote_expires_at)<=new Date()){await client.query('rollback');return {code:'QUOTE_STALE'};}
      const items=await client.query(`select b.*,v.id as v_id,v.name as v_name,v.type as v_type,v.daily_rate_paise,v.security_deposit_paise,v.active,v.owner_id,v.operational_state,v.maintenance_required,v.fleet_vehicle_class from bookings b join vehicles v on v.id=b.vehicle_id where b.fleet_order_id=$1 order by b.id`,[orderId]);
      if(!items.rows.length){await client.query('rollback');return {code:'FLEET_ORDER_NOT_FOUND'};}
      for(const row of items.rows){
        if(row.owner_id||String(row.type||'').toLowerCase()==='car'||!row.active||row.maintenance_required||String(row.operational_state||'AVAILABLE')!=='AVAILABLE'){await client.query('rollback');return {code:'VEHICLE_UNAVAILABLE'};}
        const conflict=await client.query("select 1 from bookings where vehicle_id=$1 and id<>$2 and status in ('requested','confirmed','in_progress') and start_at<$4 and end_at>$3 limit 1",[row.vehicle_id,row.id,order.start_at,order.end_at]);
        if(conflict.rows[0]){await client.query('rollback');return {code:'VEHICLE_UNAVAILABLE'};}
        const reservation=await client.query("select 1 from rideon_vehicle_reservations where vehicle_id=$1 and status='active' and expires_at>now() and start_at<$3 and end_at>$2 and customer_id<>$4 limit 1",[row.vehicle_id,order.start_at,order.end_at,customerId]);
        if(reservation.rows[0]){await client.query('rollback');return {code:'VEHICLE_UNAVAILABLE'};}
      }
      const vehicles=items.rows.map(row=>({id:String(row.v_id),name:row.v_name,type:row.v_type,pricePerDay:Number(row.daily_rate_paise||0)/100,securityDeposit:Number(row.security_deposit_paise||0)/100}));
      const quote=pricingService.calculateMultiVehicle({vehicles,startAt:order.start_at,endAt:order.end_at,delivery:Boolean(order.delivery_required)});
      const fresh={rental:Number(quote.rentalSubtotal),deliveryFee:Number(quote.deliveryFee),platformFee:Number(quote.platformFee),tax:Number(quote.tax),discount:Number(quote.discount),securityDeposit:Number(quote.securityDeposit),total:Number(quote.totalPayable)};
      const stale=Number(order.rental_total_paise)!==Math.round(fresh.rental*100)||Number(order.delivery_fee_paise)!==Math.round(fresh.deliveryFee*100)||Number(order.platform_fee_paise)!==Math.round(fresh.platformFee*100)||Number(order.tax_paise||0)!==Math.round(fresh.tax*100)||Number(order.discount_paise||0)!==Math.round(fresh.discount*100)||Number(order.security_deposit_paise)!==Math.round(fresh.securityDeposit*100)||Number(order.total_paise)!==Math.round(fresh.total*100);
      await client.query('commit');
      return stale?{code:'QUOTE_STALE'}:{code:'OK',totalPaise:Math.round(fresh.total*100),quote:fresh};
    }catch(error){try{await client.query('rollback')}catch{}finally{client.release();}throw error;}
  }

  async function createFleetReservation({vehicleIds,customerId,startAt,endAt,idempotencyKey=null}={}) {
    const reservation=await createVehicleReservation({vehicleIds,customerId,startAt,endAt,idempotencyKey});
    return reservation;
  }

  async function createFleetOrderPayment({orderId,customerId,provider,amountPaise,idempotencyKey,providerOrder}={}) {
    const normalizedAmount=Number(amountPaise);
    if(!Number.isSafeInteger(normalizedAmount)||normalizedAmount<=0)throw Object.assign(new Error('Invalid payment amount.'),{code:'PAYMENT_CREATION_FAILED'});
    if(!useDatabase){
      const order=memory.fleetOrders?.get(String(orderId));
      if(!order||String(order.customerId)!==String(customerId))throw Object.assign(new Error('Fleet booking not found.'),{code:'FLEET_ORDER_NOT_FOUND'});
      if(Math.round(Number(order.total)*100)!==normalizedAmount)throw Object.assign(new Error('Fleet booking amount changed.'),{code:'PAYMENT_CREATION_FAILED'});
      if(!memory.fleetPayments)memory.fleetPayments=new Map();
      const existing=memory.fleetPayments.get(String(orderId));
      if(existing&&['pending','paid'].includes(existing.status))return {payment:existing,created:false};
      const payment={id:crypto.randomUUID(),fleetOrderId:String(orderId),bookingId:String(order.items[0]?.id||''),customerId:String(customerId),provider,providerOrderId:String(providerOrder.id),amountPaise:normalizedAmount,currency:'INR',status:'pending',idempotencyKey:idempotencyKey||null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      memory.fleetPayments.set(String(orderId),payment);order.paymentStatus='pending';order.items.forEach(b=>{b.paymentStatus='pending'});return {payment,created:true};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const orderQ=await client.query('select id,customer_id,total_paise,payment_status from fleet_orders where id=$1 and customer_id=$2 for update',[orderId,customerId]);
      if(!orderQ.rows[0])throw Object.assign(new Error('Fleet booking not found.'),{code:'FLEET_ORDER_NOT_FOUND'});
      if(Number(orderQ.rows[0].total_paise)!==normalizedAmount)throw Object.assign(new Error('Fleet booking amount changed.'),{code:'PAYMENT_CREATION_FAILED'});
      if(['paid'].includes(String(orderQ.rows[0].payment_status)))throw Object.assign(new Error('Fleet booking is already paid.'),{code:'PAYMENT_ALREADY_PAID'});
      const first=await client.query('select booking_id from fleet_order_items where fleet_order_id=$1 order by id limit 1',[orderId]);
      if(!first.rows[0])throw Object.assign(new Error('Fleet booking has no items.'),{code:'FLEET_ORDER_INVALID'});
      const existing=await client.query(`select id,booking_id,provider,provider_order_id,provider_payment_id,provider_reference,amount_paise,currency,status,idempotency_key,created_at,updated_at from payments where booking_id=$1 and status in ('unpaid','pending') order by created_at desc limit 1 for update`,[first.rows[0].booking_id]);
      if(existing.rows[0]&&Number(existing.rows[0].amount_paise)===normalizedAmount){await client.query('update fleet_orders set payment_status=\'pending\',updated_at=now() where id=$1',[orderId]);await client.query('update bookings set payment_status=\'pending\',payment_provider_reference=$2,updated_at=now() where fleet_order_id=$1 and payment_status=\'unpaid\'',[orderId,String(providerOrder.id)]);await client.query('commit');return {payment:mapPaymentRow(existing.rows[0]),created:false};}
      const inserted=await client.query(`insert into payments(booking_id,provider,provider_order_id,amount_paise,currency,status,idempotency_key) values($1,$2,$3,$4,'INR','pending',$5) returning id,booking_id,provider,provider_order_id,amount_paise,currency,status,idempotency_key,created_at,updated_at`,[first.rows[0].booking_id,provider,String(providerOrder.id),normalizedAmount,idempotencyKey||null]);
      await client.query(`update fleet_orders set payment_status='pending',updated_at=now() where id=$1`,[orderId]);
      await client.query(`update bookings set payment_status='pending',payment_provider_reference=$2,updated_at=now() where fleet_order_id=$1 and payment_status='unpaid'`,[orderId,String(providerOrder.id)]);
      await client.query('commit');return {payment:mapPaymentRow(inserted.rows[0]),created:true};
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


  const sanitizeReviewComment = (value) => {
    if (value == null) return null;
    const normalized = String(value).replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, '').replace(/\\s+/g, ' ').trim();
    return normalized ? normalized.slice(0, 1000) : null;
  };

  const mapReview = (row) => row && ({
    id: String(row.id), bookingId: String(row.booking_id ?? row.bookingId),
    reviewerUserId: String(row.reviewer_user_id ?? row.reviewerUserId),
    revieweeUserId: String(row.reviewee_user_id ?? row.revieweeUserId),
    reviewType: row.review_type ?? row.reviewType, rating: Number(row.rating),
    comment: row.comment || null, createdAt: iso(row.created_at ?? row.createdAt), updatedAt: iso(row.updated_at ?? row.updatedAt),
    reviewerName: row.reviewType==='customer_to_vendor' || row.review_type==='customer_to_vendor' ? 'Verified customer' : 'Verified RideOn vendor', revieweeName: row.reviewee_name || row.revieweeName || null,
    vehicleId: row.vehicle_id == null ? null : String(row.vehicle_id), vehicleName: row.vehicle_name || null,
    vendorId: row.resolved_vendor_id == null ? (row.vendor_id == null ? null : String(row.vendor_id)) : String(row.resolved_vendor_id),
    vendorName: row.vendor_name || null,
  });

  const reviewSummary = (rows = []) => {
    const distribution = {1:0,2:0,3:0,4:0,5:0};
    for (const row of rows) { const rating=Number(row.rating); if (rating>=1 && rating<=5) distribution[rating] += 1; }
    const total=rows.length;
    const average=total ? Number((rows.reduce((sum,row)=>sum+Number(row.rating),0)/total).toFixed(2)) : 0;
    return {averageRating:average,totalReviewCount:total,ratingDistribution:distribution};
  };

  const reviewSelect = 'select r.*, reviewer.full_name as reviewer_name, reviewee.full_name as reviewee_name, b.vehicle_id, b.vendor_id, v.name as vehicle_name, coalesce(b.vendor_id,v.owner_id) as resolved_vendor_id, ven.business_name as vendor_name from reviews r join customers reviewer on reviewer.id=r.reviewer_user_id join customers reviewee on reviewee.id=r.reviewee_user_id join bookings b on b.id=r.booking_id join vehicles v on v.id=b.vehicle_id left join vendors ven on ven.id=coalesce(b.vendor_id,v.owner_id)';

  async function createReview({bookingId,reviewerId,reviewerRole,rating,comment}) {
    const normalizedRating=Number(rating);
    if(!Number.isInteger(normalizedRating)||normalizedRating<1||normalizedRating>5){const e=new Error('Rating must be an integer from 1 to 5.');e.code='INVALID_REVIEW_RATING';throw e;}
    const normalizedComment=sanitizeReviewComment(comment);
    if(!useDatabase){
      const booking=memory.bookings.get(String(bookingId));
      if(!booking){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(booking.status!=='completed'){const e=new Error('Reviews are available only after the booking is completed.');e.code='REVIEW_NOT_ELIGIBLE';throw e;}
      const vendor=[...(memory.vendors?.values()||[])].find(v=>String(v.id)===String(booking.vendorId));
      const vendorOwnerId=vendor?.ownerCustomerId||vendor?.owner_customer_id;
      let reviewType,revieweeId;
      if(reviewerRole==='customer'){
        if(String(booking.customerId)!==String(reviewerId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
        if(!vendorOwnerId){const e=new Error('Vendor review target is unavailable.');e.code='REVIEW_TARGET_UNAVAILABLE';throw e;}
        reviewType='customer_to_vendor';revieweeId=String(vendorOwnerId);
      }else if(reviewerRole==='vendor'){
        if(!vendor||String(vendor.ownerCustomerId||vendor.owner_customer_id)!==String(reviewerId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
        reviewType='vendor_to_customer';revieweeId=String(booking.customerId);
      }else{const e=new Error('Invalid reviewer role.');e.code='FORBIDDEN';throw e;}
      const duplicate=[...memory.reviews.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.reviewerUserId)===String(reviewerId)&&x.reviewType===reviewType);
      if(duplicate){const e=new Error('You have already reviewed this booking.');e.code='REVIEW_ALREADY_EXISTS';throw e;}
      const now=new Date().toISOString();
      const review={id:crypto.randomUUID(),bookingId:String(bookingId),reviewerUserId:String(reviewerId),revieweeUserId:revieweeId,reviewType,rating:normalizedRating,comment:normalizedComment,createdAt:now,updatedAt:now,vehicleId:String(booking.vehicleId),vehicleName:booking.vehicle?.name||null,vendorId:booking.vendorId?String(booking.vendorId):null,vendorName:vendor?.businessName||null};
      memory.reviews.set(review.id,review);return review;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const q=await client.query('select b.id,b.customer_id,b.vendor_id,b.vehicle_id,b.status,v.name as vehicle_name,v.owner_id,ven.business_name as vendor_name,ven.owner_customer_id as vendor_owner_customer_id from bookings b join vehicles v on v.id=b.vehicle_id left join vendors ven on ven.id=coalesce(b.vendor_id,v.owner_id) where b.id=$1 for update',[bookingId]);
      const b=q.rows[0];
      if(!b){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(b.status!=='completed'){const e=new Error('Reviews are available only after the booking is completed.');e.code='REVIEW_NOT_ELIGIBLE';throw e;}
      let reviewType,revieweeId;
      if(reviewerRole==='customer'){
        if(String(b.customer_id)!==String(reviewerId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
        reviewType='customer_to_vendor';revieweeId=b.vendor_owner_customer_id;
        if(!revieweeId){const e=new Error('Vendor review target is unavailable.');e.code='REVIEW_TARGET_UNAVAILABLE';throw e;}
      }else if(reviewerRole==='vendor'){
        if(!b.vendor_id){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
        const vc=await client.query('select id from vendors where id=$1 and owner_customer_id=$2',[b.vendor_id,reviewerId]);
        if(!vc.rows[0]){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
        reviewType='vendor_to_customer';revieweeId=b.customer_id;
      }else{const e=new Error('Invalid reviewer role.');e.code='FORBIDDEN';throw e;}
      try{
        const inserted=await client.query('insert into reviews(booking_id,reviewer_user_id,reviewee_user_id,review_type,rating,comment) values($1,$2,$3,$4,$5,$6) returning *',[bookingId,reviewerId,revieweeId,reviewType,normalizedRating,normalizedComment]);
        await client.query('commit');
        return mapReview({...inserted.rows[0],vehicle_id:b.vehicle_id,vehicle_name:b.vehicle_name,vendor_id:b.vendor_id||b.owner_id,resolved_vendor_id:b.vendor_id||b.owner_id,vendor_name:b.vendor_name});
      }catch(error){if(error.code==='23505'){const e=new Error('You have already reviewed this booking.');e.code='REVIEW_ALREADY_EXISTS';throw e;}throw error;}
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function getReviewStatus({bookingId,userId,role}) {
    if(!useDatabase){
      const b=memory.bookings.get(String(bookingId));
      const vendor=role==='vendor' ? [...(memory.vendors?.values()||[])].find(v=>String(v.id)===String(b?.vendorId)) : null;
      if(!b||(role==='customer'&&String(b.customerId)!==String(userId))||(role==='vendor'&&(!vendor||String(vendor.ownerCustomerId||vendor.owner_customer_id)!==String(userId)))){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const type=role==='customer'?'customer_to_vendor':'vendor_to_customer';
      const own=[...memory.reviews.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.reviewerUserId)===String(userId)&&x.reviewType===type);
      return {eligible:b.status==='completed',review:own||null,reviewType:type};
    }
    const b=role==='customer'?await getBooking(bookingId,userId):await getVendorBooking(userId,bookingId);
    if(!b){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
    const type=role==='customer'?'customer_to_vendor':'vendor_to_customer';
    const q=await pool.query(reviewSelect+' where r.booking_id=$1 and r.reviewer_user_id=$2 and r.review_type=$3 limit 1',[bookingId,userId,type]);
    return {eligible:b.status==='completed',review:q.rows[0]?mapReview(q.rows[0]):null,reviewType:type};
  }

  async function updateReview({reviewId,userId,role,rating,comment}) {
    const normalizedRating=Number(rating);
    if(!Number.isInteger(normalizedRating)||normalizedRating<1||normalizedRating>5){const e=new Error('Rating must be an integer from 1 to 5.');e.code='INVALID_REVIEW_RATING';throw e;}
    const normalizedComment=sanitizeReviewComment(comment);
    const type=role==='customer'?'customer_to_vendor':'vendor_to_customer';
    if(role==='vendor'){const e=new Error('Vendor reviews cannot be edited.');e.code='REVIEW_EDIT_NOT_ALLOWED';throw e;}
    if(!useDatabase){
      const review=memory.reviews.get(String(reviewId));
      if(!review||String(review.reviewerUserId)!==String(userId)||review.reviewType!==type){const e=new Error('Review not found.');e.code='REVIEW_NOT_FOUND';throw e;}
      if(Date.now()-new Date(review.createdAt).getTime()>30*86400000){const e=new Error('The review can no longer be edited.');e.code='REVIEW_EDIT_WINDOW_EXPIRED';throw e;}
      review.rating=normalizedRating;review.comment=normalizedComment;review.updatedAt=new Date().toISOString();return review;
    }
    const q=await pool.query('select * from reviews where id=$1 and reviewer_user_id=$2 and review_type=$3',[reviewId,userId,type]);
    const review=q.rows[0];if(!review){const e=new Error('Review not found.');e.code='REVIEW_NOT_FOUND';throw e;}
    if(Date.now()-new Date(review.created_at).getTime()>30*86400000){const e=new Error('The review can no longer be edited.');e.code='REVIEW_EDIT_WINDOW_EXPIRED';throw e;}
    const updated=await pool.query('update reviews set rating=$2,comment=$3,updated_at=now() where id=$1 returning *',[reviewId,normalizedRating,normalizedComment]);
    return mapReview(updated.rows[0]);
  }

  async function listReviews({scope,id,limit=10,offset=0}) {
    const safeLimit=Math.max(1,Math.min(50,Number(limit)||10)),safeOffset=Math.max(0,Number(offset)||0);
    if(!useDatabase){
      let rows=[...memory.reviews.values()];
      if(scope==='vehicle')rows=rows.filter(x=>String(x.vehicleId)===String(id)&&x.reviewType==='customer_to_vendor');
      else if(scope==='vendor')rows=rows.filter(x=>String(x.vendorId)===String(id)&&x.reviewType==='customer_to_vendor');
      else if(scope==='user')rows=rows.filter(x=>String(x.revieweeUserId)===String(id));
      rows.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return {summary:reviewSummary(rows),reviews:rows.slice(safeOffset,safeOffset+safeLimit)};
    }
    let filter="r.review_type='customer_to_vendor'",params=[];
    if(scope==='vehicle'){params=[id];filter+=' and b.vehicle_id=$1';}
    else if(scope==='vendor'){params=[id];filter+=' and coalesce(b.vendor_id,v.owner_id)=$1';}
    else if(scope==='user'){params=[id];filter='r.reviewee_user_id=$1';}
    const summaryRows=await pool.query('select r.rating,count(*)::int as count from reviews r join bookings b on b.id=r.booking_id join vehicles v on v.id=b.vehicle_id where '+filter+' group by r.rating order by r.rating',params);
    const counts={1:0,2:0,3:0,4:0,5:0};let total=0,weighted=0;
    for(const row of summaryRows.rows){const rating=Number(row.rating),count=Number(row.count);if(counts[rating]!==undefined){counts[rating]=count;total+=count;weighted+=rating*count;}}
    const recent=await pool.query(reviewSelect+' where '+filter+' order by r.created_at desc limit $'+(params.length+1)+' offset $'+(params.length+2),[...params,safeLimit,safeOffset]);
    return {summary:{averageRating:total?Number((weighted/total).toFixed(2)):0,totalReviewCount:total,ratingDistribution:counts},reviews:recent.rows.map(mapReview)};
  }

  async function listReviewsReceived(userId,{limit=20,offset=0}={}) {
    return listReviews({scope:'user',id:userId,limit,offset});
  }

async function listVendorCustomerReviewsForBooking({vendorId,bookingId,limit=10,offset=0}={}) {
    const safeLimit=Math.max(1,Math.min(10,Number(limit)||10)),safeOffset=Math.max(0,Number(offset)||0);
    if(!useDatabase){
      const booking=await getVendorBooking(vendorId,bookingId);
      if(!booking){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const rows=[...memory.reviews.values()]
        .filter(x=>String(x.bookingId)===String(bookingId)&&x.reviewType==='customer_to_vendor')
        .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return {summary:reviewSummary(rows),reviews:rows.slice(safeOffset,safeOffset+safeLimit)};
    }
    const booking=await getVendorBooking(vendorId,bookingId);
    if(!booking){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
    const params=[bookingId];
    const filter="r.booking_id=$1 and r.review_type='customer_to_vendor'";
    const summaryRows=await pool.query('select r.rating,count(*)::int as count from reviews r where '+filter+' group by r.rating order by r.rating',params);
    const counts={1:0,2:0,3:0,4:0,5:0};let total=0,weighted=0;
    for(const row of summaryRows.rows){const rating=Number(row.rating),count=Number(row.count);if(counts[rating]!==undefined){counts[rating]=count;total+=count;weighted+=rating*count;}}
    const recent=await pool.query(reviewSelect+' where '+filter+' order by r.created_at desc limit $2 offset $3',[bookingId,safeLimit,safeOffset]);
    return {summary:{averageRating:total?Number((weighted/total).toFixed(2)):0,totalReviewCount:total,ratingDistribution:counts},reviews:recent.rows.map(mapReview)};
  }

  const SUPPORT_CATEGORIES = new Set(['Payment','Refund','Security Deposit','Booking','Vehicle','Delivery','Pickup/Return','Damage','Cancellation','Account','Technical Issue','Other']);
  const SUPPORT_PRIORITIES = new Set(['low','normal','high','urgent']);
  const SUPPORT_STATUSES = new Set(['open','in_progress','waiting_for_user','resolved','closed']);
  const SUPPORT_ROLES = new Set(['support','admin']);

  const sanitizeSupportText = (value, max) => String(value ?? '')
    .replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, max);

  const supportError = (message, code) => { const e = new Error(message); e.code = code; return e; };

  const mapSupportTicket = (row, includePrivate = false) => {
    if (!row) return null;
    return {
      id: String(row.id),
      ticketNumber: row.ticket_number,
      bookingId: row.booking_id ? String(row.booking_id) : null,
      raisedByUserId: row.raised_by_user_id ? String(row.raised_by_user_id) : null,
      raisedByRole: row.raised_by_role || row.raisedByRole || null,
      raisedByName: row.raised_by_name || null,
      assignedToUserId: row.assigned_to_user_id ? String(row.assigned_to_user_id) : null,
      assignedToName: row.assigned_to_name || null,
      category: row.category,
      subject: row.subject,
      description: row.description,
      priority: row.priority,
      status: row.status,
      resolution: row.resolution || null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      resolvedAt: iso(row.resolved_at),
      booking: row.booking_id ? {
        id: String(row.booking_id),
        vehicleId: row.vehicle_id ? String(row.vehicle_id) : null,
        vehicleName: row.vehicle_name || null,
        startAt: iso(row.start_at),
        endAt: iso(row.end_at),
        status: row.booking_status || null,
        delivery: row.delivery_required == null ? null : Boolean(row.delivery_required),
        address: row.delivery_address || null,
      } : null,
      ...(includePrivate ? { internalMessageCount: Number(row.internal_message_count || 0) } : {}),
    };
  };

  const supportTicketSelect = `
    select t.*,
           raised.full_name as raised_by_name,
           raised.role as raised_by_role,
           assigned.full_name as assigned_to_name,
           b.vehicle_id,
           b.start_at,
           b.end_at,
           b.status as booking_status,
           b.delivery_required,
           b.delivery_address,
           v.name as vehicle_name,
           (select count(*) from ticket_messages tm where tm.ticket_id=t.id and tm.is_internal=true) as internal_message_count
    from support_tickets t
    join customers raised on raised.id=t.raised_by_user_id
    left join customers assigned on assigned.id=t.assigned_to_user_id
    left join bookings b on b.id=t.booking_id
    left join vehicles v on v.id=b.vehicle_id
  `;

  function validateSupportInput({ category, subject, description, priority = 'normal' }) {
    if (!SUPPORT_CATEGORIES.has(category)) throw supportError('Unsupported support category.', 'INVALID_SUPPORT_CATEGORY');
    if (!SUPPORT_PRIORITIES.has(priority)) throw supportError('Unsupported support priority.', 'INVALID_SUPPORT_PRIORITY');
    const normalizedSubject = sanitizeSupportText(subject, 160);
    const normalizedDescription = sanitizeSupportText(description, 5000);
    if (normalizedSubject.length < 3) throw supportError('Subject must be at least 3 characters.', 'INVALID_SUPPORT_SUBJECT');
    if (normalizedDescription.length < 10) throw supportError('Please describe the issue in at least 10 characters.', 'INVALID_SUPPORT_DESCRIPTION');
    return { category, priority, subject: normalizedSubject, description: normalizedDescription };
  }

  const canTransitionSupportStatus = (from, to) => {
    if (!SUPPORT_STATUSES.has(to)) return false;
    if (from === to) return true;
    const allowed = {
      open: new Set(['in_progress','waiting_for_user','resolved','closed']),
      in_progress: new Set(['open','waiting_for_user','resolved','closed']),
      waiting_for_user: new Set(['open','in_progress','resolved','closed']),
      resolved: new Set(['open','closed']),
      closed: new Set(['open']),
    };
    return Boolean(allowed[from]?.has(to));
  };

  async function getSupportBookingForUser(bookingId, userId, role) {
    if (!bookingId) return null;
    if (role === 'customer') {
      const booking = await getBooking(bookingId, userId);
      if (!booking) throw supportError('Booking not found.', 'BOOKING_NOT_FOUND');
      return booking;
    }
    if (role === 'vendor') {
      const vendor = await findVendorByCustomerId(userId);
      if (!vendor) throw supportError('Vendor profile not found.', 'VENDOR_NOT_FOUND');
      const booking = await getVendorBooking(vendor.id, bookingId);
      if (!booking) throw supportError('Booking not found.', 'BOOKING_NOT_FOUND');
      return booking;
    }
    if (SUPPORT_ROLES.has(role)) {
      if (!useDatabase) return memory.bookings.get(String(bookingId)) || null;
      const booking = await pool.query('select id from bookings where id=$1', [bookingId]);
      if (!booking.rows[0]) throw supportError('Booking not found.', 'BOOKING_NOT_FOUND');
      return booking.rows[0];
    }
    throw supportError('You do not have access to this booking.', 'FORBIDDEN');
  }

  async function createSupportTicket({ bookingId = null, raisedByUserId, raisedByRole, category, subject, description, priority = 'normal', idempotencyKey = null }) {
    if (!['customer','vendor'].includes(raisedByRole)) throw supportError('Support tickets can only be raised by customers or vendors.', 'FORBIDDEN');
    const input = validateSupportInput({ category, subject, description, priority });
    const key = idempotencyKey ? String(idempotencyKey).trim() : null;
    if (key && (key.length < 8 || key.length > 128)) throw supportError('Invalid support request key.', 'INVALID_IDEMPOTENCY_KEY');

    if (bookingId) await getSupportBookingForUser(bookingId, raisedByUserId, raisedByRole);

    if (!useDatabase) {
      const existing = key ? [...memory.supportTickets.values()].find(t => String(t.raisedByUserId) === String(raisedByUserId) && t.idempotencyKey === key) : null;
      if (existing) return { ticket: existing, idempotentReplay: true };
      const now = new Date().toISOString();
      const ticket = {
        id: crypto.randomUUID(),
        ticketNumber: `RID-${now.slice(0,10).replace(/-/g,'')}-${String(memory.supportTickets.size + 1).padStart(6,'0')}`,
        bookingId: bookingId ? String(bookingId) : null,
        raisedByUserId: String(raisedByUserId),
        raisedByRole,
        assignedToUserId: null,
        category: input.category,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        status: 'open',
        resolution: null,
        idempotencyKey: key,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      };
      memory.supportTickets.set(ticket.id, ticket);
      return { ticket, idempotentReplay: false };
    }

    if (key) {
      const existing = await pool.query(supportTicketSelect + ' where t.raised_by_user_id=$1 and t.idempotency_key=$2 limit 1', [raisedByUserId, key]);
      if (existing.rows[0]) return { ticket: mapSupportTicket(existing.rows[0]), idempotentReplay: true };
    }
    try {
      const inserted = await pool.query(
        'insert into support_tickets(booking_id,raised_by_user_id,category,subject,description,priority,idempotency_key) values($1,$2,$3,$4,$5,$6,$7) returning id',
        [bookingId, raisedByUserId, input.category, input.subject, input.description, input.priority, key]
      );
      const loaded = await pool.query(supportTicketSelect + ' where t.id=$1', [inserted.rows[0].id]);
      return { ticket: mapSupportTicket(loaded.rows[0]), idempotentReplay: false };
    } catch (error) {
      if (error.code === '23505' && key) {
        const existing = await pool.query(supportTicketSelect + ' where t.raised_by_user_id=$1 and t.idempotency_key=$2 limit 1', [raisedByUserId, key]);
        if (existing.rows[0]) return { ticket: mapSupportTicket(existing.rows[0]), idempotentReplay: true };
      }
      throw error;
    }
  }

  async function listMySupportTickets({ userId, role, status, category, limit = 20, offset = 0 }) {
    if (!['customer','vendor'].includes(role)) throw supportError('You do not have access to support tickets.', 'FORBIDDEN');
    const safeLimit=Math.max(1,Math.min(50,Number(limit)||20));
    const safeOffset=Math.max(0,Number(offset)||0);
    if (!useDatabase) {
      let rows=[...memory.supportTickets.values()].filter(t=>String(t.raisedByUserId)===String(userId));
      if(status){if(!SUPPORT_STATUSES.has(status))throw supportError('Unsupported support status.','INVALID_SUPPORT_STATUS');rows=rows.filter(t=>t.status===status);}
      if(category){if(!SUPPORT_CATEGORIES.has(category))throw supportError('Unsupported support category.','INVALID_SUPPORT_CATEGORY');rows=rows.filter(t=>t.category===category);}
      rows.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
      return {tickets:rows.slice(safeOffset,safeOffset+safeLimit),pagination:{limit:safeLimit,offset:safeOffset,count:rows.length}};
    }
    const clauses=['t.raised_by_user_id=$1'],params=[userId];
    if(status){if(!SUPPORT_STATUSES.has(status))throw supportError('Unsupported support status.','INVALID_SUPPORT_STATUS');params.push(status);clauses.push('t.status=$'+params.length);}
    if(category){if(!SUPPORT_CATEGORIES.has(category))throw supportError('Unsupported support category.','INVALID_SUPPORT_CATEGORY');params.push(category);clauses.push('t.category=$'+params.length);}
    params.push(safeLimit,safeOffset);
    const q=await pool.query(supportTicketSelect+' where '+clauses.join(' and ')+' order by t.updated_at desc limit $'+(params.length-1)+' offset $'+params.length,params);
    return {tickets:q.rows.map(row=>mapSupportTicket(row)),pagination:{limit:safeLimit,offset:safeOffset,count:q.rows.length}};
  }

  async function getSupportTicket({ ticketId, userId, role }) {
    if (!useDatabase) {
      const ticket=memory.supportTickets.get(String(ticketId));
      if (!ticket) return null;
      if (!SUPPORT_ROLES.has(role) && String(ticket.raisedByUserId)!==String(userId)) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
      return ticket;
    }
    const q=await pool.query(supportTicketSelect+' where t.id=$1 limit 1',[ticketId]);
    const ticket=q.rows[0];
    if (!ticket) return null;
    if (!SUPPORT_ROLES.has(role) && String(ticket.raised_by_user_id)!==String(userId)) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    return mapSupportTicket(ticket, SUPPORT_ROLES.has(role));
  }

  async function listSupportMessages({ ticketId, userId, role }) {
    const ticket=await getSupportTicket({ticketId,userId,role});
    if (!ticket) return null;
    if (!useDatabase) {
      return [...memory.supportMessages.values()]
        .filter(m=>String(m.ticketId)===String(ticketId) && (SUPPORT_ROLES.has(role) || !m.isInternal))
        .sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    }
    const q=await pool.query(
      'select tm.id,tm.ticket_id,tm.sender_user_id,tm.message,tm.is_internal,tm.created_at,c.full_name as sender_name,c.role as sender_role from ticket_messages tm join customers c on c.id=tm.sender_user_id where tm.ticket_id=$1 '+(SUPPORT_ROLES.has(role)?'':'and tm.is_internal=false')+' order by tm.created_at asc',
      [ticketId]
    );
    return q.rows.map(row=>({id:String(row.id),ticketId:String(row.ticket_id),senderUserId:String(row.sender_user_id),senderName:SUPPORT_ROLES.has(role)?row.sender_name:(String(row.sender_user_id)===String(userId)?'You':(row.sender_role==='vendor'?'RideOn vendor':'RideOn support')),senderRole:row.sender_role,message:row.message,isInternal:Boolean(row.is_internal),createdAt:iso(row.created_at)}));
  }

  async function addSupportMessage({ ticketId, userId, role, message, isInternal = false }) {
    const normalized=sanitizeSupportText(message,5000);
    if (!normalized) throw supportError('Please enter a message.', 'INVALID_SUPPORT_MESSAGE');
    if (normalized.length > 5000) throw supportError('Message is too long.', 'INVALID_SUPPORT_MESSAGE');
    if (isInternal && !SUPPORT_ROLES.has(role)) throw supportError('Internal responses are restricted to support staff.', 'FORBIDDEN');

    const ticket=await getSupportTicket({ticketId,userId,role});
    if (!ticket) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    if (ticket.status === 'closed' && !SUPPORT_ROLES.has(role)) throw supportError('Reopen the ticket before replying.', 'SUPPORT_TICKET_CLOSED');

    if (!useDatabase) {
      const msg={id:crypto.randomUUID(),ticketId:String(ticketId),senderUserId:String(userId),senderRole:role,message:normalized,isInternal:Boolean(isInternal),createdAt:new Date().toISOString()};
      memory.supportMessages.set(msg.id,msg);
      if (!SUPPORT_ROLES.has(role) && ticket.status==='waiting_for_user') ticket.status='open';
      ticket.updatedAt=msg.createdAt;
      return msg;
    }

    const client=await pool.connect();
    try {
      await client.query('begin');
      const locked=await client.query('select id,status from support_tickets where id=$1 for update',[ticketId]);
      if (!locked.rows[0]) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
      if (locked.rows[0].status==='closed' && !SUPPORT_ROLES.has(role)) throw supportError('Reopen the ticket before replying.', 'SUPPORT_TICKET_CLOSED');
      const inserted=await client.query('insert into ticket_messages(ticket_id,sender_user_id,message,is_internal) values($1,$2,$3,$4) returning id,ticket_id,sender_user_id,message,is_internal,created_at',[ticketId,userId,normalized,Boolean(isInternal)]);
      const nextStatus=!SUPPORT_ROLES.has(role) && locked.rows[0].status==='waiting_for_user' ? 'open' : locked.rows[0].status;
      await client.query('update support_tickets set status=$2,updated_at=now() where id=$1',[ticketId,nextStatus]);
      await client.query('commit');
      const row=inserted.rows[0];
      return {id:String(row.id),ticketId:String(row.ticket_id),senderUserId:String(row.sender_user_id),senderName:'You',senderRole:role,message:row.message,isInternal:Boolean(row.is_internal),createdAt:iso(row.created_at)};
    } catch(error){try{await client.query('rollback')}catch{};throw error;} finally{client.release();}
  }

  async function updateSupportTicketStatus({ ticketId, userId, role, status, resolution = null }) {
    if (!SUPPORT_STATUSES.has(status)) throw supportError('Unsupported support status.', 'INVALID_SUPPORT_STATUS');
    const ticket=await getSupportTicket({ticketId,userId,role});
    if (!ticket) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    if (!SUPPORT_ROLES.has(role)) throw supportError('Support staff access is required.', 'FORBIDDEN');
    if (!canTransitionSupportStatus(ticket.status,status)) throw supportError('That ticket status transition is not allowed.', 'INVALID_SUPPORT_TRANSITION');
    const normalizedResolution=resolution==null?null:sanitizeSupportText(resolution,5000);
    if (status==='resolved' && (!normalizedResolution || normalizedResolution.length<3)) throw supportError('A resolution is required before resolving a ticket.', 'RESOLUTION_REQUIRED');
    if (!useDatabase) {
      ticket.status=status;ticket.resolution=normalizedResolution;ticket.updatedAt=new Date().toISOString();ticket.resolvedAt=['resolved','closed'].includes(status)?ticket.updatedAt:null;
      return ticket;
    }
    const q=await pool.query('update support_tickets set status=$2,resolution=$3,resolved_at=case when $2 in (\'resolved\',\'closed\') then coalesce(resolved_at,now()) else null end,updated_at=now() where id=$1 returning id',[ticketId,status,normalizedResolution]);
    const loaded=await pool.query(supportTicketSelect+' where t.id=$1',[q.rows[0].id]);
    return mapSupportTicket(loaded.rows[0],true);
  }

  async function closeSupportTicket({ticketId,userId,role}) {
    const ticket=await getSupportTicket({ticketId,userId,role});
    if (!ticket) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    if (SUPPORT_ROLES.has(role)) return updateSupportTicketStatus({ticketId,userId,role,status:'closed',resolution:ticket.resolution||'Closed by support.'});
    if (ticket.status==='closed') return ticket;
    if (!['open','in_progress','waiting_for_user','resolved'].includes(ticket.status)) throw supportError('This ticket cannot be closed right now.', 'INVALID_SUPPORT_TRANSITION');
    if (!useDatabase) { ticket.status='closed';ticket.resolvedAt=new Date().toISOString();ticket.updatedAt=ticket.resolvedAt;return ticket; }
    const q=await pool.query('update support_tickets set status=\'closed\',resolved_at=coalesce(resolved_at,now()),updated_at=now() where id=$1 returning id',[ticketId]);
    const loaded=await pool.query(supportTicketSelect+' where t.id=$1',[q.rows[0].id]);
    return mapSupportTicket(loaded.rows[0]);
  }

  async function reopenSupportTicket({ticketId,userId,role}) {
    const ticket=await getSupportTicket({ticketId,userId,role});
    if (!ticket) throw supportError('Ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    if (!['closed','resolved'].includes(ticket.status)) throw supportError('Only resolved or closed tickets can be reopened.', 'INVALID_SUPPORT_TRANSITION');
    if (!useDatabase) { ticket.status='open';ticket.resolution=null;ticket.resolvedAt=null;ticket.updatedAt=new Date().toISOString();return ticket; }
    const q=await pool.query('update support_tickets set status=\'open\',resolution=null,resolved_at=null,updated_at=now() where id=$1 returning id',[ticketId]);
    const loaded=await pool.query(supportTicketSelect+' where t.id=$1',[q.rows[0].id]);
    return mapSupportTicket(loaded.rows[0]);
  }

  async function listSupportTickets({ userId, status, category, priority, limit=50, offset=0 }) {
    const actor=await findCustomerById(userId);
    if(!SUPPORT_ROLES.has(actor?.role)) throw supportError('Support staff access is required.','FORBIDDEN');
    const safeLimit=Math.max(1,Math.min(100,Number(limit)||50)),safeOffset=Math.max(0,Number(offset)||0);
    if(!useDatabase){
      let rows=[...memory.supportTickets.values()];
      if(status){if(!SUPPORT_STATUSES.has(status))throw supportError('Unsupported support status.','INVALID_SUPPORT_STATUS');rows=rows.filter(t=>t.status===status);}
      if(category){if(!SUPPORT_CATEGORIES.has(category))throw supportError('Unsupported support category.','INVALID_SUPPORT_CATEGORY');rows=rows.filter(t=>t.category===category);}
      if(priority){if(!SUPPORT_PRIORITIES.has(priority))throw supportError('Unsupported support priority.','INVALID_SUPPORT_PRIORITY');rows=rows.filter(t=>t.priority===priority);}
      rows.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
      return {tickets:rows.slice(safeOffset,safeOffset+safeLimit),pagination:{limit:safeLimit,offset:safeOffset,count:rows.length}};
    }
    const clauses=['1=1'],params=[];
    if(status){if(!SUPPORT_STATUSES.has(status))throw supportError('Unsupported support status.','INVALID_SUPPORT_STATUS');params.push(status);clauses.push('t.status=$'+params.length);}
    if(category){if(!SUPPORT_CATEGORIES.has(category))throw supportError('Unsupported support category.','INVALID_SUPPORT_CATEGORY');params.push(category);clauses.push('t.category=$'+params.length);}
    if(priority){if(!SUPPORT_PRIORITIES.has(priority))throw supportError('Unsupported support priority.','INVALID_SUPPORT_PRIORITY');params.push(priority);clauses.push('t.priority=$'+params.length);}
    params.push(safeLimit,safeOffset);
    const q=await pool.query(supportTicketSelect+' where '+clauses.join(' and ')+' order by t.updated_at desc limit $'+(params.length-1)+' offset $'+params.length,params);
    return {tickets:q.rows.map(r=>mapSupportTicket(r,true)),pagination:{limit:safeLimit,offset:safeOffset,count:q.rows.length}};
  }

  async function assignSupportTicket({ticketId,assignedToUserId,actorUserId}) {
    const actor=await findCustomerById(actorUserId);
    if (!SUPPORT_ROLES.has(actor?.role)) throw supportError('Support staff access is required.', 'FORBIDDEN');
    const assignee=await findCustomerById(assignedToUserId);
    if (!SUPPORT_ROLES.has(assignee?.role)) throw supportError('Tickets can only be assigned to support staff.', 'INVALID_ASSIGNEE');
    const ticket=await getSupportTicket({ticketId,userId:actorUserId,role:actor.role});
    if(!ticket)throw supportError('Ticket not found.','SUPPORT_TICKET_NOT_FOUND');
    if(!useDatabase){ticket.assignedToUserId=String(assignedToUserId);ticket.updatedAt=new Date().toISOString();return ticket;}
    const q=await pool.query('update support_tickets set assigned_to_user_id=$2,updated_at=now() where id=$1 returning id',[ticketId,assignedToUserId]);
    if(!q.rows[0])throw supportError('Ticket not found.','SUPPORT_TICKET_NOT_FOUND');
    const loaded=await pool.query(supportTicketSelect+' where t.id=$1',[ticketId]);
    return mapSupportTicket(loaded.rows[0],true);
  }

  async function resolveSupportTicket({ticketId,userId,resolution}) {
    const actor=await findCustomerById(userId);
    if (!SUPPORT_ROLES.has(actor?.role)) throw supportError('Support staff access is required.', 'FORBIDDEN');
    return updateSupportTicketStatus({ticketId,userId,role:actor.role,status:'resolved',resolution});
  }

  async function seedMemoryVehicles(items = []) { if (useDatabase) return; for (const item of items) memory.vehicles.set(String(item.id), item); }

  return {markOverdueRentals,getFleetBookingOperations,transitionRentalLifecycle,getRentalBookingForCustomer,prepareVehicleHandover,requestRentalReturn,recordRentalReturn,listRideOnFleetAdmin,getRideOnFleetDashboard,createRideOnFleetVehicle,updateRideOnFleetVehicle,setRideOnFleetVehicleState,recordFleetMaintenance,recordFleetInspection,assignFleetDeliveryStaff,listAssignedDeliveryJobs,health,close,getCancellationPreview,listVehicles,listLocations,getVehicle,createCustomer,createOrLinkCustomerFromSupabase,findCustomerBySupabaseUserId,findCustomerByPhone,findCustomerByEmail,findCustomerById,findVendorByCustomerId,ensureVendorForCustomer,updateVendor,updateVendorServiceLocation,getVendorServiceLocation,listMarketplaceVendors,getPublicVendorProfile,listPublicVendorVehicles,quoteMultiVehicle,createFleetOrder,loadFleetOrderTx,getFleetOrder,listCustomerFleetOrders,listVendorVehicles,getVendorVehicle,createVendorVehicle,updateVendorVehicle,deactivateVendorVehicle,listVendorBookings,listVendorFleetOrders,updateFleetOrderStatus,getVendorBooking,updateVendorBookingStatus,checkVehicleAvailability,getVehicleState,isVehicleUnavailable,createBooking,getBooking,updateBookingRouteData,startDelivery,updateDeliveryLocation,getActiveTrackingSession,updateTrackingRoute,getTrackingForCustomer,completeDelivery,abortDelivery,listCustomerBookings,cancelBooking,markPaymentRefundPending,claimRefundRequest,markRefundRetryable,completePaymentRefund,applyPaymentEvent,withPaymentLock,findPaymentById,findPaymentByProviderOrder,findPaymentByBooking,createOrGetPaymentOrder,createFleetOrderPayment,submitPaymentReference,verifyPayment,refundPayment,createOtp,consumeLatestOtp,incrementOtpAttempt,recordSecurityDepositInspection,seedMemoryVehicles,createSupportTicket,listMySupportTickets,getSupportTicket,listSupportMessages,addSupportMessage,closeSupportTicket,reopenSupportTicket,listSupportTickets,assignSupportTicket,updateSupportTicketStatus,resolveSupportTicket,createVehicleReservation,releaseVehicleReservation,getAuthoritativeBookingPrice,recalculateFleetOrderPricing,createFleetReservation};
}
