import crypto from 'node:crypto';
import pg from 'pg';
import { calculateCancellation } from './lifecycle.js';

const { Pool } = pg;

const iso = (value) => value instanceof Date ? value.toISOString() : value;

export function createRepository({ databaseUrl, fleet }) {
  const useDatabase = Boolean(databaseUrl);
  const pool = useDatabase ? new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  }) : null;
  const memory = { customers:new Map(), bookings:new Map(), idempotency:new Map(), paymentEvents:new Map(), payments:new Map(), financialTransactions:new Map(), vendors:new Map(), vehicles:new Map(), securityDeposits:new Map(),trackingSessions:new Map(),reviews:new Map(),supportTickets:new Map(),supportMessages:new Map(),kycVerifications:new Map(),kycBlacklist:new Map() };

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

  const mapCustomer = (row) => row && ({ id:String(row.id), fullName:row.full_name ?? row.fullName, phone:row.phone, email:row.email || undefined, role:row.role || 'customer', supabaseUserId:row.supabase_user_id || row.supabaseUserId || undefined, kycStatus:row.kyc_status || row.kycStatus || 'UNVERIFIED', activeKycId:row.active_kyc_id ? String(row.active_kyc_id) : (row.activeKycId ? String(row.activeKycId) : null) });
  const mapBooking = (row) => {
    if (!row) return null;
    const vehicle = row.vehicle || fleet.find((v) => v.id === row.vehicle_id);
    const startAt = iso(row.start_at ?? row.startAt);
    const endAt = iso(row.end_at ?? row.endAt);
    return {
      id:String(row.id),
      customerId:String(row.customer_id ?? row.customerId),
      vehicleId:String(row.vehicle_id ?? row.vehicleId),
      vehicle:vehicle ? { id:vehicle.id, name:vehicle.name, type:vehicle.type, imageUrls:Array.isArray(vehicle.image_urls)?vehicle.image_urls:[] } : undefined,
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
      securityDepositStatus:row.security_deposit_status || undefined,
      securityDepositRefundable:Number(row.security_deposit_refundable_paise || 0) / 100,
      securityDepositDeduction:Number(row.security_deposit_deduction_paise || 0) / 100,
      securityDepositReason:row.security_deposit_reason || undefined,
      securityDepositEvidence:row.security_deposit_evidence || undefined,
      securityDepositRefundReference:row.security_deposit_refund_reference || undefined,
      securityDepositInspectedAt:iso(row.security_deposit_inspected_at),
      securityDepositInspectedBy:row.security_deposit_inspected_by ? String(row.security_deposit_inspected_by) : undefined,
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
      lifecycleState:row.lifecycle_state || null,
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
      const cityValue = city?.trim().toLowerCase();
      const qValue = q?.trim().toLowerCase();
      return [...fleet, ...memory.vehicles.values()].filter((v) =>
        v.active !== false &&
        (!typeValue || typeValue === 'all' || String(v.type).toLowerCase() === typeValue) &&
        (!cityValue || String(v.city || '').trim().toLowerCase() === cityValue) &&
        (!qValue || `${v.name || ''} ${v.subtitle || ''} ${v.make || ''} ${v.model || ''}`.toLowerCase().includes(qValue))
      );
    }

    // Public marketplace inventory is intentionally city-agnostic. A vendor's
    // primary service_city does not restrict the marketplace. Each vehicle's
    // own city is the source of truth for customer search/filtering.
    //
    // Keep the base query limited to columns guaranteed by the original
    // vehicles schema. Optional vendor metadata must never turn a valid
    // inventory row into a 503.
    const params = [];
    const where = ['active = true'];

    if (type && type.toLowerCase() !== 'all') {
      params.push(type.toLowerCase());
      where.push(`type = $${params.length}`);
    }
    if (city?.trim()) {
      params.push(city.trim());
      where.push(`lower(trim(city)) = lower(trim($${params.length}))`);
    }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      where.push(`(
        coalesce(name, '') ilike $${params.length}::text
        or coalesce(make, '') ilike $${params.length}::text
        or coalesce(model, '') ilike $${params.length}::text
      )`);
    }

    const baseSql = `
      select id, type, name, make, model, year, city,
             daily_rate_paise, security_deposit_paise, active,
             transmission, fuel, seats
      from vehicles
      where ${where.join(' and ')}
      order by name asc
    `;

    let rows;
    try {
      ({ rows } = await pool.query(baseSql, params));
    } catch (primaryError) {
      // Schema drift can leave optional columns unavailable in an older
      // production database. Retry with only the immutable core catalogue
      // columns; city filtering must still work.
      console.error(JSON.stringify({
        level: 'error',
        event: 'vehicles_primary_query_failed',
        message: primaryError?.message || 'Vehicle query failed',
        code: primaryError?.code || null,
      }));

      const coreSql = `
        select id, type, name, make, model, year, city,
               daily_rate_paise, security_deposit_paise, active
        from vehicles
        where ${where.join(' and ')}
        order by name asc
      `;

      try {
        ({ rows } = await pool.query(coreSql, params));
        rows = rows.map(row => ({
          ...row,
          transmission: null,
          fuel: null,
          seats: null,
        }));
      } catch (fallbackError) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'vehicles_core_query_failed',
          message: fallbackError?.message || 'Core vehicle query failed',
          code: fallbackError?.code || null,
        }));
        throw fallbackError;
      }
    }

    let optionalById = new Map();
    try {
      const ids = rows.map(row => String(row.id)).filter(Boolean);
      if (ids.length) {
        const optional = await pool.query(
          `select id, description, image_urls, delivery_available, owner_id
           from vehicles where id::text = any($1::text[])`,
          [ids]
        );
        optionalById = new Map(optional.rows.map(row => [String(row.id), row]));
      }
    } catch (optionalError) {
      console.warn(JSON.stringify({level:'warn',event:'vehicle_optional_metadata_unavailable',message:optionalError?.message||'Vehicle metadata unavailable',code:optionalError?.code||null}));
    }

    // Enrich active vehicles with vendor service-location data. Missing location
    // must never hide a valid vehicle from the marketplace.
    let vendorByVehicleId = new Map();
    try {
      const ids = rows.map(row => String(row.id)).filter(Boolean);
      if (ids.length) {
        const optional = await pool.query(
          `select ve.id, ve.owner_id, v.id as vendor_id, v.business_name, v.service_city,
                  v.service_address, v.service_latitude, v.service_longitude
           from vehicles ve
           left join vendors v on v.id=ve.owner_id
           where ve.id::text = any($1::text[])`,
          [ids]
        );
        vendorByVehicleId = new Map(optional.rows.map(row => [String(row.id), row]));
      }
    } catch (vendorError) {
      console.warn(JSON.stringify({
        level:'warn',
        event:'vehicle_vendor_location_unavailable',
        message:vendorError?.message || 'Vendor location enrichment failed',
        code:vendorError?.code || null,
      }));
    }

    return rows.map((row) => {
      const extra = optionalById.get(String(row.id)) || {};
      const vendor = vendorByVehicleId.get(String(row.id)) || {};
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
        description: extra.description || '',
        imageUrls: Array.isArray(extra.image_urls) ? extra.image_urls : [],
        deliveryAvailable: extra.delivery_available !== false,
        ownerId: extra.owner_id ? String(extra.owner_id) : null,
        vendorId: vendor.vendor_id ? String(vendor.vendor_id) : null,
        vendorName: vendor.business_name || null,
        vendorServiceLocation: vendor.service_latitude != null && vendor.service_longitude != null ? {
          latitude:Number(vendor.service_latitude),
          longitude:Number(vendor.service_longitude),
          address:vendor.service_address || null,
          city:vendor.service_city || row.city || null,
        } : null,
        seats: row.seats == null ? null : Number(row.seats),
        transmission: row.transmission || null,
        fuel: row.fuel || null,
        active: Boolean(row.active),
      };
    });
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
    serviceLatitude: row.service_latitude == null ? null : Number(row.service_latitude),
    serviceLongitude: row.service_longitude == null ? null : Number(row.service_longitude),
    serviceAddress: row.service_address || null,
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

  async function quoteMultiVehicle({customerId,vendorId,vehicleIds,startAt,endAt,delivery=true,address='',deliveryLatitude=null,deliveryLongitude=null}={}) {
    void customerId;
    const ids=[...new Set((vehicleIds||[]).map(v=>String(v).trim()).filter(Boolean))];
    if(ids.length<2||ids.length>10){const e=new Error('Select between 2 and 10 vehicles.');e.code='INVALID_MULTI_CART';throw e;}
    const start=new Date(startAt),end=new Date(endAt);
    if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start||start.getTime()<Date.now()){const e=new Error('Pickup and return must form a valid booking window.');e.code='INVALID_BOOKING_WINDOW';throw e;}
    const days=Math.ceil((end-start)/86400000);
    if(days<1||days>30){const e=new Error('Booking duration must be between 1 and 30 days.');e.code='INVALID_BOOKING_WINDOW';throw e;}
    const lat=delivery&&deliveryLatitude!=null&&deliveryLatitude!==''?Number(deliveryLatitude):null;
    const lon=delivery&&deliveryLongitude!=null&&deliveryLongitude!==''?Number(deliveryLongitude):null;
    if(delivery && ((lat==null)!==(lon==null)||lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90)||lon!=null&&(!Number.isFinite(lon)||lon<-180||lon>180))){const e=new Error('A valid delivery location is required.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    const vehicles=useDatabase?(await pool.query(`select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,description,image_urls,delivery_available,active from vehicles where owner_id=$1 and active=true and id::text = any($2::text[])`,[vendorId,ids])).rows.map(mapManagedVehicle):[...memory.vehicles.values()].filter(v=>String(v.ownerId)===String(vendorId)&&v.active!==false&&ids.includes(String(v.id)));
    if(vehicles.length!==ids.length){const e=new Error('One or more selected vehicles do not belong to this vendor or are unavailable.');e.code='MULTI_VEHICLE_ACCESS_DENIED';throw e;}
    const availability=await Promise.all(vehicles.map(v=>checkVehicleAvailability(v.id,start.toISOString(),end.toISOString())));
    const unavailable=availability.filter(x=>!x.available).map(x=>String(x.vehicleId));
    if(unavailable.length){const e=new Error('One or more selected vehicles became unavailable.');e.code='MULTI_VEHICLE_UNAVAILABLE';e.vehicleIds=unavailable;throw e;}
    const items=vehicles.map(vehicle=>{const rental=Number(vehicle.pricePerDay||0)*days;const deliveryFee=delivery?199:0;const platformFee=Math.round(rental*0.05);const securityDeposit=Number(vehicle.securityDeposit||0);return {vehicleId:String(vehicle.id),vehicleName:vehicle.name,rental,deliveryFee,platformFee,securityDeposit,total:rental+deliveryFee+platformFee+securityDeposit,currency:'INR'};});
    const rentalSubtotal=items.reduce((a,x)=>a+x.rental,0),deliveryFee=items.reduce((a,x)=>a+x.deliveryFee,0),platformFee=items.reduce((a,x)=>a+x.platformFee,0),securityDeposit=items.reduce((a,x)=>a+x.securityDeposit,0);
    return {vendorId:String(vendorId),vehicleIds:ids,startAt:start.toISOString(),endAt:end.toISOString(),delivery:Boolean(delivery),address:String(address||'').trim().slice(0,300),deliveryLatitude:lat,deliveryLongitude:lon,items,rentalSubtotal,deliveryFee,platformFee,securityDeposit,total:rentalSubtotal+deliveryFee+platformFee+securityDeposit,currency:'INR',quoteExpiresAt:new Date(Date.now()+5*60*1000).toISOString()};
  }

  async function createFleetOrder({customerId,vendorId,vehicleIds,startAt,endAt,delivery=true,address='',deliveryLatitude=null,deliveryLongitude=null,idempotencyKey=null}={}) {
    const kyc = await getKycStatus(customerId);
    if (!kyc || kyc.status !== 'VERIFIED') throw Object.assign(new Error('KYC verification is required before fleet checkout.'), { code:'KYC_REQUIRED' });
    const normalizedKey=idempotencyKey?String(idempotencyKey).trim():null;
    if(!useDatabase){
      if(!memory.fleetOrders)memory.fleetOrders=new Map();
      if(!memory.fleetOrderIdempotency)memory.fleetOrderIdempotency=new Map();
      if(normalizedKey){const existing=memory.fleetOrderIdempotency.get(String(customerId)+':'+normalizedKey);if(existing)return existing;}
      const quote=await quoteMultiVehicle({customerId,vendorId,vehicleIds,startAt,endAt,delivery,address,deliveryLatitude,deliveryLongitude});
      const stagedBookings=[];
      const bookingIdempotencyKeys=[];
      const now=new Date().toISOString();
      for(const item of quote.items){
        const vehicle=[...memory.vehicles.values()].find(v=>String(v.id)===String(item.vehicleId));
        if(!vehicle)throw Object.assign(new Error('Vehicle not found.'),{code:'VEHICLE_NOT_FOUND'});
        const overlap=[...memory.bookings.values()].some(b=>String(b.vehicleId)===String(item.vehicleId)&&['requested','confirmed','in_progress'].includes(b.status)&&new Date(quote.startAt)<new Date(b.endAt)&&new Date(quote.endAt)>new Date(b.startAt));
        if(overlap)throw Object.assign(new Error('One or more selected vehicles became unavailable.'),{code:'MULTI_VEHICLE_UNAVAILABLE',vehicleIds:[String(item.vehicleId)]});
        const bookingId=crypto.randomUUID();
        const booking={id:bookingId,customerId:String(customerId),vehicleId:String(vehicle.id),vehicle,vendorId:String(vendorId),startAt:quote.startAt,endAt:quote.endAt,delivery:Boolean(delivery),address:quote.address,deliveryLatitude:quote.deliveryLatitude,deliveryLongitude:quote.deliveryLongitude,vendorServiceLatitude:vehicle.vendorServiceLocation?.latitude??null,vendorServiceLongitude:vehicle.vendorServiceLocation?.longitude??null,routeDistanceMeters:null,routeDurationSeconds:null,routeProvider:null,notes:null,pricing:{days:Math.ceil((new Date(quote.endAt)-new Date(quote.startAt))/86400000),rental:item.rental,deliveryFee:item.deliveryFee,platformFee:item.platformFee,securityDeposit:item.securityDeposit,total:item.total,currency:'INR'},status:'requested',paymentStatus:'unpaid',deliveryStatus:'scheduled',createdAt:now,updatedAt:now};
        stagedBookings.push(booking);
        bookingIdempotencyKeys.push(String(customerId)+':fleet:'+String(normalizedKey||bookingId)+':'+String(item.vehicleId));
      }
      const order={id:crypto.randomUUID(),customerId:String(customerId),vendorId:String(vendorId),vendorName:(quote.vendorName||null),startAt:quote.startAt,endAt:quote.endAt,delivery:quote.delivery,address:quote.address,items:stagedBookings,rentalSubtotal:quote.rentalSubtotal,deliveryFee:quote.deliveryFee,platformFee:quote.platformFee,securityDeposit:quote.securityDeposit,total:quote.total,paymentStatus:'unpaid',status:'requested',idempotencyKey:normalizedKey,quoteExpiresAt:quote.quoteExpiresAt,createdAt:now,updatedAt:now};
      for(const b of stagedBookings){
        memory.bookings.set(String(b.id),b);
        if(Number(b.pricing.securityDeposit||0)>0)memory.securityDeposits.set(String(b.id),{bookingId:String(b.id),customerId:String(customerId),vendorId:String(vendorId),originalAmount:Number(b.pricing.securityDeposit),refundableAmount:Number(b.pricing.securityDeposit),approvedDeduction:0,status:'pending'});
      }
      memory.fleetOrders.set(String(order.id),order);
      if(normalizedKey)memory.fleetOrderIdempotency.set(String(customerId)+':'+normalizedKey,order);
      return order;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      if(normalizedKey){const idem=await client.query('select id from fleet_orders where customer_id=$1 and idempotency_key=$2 for update',[customerId,normalizedKey]);if(idem.rows[0]){const order=await loadFleetOrderTx(client,idem.rows[0].id);await client.query('commit');return order;}}
      const vendor=await client.query(`select id from vendors where id=$1 and status='active' for update`,[vendorId]);
      if(!vendor.rows[0])throw Object.assign(new Error('Vendor not found.'),{code:'VENDOR_NOT_FOUND'});
      const ids=[...new Set((vehicleIds||[]).map(v=>String(v).trim()).filter(Boolean))];
      if(ids.length<2||ids.length>10)throw Object.assign(new Error('Select between 2 and 10 vehicles.'),{code:'INVALID_MULTI_CART'});
      const start=new Date(startAt),end=new Date(endAt),days=Math.ceil((end-start)/86400000);
      if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start||start.getTime()<Date.now()||days<1||days>30)throw Object.assign(new Error('Invalid booking window.'),{code:'INVALID_BOOKING_WINDOW'});
      const locked=await client.query(`select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,description,image_urls,delivery_available,active from vehicles where owner_id=$1 and active=true and id::text=any($2::text[]) for update`,[vendorId,ids]);
      if(locked.rows.length!==ids.length)throw Object.assign(new Error('One or more selected vehicles do not belong to this vendor or are unavailable.'),{code:'MULTI_VEHICLE_ACCESS_DENIED'});
      const conflict=await client.query(`select distinct v.id from vehicles v join bookings b on b.vehicle_id=v.id where v.owner_id=$1 and v.id::text=any($2::text[]) and b.status in ('requested','confirmed','in_progress') and b.start_at<$4 and b.end_at>$3`,[vendorId,ids,start.toISOString(),end.toISOString()]);
      if(conflict.rows.length)throw Object.assign(new Error('One or more selected vehicles became unavailable.'),{code:'MULTI_VEHICLE_UNAVAILABLE',vehicleIds:conflict.rows.map(x=>String(x.id))});
      const lat=delivery&&deliveryLatitude!=null&&deliveryLatitude!==''?Number(deliveryLatitude):null,lon=delivery&&deliveryLongitude!=null&&deliveryLongitude!==''?Number(deliveryLongitude):null;
      if(delivery && ((lat==null)!==(lon==null)||lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90)||lon!=null&&(!Number.isFinite(lon)||lon<-180||lon>180)))throw Object.assign(new Error('A valid delivery location is required.'),{code:'INVALID_DELIVERY_LOCATION'});
      const quoteRows=locked.rows.map(row=>{const vehicle=mapManagedVehicle(row);const rental=vehicle.dailyRate*days,deliveryFee=delivery?199:0,platformFee=Math.round(rental*0.05),securityDeposit=vehicle.securityDeposit;return {vehicle,vehicleId:String(vehicle.id),rental,deliveryFee,platformFee,securityDeposit,total:rental+deliveryFee+platformFee+securityDeposit};});
      const parts={rental:quoteRows.reduce((a,x)=>a+x.rental,0),deliveryFee:quoteRows.reduce((a,x)=>a+x.deliveryFee,0),platformFee:quoteRows.reduce((a,x)=>a+x.platformFee,0),securityDeposit:quoteRows.reduce((a,x)=>a+x.securityDeposit,0)};const total=parts.rental+parts.deliveryFee+parts.platformFee+parts.securityDeposit;
      const orderResult=await client.query(`insert into fleet_orders(customer_id,vendor_id,start_at,end_at,delivery_required,delivery_address,rental_total_paise,delivery_fee_paise,platform_fee_paise,security_deposit_paise,total_paise,payment_status,status,idempotency_key,quote_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'unpaid','requested',$12,$13) returning id`,[customerId,vendorId,start.toISOString(),end.toISOString(),Boolean(delivery),String(address||'').trim().slice(0,300),Math.round(parts.rental*100),Math.round(parts.deliveryFee*100),Math.round(parts.platformFee*100),Math.round(parts.securityDeposit*100),Math.round(total*100),normalizedKey,new Date(Date.now()+5*60*1000)]);
      const orderId=String(orderResult.rows[0].id),created=[];
      for(const item of quoteRows){
        const b=await client.query(`insert into bookings(customer_id,vehicle_id,vendor_id,fleet_order_id,start_at,end_at,delivery_required,delivery_address,delivery_latitude,delivery_longitude,vendor_service_latitude,vendor_service_longitude,delivery_fee_paise,rental_total_paise,platform_fee_paise,security_deposit_paise,total_paise,status,payment_status,delivery_status,customer_notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(select service_latitude from vendors where id=$3),(select service_longitude from vendors where id=$3),$11,$12,$13,$14,$15,'requested','unpaid','scheduled',null) returning *`,[customerId,item.vehicle.id,vendorId,orderId,start.toISOString(),end.toISOString(),Boolean(delivery),String(address||'').trim().slice(0,300),delivery?lat:null,delivery?lon:null,Math.round(item.deliveryFee*100),Math.round(item.rental*100),Math.round(item.platformFee*100),Math.round(item.securityDeposit*100),Math.round(item.total*100)]);
        const booking=mapBooking({...b.rows[0],vehicle:item.vehicle});created.push(booking);
        if(item.securityDeposit>0)await client.query(`insert into security_deposits(booking_id,customer_id,vendor_id,original_amount_paise,refundable_amount_paise,status) values($1,$2,$3,$4,$4,'pending') on conflict(booking_id) do nothing`,[booking.id,customerId,vendorId,Math.round(item.securityDeposit*100)]);
        await client.query(`insert into booking_status_events(booking_id,next_status,actor_type,actor_id) values($1,'requested','customer',$2)`,[booking.id,customerId]);
      }
      await client.query(`insert into fleet_order_items(fleet_order_id,booking_id,vehicle_id,line_rental_total_paise,line_delivery_fee_paise,line_platform_fee_paise,line_security_deposit_paise,line_total_paise) select $1,id,vehicle_id,rental_total_paise,delivery_fee_paise,platform_fee_paise,security_deposit_paieS,total_paise from bookings where fleet_order_id=$1`,[orderId]);
      await client.query('commit');
      return {id:orderId,customerId:String(customerId),vendorId:String(vendorId),startAt:start.toISOString(),endAt:end.toISOString(),delivery:Boolean(delivery),address:String(address||'').trim(),items:created,rentalSubtotal:parts.rental,deliveryFee:parts.deliveryFee,platformFee:parts.platformFee,securityDeposit:parts.securityDeposit,total,paymentStatus:'unpaid',status:'requested',quoteExpiresAt:new Date(Date.now()+5*60*1000).toISOString()};
    }catch(error){try{await client.query('rollback')}catch{};if(error.code==='23P01')error.code='MULTI_VEHICLE_UNAVAILABLE';throw error;}finally{client.release();}
  }

  async function loadFleetOrderTx(client,orderId){
    const {rows}=await client.query(`select fo.*,v.business_name from fleet_orders fo join vendors v on v.id=fo.vendor_id where fo.id=$1 for update`,[orderId]);
    if(!rows[0])return null;
    const itemRows=await client.query(`select b.*,ve.name as v_name,ve.type as v_type,ve.make,ve.model,ve.image_urls,ve.description,ve.delivery_available from fleet_order_items i join bookings b on b.id=i.booking_id join vehicles ve on ve.id=i.vehicle_id where i.fleet_order_id=$1 order by i.id`,[orderId]);
    const items=itemRows.rows.map(r=>mapBooking({...r,vehicle:{id:String(r.vehicle_id),name:r.v_name,type:String(r.v_type),make:r.make,model:r.model,imageUrls:r.image_urls||[],description:r.description||'',deliveryAvailable:r.delivery_available!==false}}));
    return {id:String(rows[0].id),customerId:String(rows[0].customer_id),vendorId:String(rows[0].vendor_id),vendorName:rows[0].business_name,startAt:iso(rows[0].start_at),endAt:iso(rows[0].end_at),delivery:Boolean(rows[0].delivery_required),address:rows[0].delivery_address,rentalSubtotal:Number(rows[0].rental_total_paise)/100,deliveryFee:Number(rows[0].delivery_fee_paise)/100,platformFee:Number(rows[0].platform_fee_paise)/100,securityDeposit:Number(rows[0].security_deposit_paise)/100,total:Number(rows[0].total_paise)/100,paymentStatus:rows[0].payment_status,status:rows[0].status,idempotencyKey:rows[0].idempotency_key||null,quoteExpiresAt:iso(rows[0].quote_expires_at),items};
  }
  async function getFleetOrder(fleetOrderId, customerId) {
    if(!useDatabase){
      const order=memory.fleetOrders?.get(String(fleetOrderId));
      return order && String(order.customerId)===String(customerId) ? order : null;
    }
    const client=await pool.connect();
    try {
      const order=await loadFleetOrderTx(client,fleetOrderId);
      return order && String(order.customerId)===String(customerId) ? order : null;
    } finally { client.release(); }
  }

  async function listCustomerFleetOrders(customerId,{limit=20,offset=0}={}) {
    const safeLimit=Math.max(1,Math.min(50,Number(limit)||20)),safeOffset=Math.max(0,Number(offset)||0);
    if(!useDatabase){
      const rows=[...(memory.fleetOrders?.values()||[])].filter(o=>String(o.customerId)===String(customerId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return rows.slice(safeOffset,safeOffset+safeLimit);
    }
    const client=await pool.connect();
    try {
      const q=await client.query('select id from fleet_orders where customer_id=$1 order by created_at desc limit $2 offset $3',[customerId,safeLimit,safeOffset]);
      const orders=[];
      for(const row of q.rows){ const order=await loadFleetOrderTx(client,row.id); if(order) orders.push(order); }
      return orders;
    } finally { client.release(); }
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
       returning id,owner_customer_id,business_name,contact_name,phone,email,address,support_phone,support_email,status,service_city,service_area,service_latitude,service_longitude,service_address,created_at,updated_at`,
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
      `select b.*, v.name as v_name, v.type as v_type, sd.status as security_deposit_status, sd.refundable_amount_paise as security_deposit_refundable_paise, sd.approved_deduction_paise as security_deposit_deduction_paise, sd.deduction_reason as security_deposit_reason, sd.evidence_reference as security_deposit_evidence, sd.refund_provider_reference as security_deposit_refund_reference, sd.inspected_at as security_deposit_inspected_at, sd.inspected_by as security_deposit_inspected_by
       from bookings b join vehicles v on v.id=b.vehicle_id left join security_deposits sd on sd.booking_id=b.id
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
      `select b.*, v.name as v_name, v.type as v_type, sd.status as security_deposit_status, sd.refundable_amount_paise as security_deposit_refundable_paise, sd.approved_deduction_paise as security_deposit_deduction_paise
       from bookings b join vehicles v on v.id=b.vehicle_id left join security_deposits sd on sd.booking_id=b.id
       where b.id=$1 and v.owner_id=$2`,
      [bookingId,vendorId]
    );
    if (!rows[0]) return null;
    return mapBooking({...rows[0],vehicle:{id:String(rows[0].vehicle_id),name:rows[0].v_name,type:String(rows[0].v_type)}});
  }

  async function listVendorFleetOrders(vendorId,{limit=20,offset=0}={}) {
    const safeLimit=Math.max(1,Math.min(50,Number(limit)||20)),safeOffset=Math.max(0,Number(offset)||0);
    if(!useDatabase){
      const rows=[...(memory.fleetOrders?.values()||[])].filter(o=>String(o.vendorId)===String(vendorId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return rows.slice(safeOffset,safeOffset+safeLimit);
    }
    const q=await pool.query('select id from fleet_orders where vendor_id=$1 order by created_at desc limit $2 offset $3',[vendorId,safeLimit,safeOffset]);
    const client=await pool.connect(); try { const orders=[]; for(const row of q.rows){const order=await loadFleetOrderTx(client,row.id);if(order)orders.push(order);} return orders; } finally { client.release(); }
  }

  async function updateFleetOrderStatus(vendorId,orderId,nextStatus,note='') {
    const allowed={requested:['confirmed','rejected'],confirmed:['in_progress','cancelled'],in_progress:['completed']};
    if(!allowed[nextStatus]){const e=new Error('Invalid booking status.');e.code='INVALID_BOOKING_STATUS';throw e;}
    if(nextStatus==='rejected'&&!String(note||'').trim()){const e=new Error('A rejection reason is required.');e.code='REJECTION_REASON_REQUIRED';throw e;}
    if(!useDatabase){
      const order=memory.fleetOrders?.get(String(orderId));
      if(!order||String(order.vendorId)!==String(vendorId))throw Object.assign(new Error('Booking not found.'),{code:'BOOKING_NOT_FOUND'});
      if(!order.items.length||order.items.some(b=>!allowed[String(b.status)]?.includes(nextStatus)))throw Object.assign(new Error('Booking cannot move to that status.'),{code:'INVALID_BOOKING_TRANSITION'});
      if(nextStatus==='confirmed'&&order.items.some(b=>!['paid','held','settlement_pending','settled'].includes(String(b.paymentStatus))))throw Object.assign(new Error('Payment must be confirmed before this booking can be accepted.'),{code:'PAYMENT_REQUIRED_FOR_ACCEPTANCE'});
      if(nextStatus==='completed'&&order.items.some(b=>b.delivery&&b.deliveryStatus!=='delivered'))throw Object.assign(new Error('Delivery must be completed before the rental can be completed.'),{code:'DELIVERY_NOT_COMPLETED'});
      order.items.forEach(b=>{b.status=nextStatus;if(nextStatus==='rejected'){b.cancellationReason=String(note).trim();}b.updatedAt=new Date().toISOString();});
      order.status=nextStatus;if(nextStatus==='rejected')order.paymentStatus='refund_pending';if(nextStatus==='confirmed')order.paymentStatus='paid';order.updatedAt=new Date().toISOString();return order;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const oq=await client.query('select * from fleet_orders where id=$1 and vendor_id=$2 for update',[orderId,vendorId]);
      if(!oq.rows[0])throw Object.assign(new Error('Booking not found.'),{code:'BOOKING_NOT_FOUND'});
      const items=await client.query('select b.*,v.owner_id from bookings b join vehicles v on v.id=b.vehicle_id where b.fleet_order_id=$1 and v.owner_id=$2 for update',[orderId,vendorId]);
      if(!items.rows.length||items.rows.some(b=>!allowed[String(b.status)]?.includes(nextStatus)))throw Object.assign(new Error('Booking cannot move to that status.'),{code:'INVALID_BOOKING_TRANSITION'});
      if(nextStatus==='confirmed'&&items.rows.some(b=>!['paid','held','settlement_pending','settled'].includes(String(b.payment_status))))throw Object.assign(new Error('Payment must be confirmed before this booking can be accepted.'),{code:'PAYMENT_REQUIRED_FOR_ACCEPTANCE'});
      if(nextStatus==='completed'&&items.rows.some(b=>b.delivery_required&&b.delivery_status!=='delivered'))throw Object.assign(new Error('Delivery must be completed before the rental can be completed.'),{code:'DELIVERY_NOT_COMPLETED'});
      const shouldRefund=nextStatus==='rejected'&&items.rows.some(b=>['paid','held','settlement_pending','settled'].includes(String(b.payment_status)));
      await client.query('update fleet_orders set status=$2,payment_status=case when $2=\'rejected\' and $3 then \'refund_pending\' when $2=\'confirmed\' then \'paid\' else payment_status end,updated_at=now() where id=$1',[orderId,nextStatus,shouldRefund]);
      await client.query('update bookings set status=$2,cancellation_reason=case when $2=\'rejected\' then $3 else cancellation_reason end,cancelled_at=case when $2=\'rejected\' then now() else cancelled_at end,payment_status=case when $2=\'rejected\' and payment_status in (\'paid\',\'held\',\'settlement_pending\',\'settled\') then \'refund_pending\' when $2=\'confirmed\' then \'paid\' else payment_status end,updated_at=now() where fleet_order_id=$1',[orderId,nextStatus,String(note||'').trim()||null]);
      if(shouldRefund){await client.query("update payments set status='refund_pending',updated_at=now() where booking_id=(select booking_id from fleet_order_items where fleet_order_id=$1 order by id limit 1) and status in ('paid','held','settlement_pending','settled')",[orderId]);await client.query("update security_deposits set status='refund_pending',updated_at=now() where booking_id in (select booking_id from fleet_order_items where fleet_order_id=$1) and status in ('held','review_required','refund_pending')",[orderId]);}
      await client.query('commit');
      return await loadFleetOrderTx(client,orderId);
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function updateVendorBookingStatus(vendorId, bookingId, nextStatus, note=''){
    const allowed = {
      requested: ['confirmed','rejected'],
      confirmed: ['in_progress','cancelled'],
      in_progress: ['completed'],
      rejected: [],
      completed: [],
      cancelled: [],
    };
    if (!allowed[nextStatus]) { const e=new Error('invalid status'); e.code='INVALID_BOOKING_STATUS'; throw e; }
    if (nextStatus==='rejected' && !String(note||'').trim()) { const e=new Error('A rejection reason is required.'); e.code='REJECTION_REASON_REQUIRED'; throw e; }
    if (!useDatabase) {
      const b=await getVendorBooking(vendorId,bookingId);
      if(!b){const e=new Error('booking not found');e.code='BOOKING_NOT_FOUND';throw e;}
      if(!allowed[b.status]?.includes(nextStatus)){const e=new Error('invalid transition');e.code='INVALID_BOOKING_TRANSITION';throw e;}
      if(nextStatus==='completed' && b.delivery && b.deliveryStatus!=='delivered'){const e=new Error('Delivery must be completed before the rental can be completed.');e.code='DELIVERY_NOT_COMPLETED';throw e;}
      if(nextStatus==='confirmed' && !['paid','held','settlement_pending','settled'].includes(String(b.paymentStatus))){
        const e=new Error('Payment must be confirmed before the vendor can accept this booking.');e.code='PAYMENT_REQUIRED_FOR_ACCEPTANCE';throw e;
      }
      b.status=nextStatus;
      if(nextStatus==='rejected'){b.cancellationReason=String(note).trim(); if(['paid','held','settlement_pending','settled'].includes(String(b.paymentStatus))) b.paymentStatus='refund_pending';}
      if(nextStatus==='completed' && Number(b.pricing?.securityDeposit||0)>0){
        memory.securityDeposits.set(String(b.id),{bookingId:String(b.id),customerId:b.customerId,vendorId,originalAmount:Number(b.pricing.securityDeposit),refundableAmount:Number(b.pricing.securityDeposit),approvedDeduction:0,status:'review_required'});
      }
      b.updatedAt=new Date().toISOString();
      return b;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select b.*, v.name as v_name, v.type as v_type, v.owner_id from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1 and v.owner_id=$2 for update',[bookingId,vendorId]);
      if(!rows[0]){await client.query('rollback');const e=new Error('booking not found');e.code='BOOKING_NOT_FOUND';throw e;}
      const current=rows[0].status;
      if(!allowed[current]?.includes(nextStatus)){await client.query('rollback');const e=new Error('invalid transition');e.code='INVALID_BOOKING_TRANSITION';throw e;}
      if(nextStatus==='rejected' && !String(note||'').trim()){await client.query('rollback');const e=new Error('rejection reason required');e.code='REJECTION_REASON_REQUIRED';throw e;}
      if(nextStatus==='confirmed' && !['paid','held','settlement_pending','settled'].includes(String(rows[0].payment_status))){
        await client.query('rollback');const e=new Error('Payment must be confirmed before the vendor can accept this booking.');e.code='PAYMENT_REQUIRED_FOR_ACCEPTANCE';throw e;
      }
      const shouldRefund=['paid','held','settlement_pending','settled'].includes(String(rows[0].payment_status));
      const nextPaymentStatus=nextStatus==='rejected'&&shouldRefund?'refund_pending':rows[0].payment_status;
      const cancellationReason=nextStatus==='rejected'?String(note).trim():rows[0].cancellation_reason||null;
      const {rows:updated}=await client.query("update bookings set status=$2,payment_status=$3,cancellation_reason=$4,cancelled_at=case when $2='rejected' then now() else cancelled_at end,updated_at=now() where id=$1 returning *",[bookingId,nextStatus,nextPaymentStatus,cancellationReason]);
      if(nextPaymentStatus==='refund_pending') {
        await client.query("update payments set status='refund_pending',updated_at=now() where booking_id=$1 and status in ('paid','held','settlement_pending','settled')",[bookingId]);
        await client.query("update security_deposits set status='refund_pending',updated_at=now() where booking_id=$1 and status in ('held','review_required','refund_pending')",[bookingId]);
      }
      if(nextStatus==='completed' && rows[0].delivery_required && rows[0].delivery_status!=='delivered'){await client.query('rollback');const e=new Error('Delivery must be completed before the rental can be completed.');e.code='DELIVERY_NOT_COMPLETED';throw e;}
      if(nextStatus==='completed' && Number(rows[0].security_deposit_paise||0)>0){
        await client.query(`insert into security_deposits(booking_id,customer_id,vendor_id,original_amount_paise,refundable_amount_paise,status)
          values($1,$2,$3,$4,$4,'review_required')
          on conflict (booking_id) do update set status='review_required',updated_at=now()`,[bookingId,rows[0].customer_id,vendorId,Number(rows[0].security_deposit_paise)]);
      }
      await client.query('insert into booking_status_events(booking_id,previous_status,next_status,actor_type,actor_id,note) values($1,$2,$3,\'vendor\',$4,$5)',[bookingId,current,nextStatus,vendorId,note||null]);
      await client.query('commit');
      return mapBooking({...updated[0],vehicle:{id:String(updated[0].vehicle_id),name:rows[0].v_name,type:String(rows[0].v_type)}});
    } catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function settleFleetSecurityDeposit({bookingId,actorUserId,deductionPaise=0,reason='',evidenceReference='',refundProviderReference='' } = {}) {
    const deduction = Math.max(0, Math.round(Number(deductionPaise) || 0));
    if (!useDatabase) {
      const booking = memory.bookings.get(String(bookingId));
      if (!booking) { const e=new Error('Booking not found.'); e.code='BOOKING_NOT_FOUND'; throw e; }
      const deposit = memory.securityDeposits.get(String(bookingId));
      if (!deposit) { const e=new Error('Security deposit record not found.'); e.code='DEPOSIT_NOT_FOUND'; throw e; }
      const original = Math.round(Number(deposit.originalAmount || booking.pricing?.securityDeposit || 0) * 100);
      if (deduction > original) { const e=new Error('Deposit deduction exceeds the collected deposit.'); e.code='DEPOSIT_DEDUCTION_INVALID'; throw e; }
      if (deduction > 0 && !String(reason).trim()) { const e=new Error('A deduction reason is required.'); e.code='DEPOSIT_DEDUCTION_DOCUMENTATION_REQUIRED'; throw e; }
      if (deduction > 0 && !String(evidenceReference).trim()) { const e=new Error('Evidence/reference is required for a deduction.'); e.code='DEPOSIT_DEDUCTION_DOCUMENTATION_REQUIRED'; throw e; }
      const refundable = original - deduction;
      if (refundable > 0 && !String(refundProviderReference).trim()) { const e=new Error('A provider refund reference is required.'); e.code='REFUND_PROVIDER_REFERENCE_REQUIRED'; throw e; }
      deposit.approvedDeduction = deduction / 100;
      deposit.refundableAmount = refundable / 100;
      deposit.deductionReason = String(reason || '').trim() || undefined;
      deposit.evidenceReference = String(evidenceReference || '').trim() || undefined;
      deposit.status = refundable > 0 ? 'refunded' : 'deducted';
      deposit.refundProviderReference = String(refundProviderReference || '').trim() || undefined;
      deposit.inspectedAt = new Date().toISOString();
      deposit.inspectedBy = actorUserId || undefined;
      return { booking, deposit: { status: deposit.status, originalAmountPaise: original, approvedDeductionPaise: deduction, refundableAmountPaise: refundable, refundProviderReference: deposit.refundProviderReference } };
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const q = await client.query(`select b.*, sd.status as sd_status, sd.original_amount_paise, sd.refundable_amount_paise
        from bookings b left join security_deposits sd on sd.booking_id=b.id
        where b.id=$1 for update`, [bookingId]);
      if (!q.rows[0]) { const e=new Error('Booking not found.'); e.code='BOOKING_NOT_FOUND'; throw e; }
      const b=q.rows[0];
      if (!['RETURNED','INSPECTION','COMPLETED'].includes(String(b.lifecycle_state || '').toUpperCase()) && String(b.status)!=='completed') {
        const e=new Error('Vehicle must be returned and inspected before deposit settlement.'); e.code='DEPOSIT_SETTLEMENT_NOT_ALLOWED'; throw e;
      }
      if (!q.rows[0].original_amount_paise && !Number(b.security_deposit_paise || 0)) {
        const e=new Error('No security deposit is due for this booking.'); e.code='DEPOSIT_NOT_FOUND'; throw e;
      }
      const original=Number(q.rows[0].original_amount_paise || b.security_deposit_paise || 0);
      if (deduction > original) { const e=new Error('Deposit deduction exceeds the collected deposit.'); e.code='DEPOSIT_DEDUCTION_INVALID'; throw e; }
      if (deduction > 0 && !String(reason).trim()) { const e=new Error('A deduction reason is required.'); e.code='DEPOSIT_DEDUCTION_DOCUMENTATION_REQUIRED'; throw e; }
      if (deduction > 0 && !String(evidenceReference).trim()) { const e=new Error('Evidence/reference is required for a deduction.'); e.code='DEPOSIT_DEDUCTION_DOCUMENTATION_REQUIRED'; throw e; }
      const refundable=original-deduction;
      if (refundable > 0 && !String(refundProviderReference).trim()) { const e=new Error('A provider refund reference is required.'); e.code='REFUND_PROVIDER_REFERENCE_REQUIRED'; throw e; }
      if (['refunded','deducted'].includes(String(q.rows[0].sd_status))) { const e=new Error('Security deposit has already been settled.'); e.code='DEPOSIT_ALREADY_SETTLED'; throw e; }
      const status=refundable>0?'refunded':'deducted';
      await client.query(`insert into security_deposits
        (booking_id,customer_id,vendor_id,original_amount_paise,refundable_amount_paise,approved_deduction_paise,status,deduction_reason,evidence_reference,provider,refund_provider_reference,inspected_at,inspected_by,refunded_at)
        values($1,$2,(select vendor_id from bookings where id=$1),$3,$4,$5,$6,$7,$8,null,$9,now(),$10,${refundable>0?'now()':'null'})
        on conflict (booking_id) do update set refundable_amount_paise=excluded.refundable_amount_paise,approved_deduction_paise=excluded.approved_deduction_paise,status=excluded.status,deduction_reason=excluded.deduction_reason,evidence_reference=excluded.evidence_reference,refund_provider_reference=excluded.refund_provider_reference,inspected_at=excluded.inspected_at,inspected_by=excluded.inspected_by,refunded_at=excluded.refunded_at,updated_at=now()`,
        [bookingId,b.customer_id,original,refundable,deduction,status,String(reason||'').trim()||null,String(evidenceReference||'').trim()||null,String(refundProviderReference||'').trim()||null,actorUserId || null]);
      await client.query('insert into booking_status_events(booking_id,previous_status,next_status,actor_type,actor_id,note) values($1,$2,$2,\'fleet_ops\',$3,$4)',[bookingId,b.status,actorUserId || null,refundable>0?'security_deposit_refunded':'security_deposit_deducted']);
      await client.query('commit');
      return { booking: mapBooking({...b,security_deposit_refundable_paise:refundable,security_deposit_deduction_paise:deduction,security_deposit_status:status,security_deposit_reason:String(reason||'').trim()||undefined,security_deposit_evidence:String(evidenceReference||'').trim()||undefined,security_deposit_refund_reference:String(refundProviderReference||'').trim()||undefined,security_deposit_inspected_at:new Date().toISOString(),security_deposit_inspected_by:actorUserId}), deposit:{status,originalAmountPaise:original,approvedDeductionPaise:deduction,refundableAmountPaise:refundable,refundProviderReference:String(refundProviderReference||'').trim()||undefined} };
    } catch(error) { try{await client.query('rollback')}catch{}; throw error; } finally { client.release(); }
  }

  async function recordSecurityDepositInspection(vendorId, bookingId, {deductionPaise=0, reason='', evidenceReference='', refundProviderReference=''} = {}) {
    const deduction = Math.max(0, Math.round(Number(deductionPaise)||0));
    if (!useDatabase) {
      const b=await getVendorBooking(vendorId,bookingId);
      if(!b){const e=new Error('booking not found');e.code='BOOKING_NOT_FOUND';throw e;}
      if(String(b.status)!=='completed'){const e=new Error('Vehicle must be returned before deposit inspection.');e.code='DEPOSIT_INSPECTION_NOT_ALLOWED';throw e;}
      const deposit=memory.securityDeposits.get(String(bookingId));
      const original=Math.round(Number(deposit?.originalAmount ?? b.pricing?.securityDeposit ?? 0)*100);
      if(deduction>original){const e=new Error('Deposit deduction exceeds the collected deposit.');e.code='DEPOSIT_DEDUCTION_INVALID';throw e;}
      if(deduction>0&&!String(reason).trim()){const e=new Error('A deduction reason is required.');e.code='DEPOSIT_DEDUCTION_REASON_REQUIRED';throw e;}
      if(deduction>0&&!String(evidenceReference).trim()){const e=new Error('Evidence/reference is required for a deduction.');e.code='DEPOSIT_EVIDENCE_REQUIRED';throw e;}
      const refundablePaise=original-deduction;
      if(deposit){deposit.approvedDeduction=deduction/100;deposit.refundableAmount=refundablePaise/100;deposit.deductionReason=String(reason||'').trim()||undefined;deposit.evidenceReference=String(evidenceReference||'').trim()||undefined;deposit.status=deduction>0?'deducted':'refund_pending';deposit.refundProviderReference=String(refundProviderReference||'').trim()||undefined;}
      return {booking:b,deposit:{status:deduction>0?'deducted':'refund_pending',originalAmountPaise:original,approvedDeductionPaise:deduction,refundableAmountPaise:refundablePaise}};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const q=await client.query('select b.*,sd.status as sd_status,sd.original_amount_paise,sd.refundable_amount_paise,sd.approved_deduction_paise from bookings b join vehicles v on v.id=b.vehicle_id left join security_deposits sd on sd.booking_id=b.id where b.id=$1 and v.owner_id=$2 for update',[bookingId,vendorId]);
      if(!q.rows[0]){const e=new Error('booking not found');e.code='BOOKING_NOT_FOUND';throw e;}
      const b=q.rows[0];
      if(String(b.status)!=='completed'){const e=new Error('Vehicle must be returned before deposit inspection.');e.code='DEPOSIT_INSPECTION_NOT_ALLOWED';throw e;}
      const original=Number(b.sd_status ? b.original_amount_paise : b.security_deposit_paise||0);
      if(deduction>original){const e=new Error('Deposit deduction exceeds the collected deposit.');e.code='DEPOSIT_DEDUCTION_INVALID';throw e;}
      if(deduction>0&&!String(reason).trim()){const e=new Error('A deduction reason is required.');e.code='DEPOSIT_DEDUCTION_REASON_REQUIRED';throw e;}
      if(deduction>0&&!String(evidenceReference).trim()){const e=new Error('Evidence/reference is required for a deduction.');e.code='DEPOSIT_EVIDENCE_REQUIRED';throw e;}
      const refundable=original-deduction;
      if(b.original_amount_paise==null){
        await client.query(`insert into security_deposits(booking_id,customer_id,vendor_id,original_amount_paise,refundable_amount_paise,approved_deduction_paise,status,deduction_reason,evidence_reference,provider)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,null)
          on conflict (booking_id) do update set refundable_amount_paise=$5,approved_deduction_paise=$6,status=$7,deduction_reason=$8,evidence_reference=$9,updated_at=now()`,[bookingId,b.customer_id,vendorId,original,refundable,deduction,deduction>0?'deducted':'refund_pending',String(reason||'').trim()||null,String(evidenceReference||'').trim()||null]);
      }else{
        await client.query("update security_deposits set refundable_amount_paise=$2,approved_deduction_paise=$3,status=$4,deduction_reason=$5,evidence_reference=$6,inspected_at=now(),inspected_by=$7,updated_at=now() where booking_id=$1",[bookingId,refundable,deduction,deduction>0?'deducted':'refund_pending',String(reason||'').trim()||null,String(evidenceReference||'').trim()||null,vendorId]);
      }
      await client.query('insert into booking_status_events(booking_id,previous_status,next_status,actor_type,actor_id,note) values($1,$2,$2,\'vendor\',$3,$4)',[bookingId,b.status,vendorId,deduction>0?'security_deposit_deduction':'security_deposit_release']);
      await client.query('commit');
      return {booking:mapBooking({...b,security_deposit_refundable_paise:refundable,security_deposit_deduction_paise:deduction,security_deposit_status:deduction>0?'deducted':'refund_pending',security_deposit_reason:String(reason||'').trim()||undefined,security_deposit_evidence:String(evidenceReference||'').trim()||undefined,security_deposit_inspected_at:new Date().toISOString(),security_deposit_inspected_by:vendorId}),deposit:{status:deduction>0?'deducted':'refund_pending',originalAmountPaise:original,approvedDeductionPaise:deduction,refundableAmountPaise:refundable}};
    }catch(error){try{await client.query('rollback')}catch{}finally{client.release();}throw error;}
  }


  async function createOrLinkCustomerFromSupabase({supabaseUserId,email,fullName,phone,role='customer'}) {
    if (!['customer','vendor','delivery_staff','support','admin'].includes(role)) { const e=new Error('Invalid RideOn account type.'); e.code='INVALID_ROLE'; throw e; }

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
    const kyc = await getKycStatus(input.customerId);
    if (!kyc || kyc.status !== 'VERIFIED') throw Object.assign(new Error('KYC verification is required before booking.'), { code:'KYC_REQUIRED' });
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
        let serviceLocation=null;
        if(vehicleCheck.rows[0].owner_id){
          const locationResult=await client.query('select service_latitude,service_longitude,service_address from vendors where id=$1 and status=\'active\'',[vehicleCheck.rows[0].owner_id]);
          serviceLocation=locationResult.rows[0]||null;
        }
        const deliveryLatitude=input.deliveryLatitude == null || input.deliveryLatitude === '' ? null : Number(input.deliveryLatitude);
        const deliveryLongitude=input.deliveryLongitude == null || input.deliveryLongitude === '' ? null : Number(input.deliveryLongitude);
        if(input.delivery && ((deliveryLatitude==null)!==(deliveryLongitude==null) || (deliveryLatitude!=null && (!Number.isFinite(deliveryLatitude)||deliveryLatitude < -90||deliveryLatitude > 90)) || (deliveryLongitude!=null && (!Number.isFinite(deliveryLongitude)||deliveryLongitude < -180||deliveryLongitude > 180)))){
          const x=new Error('invalid delivery location'); x.code='INVALID_DELIVERY_LOCATION'; throw x;
        }
        const vendorServiceLatitude=serviceLocation?.service_latitude == null ? null : Number(serviceLocation.service_latitude);
        const vendorServiceLongitude=serviceLocation?.service_longitude == null ? null : Number(serviceLocation.service_longitude);
        const {rows}=await client.query('insert into bookings (customer_id,vehicle_id,vendor_id,start_at,end_at,delivery_required,delivery_address,delivery_latitude,delivery_longitude,vendor_service_latitude,vendor_service_longitude,delivery_fee_paise,rental_total_paise,platform_fee_paise,security_deposit_paise,total_paise,status,payment_status,delivery_status,customer_notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,\'requested\',\'unpaid\',\'scheduled\',$17) returning *',[input.customerId,input.vehicle.id,vehicleCheck.rows[0].owner_id||null,input.startAt,input.endAt,input.delivery,input.address,deliveryLatitude,deliveryLongitude,vendorServiceLatitude,vendorServiceLongitude,Math.round(input.pricing.deliveryFee * 100),Math.round(input.pricing.rental * 100),Math.round(input.pricing.platformFee * 100),Math.round((input.pricing.securityDeposit||0) * 100),Math.round(input.pricing.total * 100),input.notes||null]);
        if(input.idempotencyKey) await client.query('insert into booking_idempotency_keys (customer_id,idempotency_key,booking_id) values ($1,$2,$3)',[input.customerId,input.idempotencyKey,rows[0].id]);
        if(Number(input.pricing.securityDeposit||0)>0) await client.query(`insert into security_deposits(booking_id,customer_id,vendor_id,original_amount_paise,refundable_amount_paise,status) values($1,$2,$3,$4,$4,'pending') on conflict (booking_id) do nothing`,[rows[0].id,input.customerId,vehicleCheck.rows[0].owner_id||null,Math.round(Number(input.pricing.securityDeposit||0)*100)]);
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
    const id=crypto.randomUUID();const deliveryLatitude=input.deliveryLatitude == null || input.deliveryLatitude === '' ? null : Number(input.deliveryLatitude);const deliveryLongitude=input.deliveryLongitude == null || input.deliveryLongitude === '' ? null : Number(input.deliveryLongitude);if(input.delivery && ((deliveryLatitude==null)!==(deliveryLongitude==null) || (deliveryLatitude!=null && (!Number.isFinite(deliveryLatitude)||deliveryLatitude < -90||deliveryLatitude > 90)) || (deliveryLongitude!=null && (!Number.isFinite(deliveryLongitude)||deliveryLongitude < -180||deliveryLongitude > 180)))){const x=new Error('invalid delivery location');x.code='INVALID_DELIVERY_LOCATION';throw x;}const vendor= input.vehicle.vendorServiceLocation || null;const booking={id,customerId:input.customerId,vehicleId:input.vehicle.id,vendorId:input.vehicle.ownerId||input.vehicle.vendorId||null,vehicle:input.vehicle,startAt:input.startAt,endAt:input.endAt,delivery:input.delivery,address:input.address,deliveryLatitude,deliveryLongitude,vendorServiceLatitude:vendor?.latitude ?? null,vendorServiceLongitude:vendor?.longitude ?? null,routeDistanceMeters:null,routeDurationSeconds:null,routeProvider:null,notes:input.notes,pricing:input.pricing,status:'requested',paymentStatus:'unpaid',createdAt:new Date().toISOString()};
    if(Number(input.pricing.securityDeposit||0)>0) memory.securityDeposits.set(id,{bookingId:id,customerId:input.customerId,vendorId:input.vehicle.ownerId||null,originalAmount:Number(input.pricing.securityDeposit),refundableAmount:Number(input.pricing.securityDeposit),approvedDeduction:0,status:'pending'});memory.bookings.set(id,booking);if(key)memory.idempotency.set(key,booking);return booking;
  }

  async function updateBookingRouteData(id, customerId, route = {}) {
    const distanceMeters = Number(route.distanceMeters);
    const durationSeconds = Number(route.durationSeconds);
    if(!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(durationSeconds) || durationSeconds < 0){
      const e=new Error('Invalid route data.'); e.code='ROUTE_INVALID_DATA'; throw e;
    }
    if(!useDatabase){
      const booking=memory.bookings.get(id);
      if(!booking || String(booking.customerId)!==String(customerId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      booking.routeDistanceMeters=Math.round(distanceMeters);
      booking.routeDurationSeconds=Math.round(durationSeconds);
      booking.routeProvider=String(route.provider||'').slice(0,40)||null;
      booking.updatedAt=new Date().toISOString();
      return booking;
    }
    const {rows}=await pool.query(
      `update bookings
       set route_distance_meters=$3, route_duration_seconds=$4, route_provider=$5, updated_at=now()
       where id=$1 and customer_id=$2
       returning *`,
      [id,customerId,Math.round(distanceMeters),Math.round(durationSeconds),String(route.provider||'').slice(0,40)||null]
    );
    return rows[0] ? mapBooking(rows[0]) : null;
  }

  const mapTrackingSession=(row)=>row&&({id:String(row.id),bookingId:String(row.booking_id),vendorId:row.vendor_id?String(row.vendor_id):null,staffUserId:row.staff_user_id?String(row.staff_user_id):null,status:row.status,startedAt:iso(row.started_at),endedAt:iso(row.ended_at),lastLatitude:row.last_latitude==null?null:Number(row.last_latitude),lastLongitude:row.last_longitude==null?null:Number(row.last_longitude),lastAccuracyMeters:row.last_accuracy_meters==null?null:Number(row.last_accuracy_meters),lastLocationAt:iso(row.last_location_at),lastRouteDistanceMeters:row.last_route_distance_meters==null?null:Number(row.last_route_distance_meters),lastRouteDurationSeconds:row.last_route_duration_seconds==null?null:Number(row.last_route_duration_seconds),lastRoutePolyline:row.last_route_polyline||null,lastRouteAt:iso(row.last_route_at),expiresAt:iso(row.expires_at)});

  async function startDelivery(vendorId, bookingId) {
    const now=new Date(); const expiresAt=new Date(now.getTime()+Math.max(30,Number(process.env.TRACKING_SESSION_MAX_MINUTES||180))*60000);
    if(!useDatabase){
      const b=memory.bookings.get(String(bookingId));
      if(!b||String(b.vendorId)!==String(vendorId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(b.status!=='confirmed'){const e=new Error('Delivery can only start after the booking is confirmed.');e.code='DELIVERY_START_NOT_ALLOWED';throw e;}
      if(!b.delivery||b.deliveryLatitude==null||b.deliveryLongitude==null){const e=new Error('A valid delivery location is required before delivery can start.');e.code='DELIVERY_LOCATION_REQUIRED';throw e;}
      if(!['paid','held','settlement_pending','settled'].includes(String(b.paymentStatus))){const e=new Error('Payment must be confirmed before delivery can start.');e.code='PAYMENT_REQUIRED_FOR_DELIVERY';throw e;}
      if([...memory.trackingSessions.values()].some(x=>String(x.bookingId)===String(bookingId)&&x.status==='active')){const e=new Error('Delivery tracking is already active.');e.code='DELIVERY_ALREADY_ACTIVE';throw e;}
      const session={id:crypto.randomUUID(),bookingId:String(bookingId),vendorId:String(vendorId),status:'active',startedAt:now.toISOString(),endedAt:null,lastLatitude:null,lastLongitude:null,lastAccuracyMeters:null,lastLocationAt:null,lastRouteDistanceMeters:null,lastRouteDurationSeconds:null,lastRouteAt:null,expiresAt:expiresAt.toISOString()};
      memory.trackingSessions.set(session.id,session);b.deliveryStatus='in_delivery';b.deliveryStartedAt=session.startedAt;b.updatedAt=now.toISOString();return session;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select b.id,b.status,b.payment_status,b.delivery_required,b.delivery_address,b.delivery_latitude,b.delivery_longitude,v.owner_id from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1 and v.owner_id=$2 for update',[bookingId,vendorId]);
      const b=rows[0];if(!b){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(b.status!=='confirmed'){const e=new Error('Delivery can only start after the booking is confirmed.');e.code='DELIVERY_START_NOT_ALLOWED';throw e;}
      if(!b.delivery_required||b.delivery_latitude==null||b.delivery_longitude==null||!String(b.delivery_address||'').trim()){const e=new Error('A valid delivery location is required before delivery can start.');e.code='DELIVERY_LOCATION_REQUIRED';throw e;}
      if(!['paid','held','settlement_pending','settled'].includes(String(b.payment_status))){const e=new Error('Payment must be confirmed before delivery can start.');e.code='PAYMENT_REQUIRED_FOR_DELIVERY';throw e;}
      const active=await client.query("select id from tracking_sessions where booking_id=$1 and status='active' for update",[bookingId]);if(active.rows[0]){const e=new Error('Delivery tracking is already active.');e.code='DELIVERY_ALREADY_ACTIVE';throw e;}
      const {rows:created}=await client.query("insert into tracking_sessions(booking_id,vendor_id,status,expires_at) values($1,$2,'active',$3) returning *",[bookingId,vendorId,expiresAt]);
      await client.query("update bookings set delivery_status='in_delivery',delivery_started_at=now(),updated_at=now() where id=$1",[bookingId]);
      await client.query("insert into booking_status_events(booking_id,previous_status,next_status,actor_type,actor_id,note) values($1,$2,$2,'vendor',$3,'delivery_started')",[bookingId,b.status,vendorId]);
      await client.query('commit');return mapTrackingSession(created[0]);
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function updateDeliveryLocation(vendorId, bookingId, {latitude,longitude,accuracyMeters,recordedAt}={}) {
    const lat=Number(latitude),lon=Number(longitude),accuracy=accuracyMeters==null?null:Number(accuracyMeters),when=recordedAt?new Date(recordedAt):new Date();
    if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){const e=new Error('Invalid delivery location.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    if(accuracy!=null&&(!Number.isFinite(accuracy)||accuracy<0||accuracy>10000)){const e=new Error('Invalid GPS accuracy.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    if(Number.isNaN(when.getTime())||when.getTime()>Date.now()+120000){const e=new Error('Invalid location timestamp.');e.code='INVALID_DELIVERY_TIMESTAMP';throw e;}
    if(!useDatabase){
      const session=[...memory.trackingSessions.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.vendorId)===String(vendorId)&&x.status==='active');
      if(!session){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      if(new Date(session.expiresAt)<=new Date()){session.status='expired';session.endedAt=new Date().toISOString();const e=new Error('Delivery tracking session expired.');e.code='TRACKING_SESSION_EXPIRED';throw e;}
      if(session.lastLocationAt&&when.getTime()<new Date(session.lastLocationAt).getTime()-5000){const e=new Error('Location update is older than the last accepted update.');e.code='STALE_LOCATION_UPDATE';throw e;}
      session.lastLatitude=lat;session.lastLongitude=lon;session.lastAccuracyMeters=accuracy;session.lastLocationAt=when.toISOString();return session;
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query("select ts.* from tracking_sessions ts join bookings b on b.id=ts.booking_id join vehicles v on v.id=b.vehicle_id where ts.booking_id=$1 and ts.vendor_id=$2 and ts.status='active' and v.owner_id=$2 for update",[bookingId,vendorId]);
      const session=rows[0];if(!session){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      if(new Date(session.expires_at)<=new Date()){await client.query("update tracking_sessions set status='expired',ended_at=now() where id=$1",[session.id]);await client.query("update bookings set delivery_status='aborted',updated_at=now() where id=$1 and delivery_status='in_delivery'",[bookingId]);const e=new Error('Delivery tracking session expired.');e.code='TRACKING_SESSION_EXPIRED';throw e;}
      if(session.last_location_at&&when.getTime()<new Date(session.last_location_at).getTime()-5000){const e=new Error('Location update is older than the last accepted update.');e.code='STALE_LOCATION_UPDATE';throw e;}
      const {rows:updated}=await client.query("update tracking_sessions set last_latitude=$2,last_longitude=$3,last_accuracy_meters=$4,last_location_at=$5 where id=$1 returning *",[session.id,lat,lon,accuracy,when.toISOString()]);
      await client.query('commit');return mapTrackingSession(updated[0]);
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function getActiveTrackingSession(vendorId, bookingId) {
    if(!useDatabase){
      const session=[...memory.trackingSessions.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.vendorId)===String(vendorId)&&x.status==='active');
      return session||null;
    }
    const {rows}=await pool.query("select ts.* from tracking_sessions ts join bookings b on b.id=ts.booking_id join vehicles v on v.id=b.vehicle_id where ts.booking_id=$1 and ts.vendor_id=$2 and ts.status='active' and v.owner_id=$2",[bookingId,vendorId]);
    return rows[0]?mapTrackingSession(rows[0]):null;
  }

  async function updateTrackingRoute(vendorId, bookingId, {distanceMeters,durationSeconds,provider,polyline}={}) {
    if(!Number.isFinite(Number(distanceMeters))||Number(distanceMeters)<0||!Number.isFinite(Number(durationSeconds))||Number(durationSeconds)<0){const e=new Error('Invalid route data.');e.code='ROUTE_INVALID_DATA';throw e;}
    if(!useDatabase){
      const session=[...memory.trackingSessions.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.vendorId)===String(vendorId)&&x.status==='active');
      if(!session){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      session.lastRouteDistanceMeters=Math.round(Number(distanceMeters));session.lastRouteDurationSeconds=Math.round(Number(durationSeconds));session.lastRouteAt=new Date().toISOString();session.lastRoutePolyline=String(polyline||'');session.routeProvider=String(provider||'').slice(0,40);return session;
    }
    const {rows}=await pool.query("update tracking_sessions ts set last_route_distance_meters=$3,last_route_duration_seconds=$4,last_route_at=now(),last_route_polyline=$5 where ts.id=(select id from tracking_sessions where booking_id=$1 and vendor_id=$2 and status='active' limit 1) returning *",[bookingId,vendorId,Math.round(Number(distanceMeters)),Math.round(Number(durationSeconds)),String(polyline||'')]);
    return rows[0]?mapTrackingSession(rows[0]):null;
  }

  async function updateTrackingRouteForStaff(staffUserId, bookingId, {distanceMeters,durationSeconds,provider,polyline}={}) {
    if(!Number.isFinite(Number(distanceMeters))||Number(distanceMeters)<0||!Number.isFinite(Number(durationSeconds))||Number(durationSeconds)<0){const e=new Error('Invalid route data.');e.code='ROUTE_INVALID_DATA';throw e;}
    if(!useDatabase)return null;
    const {rows}=await pool.query("update tracking_sessions ts set last_route_distance_meters=$3,last_route_duration_seconds=$4,last_route_at=now(),last_route_polyline=$5 where ts.id=(select id from tracking_sessions where booking_id=$1 and staff_user_id=$2 and status='active' limit 1) returning *",[bookingId,staffUserId,Math.round(Number(distanceMeters)),Math.round(Number(durationSeconds)),String(polyline||'')]);
    return rows[0]?mapTrackingSession(rows[0]):null;
  }

  async function abortDelivery(vendorId, bookingId) {
    if(!useDatabase){
      const b=memory.bookings.get(String(bookingId));if(!b||String(b.vendorId)!==String(vendorId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const session=[...memory.trackingSessions.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.vendorId)===String(vendorId)&&x.status==='active');if(!session){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      session.status='aborted';session.endedAt=new Date().toISOString();b.deliveryStatus='aborted';b.updatedAt=new Date().toISOString();return {booking:b,session};
    }
    const client=await pool.connect();
    try{await client.query('begin');const {rows}=await client.query("select ts.*,b.status as booking_status from tracking_sessions ts join bookings b on b.id=ts.booking_id join vehicles v on v.id=b.vehicle_id where ts.booking_id=$1 and ts.vendor_id=$2 and ts.status='active' and v.owner_id=$2 for update",[bookingId,vendorId]);const ts=rows[0];if(!ts){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}await client.query("update tracking_sessions set status='aborted',ended_at=now() where id=$1",[ts.id]);await client.query("update bookings set delivery_status='aborted',updated_at=now() where id=$1",[bookingId]);await client.query('commit');return {booking:await getBooking(bookingId),session:mapTrackingSession({...ts,status:'aborted',ended_at:new Date().toISOString()})};}catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function getTrackingForCustomer(customerId, bookingId) {
    if(!useDatabase){
      const booking=memory.bookings.get(String(bookingId));if(!booking||String(booking.customerId)!==String(customerId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      let session=[...memory.trackingSessions.values()].filter(x=>String(x.bookingId)===String(bookingId)).sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0];if(session&&session.status==='active'&&new Date(session.expiresAt)<=new Date()){session.status='expired';session.endedAt=new Date().toISOString();if(booking.deliveryStatus==='in_delivery')booking.deliveryStatus='aborted';}return {booking,session:session||null};
    }
    const {rows}=await pool.query("select b.*,ts.id as ts_id,ts.vendor_id as ts_vendor_id,ts.status as ts_status,ts.started_at as ts_started_at,ts.ended_at as ts_ended_at,ts.last_latitude as ts_last_latitude,ts.last_longitude as ts_last_longitude,ts.last_accuracy_meters as ts_last_accuracy_meters,ts.last_location_at as ts_last_location_at,ts.last_route_distance_meters as ts_last_route_distance_meters,ts.last_route_duration_seconds as ts_last_route_duration_seconds,ts.last_route_polyline as ts_last_route_polyline,ts.last_route_at as ts_last_route_at,ts.expires_at as ts_expires_at from bookings b left join lateral (select * from tracking_sessions x where x.booking_id=b.id order by x.started_at desc limit 1) ts on true where b.id=$1 and b.customer_id=$2",[bookingId,customerId]);
    if(!rows[0]){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
    const r=rows[0];if(r.ts_id&&r.ts_status==='active'&&new Date(r.ts_expires_at)<=new Date()){await pool.query("update tracking_sessions set status='expired',ended_at=now() where id=$1 and status='active'",[r.ts_id]);await pool.query("update bookings set delivery_status='aborted',updated_at=now() where id=$1 and delivery_status='in_delivery'",[bookingId]);r.ts_status='expired';r.ts_ended_at=new Date().toISOString();}
    return {booking:mapBooking(r),session:r.ts_id?mapTrackingSession({id:r.ts_id,booking_id:r.id,vendor_id:r.ts_vendor_id,status:r.ts_status,started_at:r.ts_started_at,ended_at:r.ts_ended_at,last_latitude:r.ts_last_latitude,last_longitude:r.ts_last_longitude,last_accuracy_meters:r.ts_last_accuracy_meters,last_location_at:r.ts_last_location_at,last_route_distance_meters:r.ts_last_route_distance_meters,last_route_duration_seconds:r.ts_last_route_duration_seconds,last_route_polyline:r.ts_last_route_polyline,last_route_at:r.ts_last_route_at,expires_at:r.ts_expires_at}):null};
  }

  async function completeDelivery(vendorId, bookingId, {latitude=null,longitude=null}={}) {
    const finalLat=latitude==null?null:Number(latitude),finalLon=longitude==null?null:Number(longitude);
    if((finalLat==null)!==(finalLon==null)||finalLat!=null&&(!Number.isFinite(finalLat)||finalLat<-90||finalLat>90)||finalLon!=null&&(!Number.isFinite(finalLon)||finalLon<-180||finalLon>180)){const e=new Error('Invalid final delivery location.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    if(!useDatabase){
      const b=memory.bookings.get(String(bookingId));if(!b||String(b.vendorId)!==String(vendorId)){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const session=[...memory.trackingSessions.values()].find(x=>String(x.bookingId)===String(bookingId)&&String(x.vendorId)===String(vendorId)&&x.status==='active');if(!session){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      const now=new Date().toISOString();session.status='completed';session.endedAt=now;if(finalLat!=null){session.lastLatitude=finalLat;session.lastLongitude=finalLon;session.lastLocationAt=now;}b.deliveryStatus='delivered';b.deliveredAt=now;b.deliveryFinalLatitude=finalLat??session.lastLatitude;b.deliveryFinalLongitude=finalLon??session.lastLongitude;b.updatedAt=now;return {booking:b,session};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query("select ts.*,b.status as booking_status from tracking_sessions ts join bookings b on b.id=ts.booking_id join vehicles v on v.id=b.vehicle_id where ts.booking_id=$1 and ts.vendor_id=$2 and ts.status='active' and v.owner_id=$2 for update",[bookingId,vendorId]);
      const ts=rows[0];if(!ts){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      if(new Date(ts.expires_at)<=new Date()){await client.query("update tracking_sessions set status='expired',ended_at=now() where id=$1",[ts.id]);const e=new Error('Delivery tracking session expired.');e.code='TRACKING_SESSION_EXPIRED';throw e;}
      if(ts.booking_status!=='confirmed'){const e=new Error('Delivery can no longer be completed.');e.code='DELIVERY_COMPLETION_NOT_ALLOWED';throw e;}
      const lat=finalLat??(ts.last_latitude==null?null:Number(ts.last_latitude)),lon=finalLon??(ts.last_longitude==null?null:Number(ts.last_longitude));
      await client.query("update tracking_sessions set status='completed',ended_at=now(),last_latitude=coalesce($2,last_latitude),last_longitude=coalesce($3,last_longitude),last_location_at=case when $2 is not null then now() else last_location_at end where id=$1",[ts.id,lat,lon]);
      await client.query("update bookings set delivery_status='delivered',delivered_at=now(),delivery_final_latitude=$2,delivery_final_longitude=$3,updated_at=now() where id=$1",[bookingId,lat,lon]);
      await client.query("insert into booking_status_events(booking_id,previous_status,next_status,actor_type,actor_id,note) values($1,$2,$2,'vendor',$3,'delivery_completed')",[bookingId,ts.booking_status,vendorId]);
      await client.query('commit');const latest=await getBooking(bookingId);return {booking:latest,session:mapTrackingSession({...ts,status:'completed',ended_at:now.toISOString(),last_latitude:lat,last_longitude:lon,last_location_at:lat!=null?now.toISOString():ts.last_location_at})};
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function getBooking(id, customerId = null){
    if(!useDatabase){
      const booking=memory.bookings.get(id);
      return booking && (!customerId || booking.customerId===customerId) ? booking : null;
    }
    const {rows}=await pool.query(
      'select b.*, sd.status as security_deposit_status, sd.refundable_amount_paise as security_deposit_refundable_paise, sd.approved_deduction_paise as security_deposit_deduction_paise, p.id as payment_id, v.id as v_id, v.type as v_type, v.name as v_name from bookings b left join lateral (select * from payments px where px.booking_id=b.id order by px.created_at desc limit 1) p on true left join vehicles v on v.id=b.vehicle_id left join security_deposits sd on sd.booking_id=b.id where b.id=$1 and ($2::uuid is null or b.customer_id=$2)',
      [id, customerId]
    );
    if(!rows[0]) return null;
    const r=rows[0];
    return mapBooking({...r,security_deposit_status:r.security_deposit_status,security_deposit_refundable_paise:r.security_deposit_refundable_paise,security_deposit_deduction_paise:r.security_deposit_deduction_paise,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:undefined});
  }
  async function listCustomerBookings({customerId,limit,offset}){if(!useDatabase)return [...memory.bookings.values()].filter(b=>b.customerId===customerId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(offset,offset+limit);const {rows}=await pool.query('select b.*, sd.status as security_deposit_status, sd.refundable_amount_paise as security_deposit_refundable_paise, sd.approved_deduction_paise as security_deposit_deduction_paise, sd.deduction_reason as security_deposit_reason, sd.evidence_reference as security_deposit_evidence, sd.refund_provider_reference as security_deposit_refund_reference, sd.inspected_at as security_deposit_inspected_at, sd.inspected_by as security_deposit_inspected_by, p.id as payment_id, v.id as v_id, v.type as v_type, v.name as v_name from bookings b left join security_deposits sd on sd.booking_id=b.id left join lateral (select * from payments px where px.booking_id=b.id order by px.created_at desc limit 1) p on true left join vehicles v on v.id=b.vehicle_id where b.customer_id=$1 order by b.created_at desc limit $2 offset $3',[customerId,limit,offset]);return rows.map(r=>mapBooking({...r,security_deposit_status:r.security_deposit_status,security_deposit_refundable_paise:r.security_deposit_refundable_paise,security_deposit_deduction_paise:r.security_deposit_deduction_paise,vehicle:r.v_id?{id:String(r.v_id),name:r.v_name,type:String(r.v_type)}:undefined}));}
  const canTransition = (current, next) => {
    if (current === next) return true;
    const allowed = { unpaid:['pending','failed'], pending:['paid','failed'], paid:['held','refund_pending','failed','disputed'], held:['settlement_pending','refund_pending','disputed'], settlement_pending:['settled','failed','disputed'], settled:['refund_pending','disputed'], refund_pending:['refunded','failed','disputed'], failed:['pending'], disputed:['refund_pending','settlement_pending'], refunded:[] };
    return Boolean(allowed[current]?.includes(next));
  };

  async function getCancellationPreview(id, customerId){
    const booking=await getBooking(id,customerId);
    if(!booking){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
    return calculateCancellation({booking});
  }

  async function cancelBooking(id,customerId,{reason='customer_cancelled'}={}){
    if(!useDatabase){
      const b=memory.bookings.get(id);
      if(!b||b.customerId!==customerId){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const calculation=calculateCancellation({booking:b});
      const previous=b.status;
      b.status='cancelled'; if(b.deliveryStatus==='in_delivery'){const active=[...memory.trackingSessions.values()].find(x=>String(x.bookingId)===String(id)&&x.status==='active');if(active){active.status='aborted';active.endedAt=new Date().toISOString();}b.deliveryStatus='aborted';} b.cancellationFee=calculation.cancellationFee; b.refundAmount=calculation.totalRefund; b.cancellationReason=reason; b.cancelledAt=new Date().toISOString();
      if(b.paymentStatus==='paid'&&calculation.totalRefund>0)b.paymentStatus='refund_pending';
      b.updatedAt=new Date().toISOString();
      return {booking:b,calculation,previousStatus:previous};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select * from bookings where id=$1 and customer_id=$2 for update',[id,customerId]);
      if(!rows[0]){await client.query('rollback');const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      const current=mapBooking(rows[0]);
      const calculation=calculateCancellation({booking:current});
      const previous=rows[0].status;
      const paymentStatus=rows[0].payment_status==='paid'&&calculation.totalRefund>0?'refund_pending':rows[0].payment_status;
      await client.query("update tracking_sessions set status='aborted',ended_at=now() where booking_id=$1 and status='active'",[id]);
      await client.query("update bookings set delivery_status=case when delivery_status='in_delivery' then 'aborted' else delivery_status end,updated_at=now() where id=$1",[id]);
      const {rows:updated}=await client.query('update bookings set status=\'cancelled\',payment_status=$2,cancellation_fee_paise=$3,refund_amount_paise=$4,cancelled_at=now(),cancellation_reason=$5,updated_at=now() where id=$1 returning *',[id,paymentStatus,Math.round(calculation.cancellationFee*100),Math.round(calculation.totalRefund*100),reason]);
      await client.query('insert into booking_status_events (booking_id,previous_status,next_status,actor_type,actor_id,note) values ($1,$2,\'cancelled\',\'customer\',$3,$4)',[id,previous,customerId,reason]);
      if(paymentStatus==='refund_pending') await client.query('update payments set status=\'refund_pending\',updated_at=now() where booking_id=$1 and status=\'paid\'',[id]);
      if(Number(calculation.refundableSecurityDeposit)>0) await client.query(`insert into security_deposits(booking_id,customer_id,vendor_id,original_amount_paise,refundable_amount_paise,status) values($1,$2,(select vendor_id from bookings where id=$1),$3,$3,'refund_pending') on conflict (booking_id) do update set refundable_amount_paise=excluded.refundable_amount_paise,status='refund_pending',updated_at=now()`,[id,customerId,Math.round(calculation.refundableSecurityDeposit*100)]);
      await client.query('commit');
      return {booking:mapBooking({...updated[0],vehicle:undefined}),calculation,previousStatus:previous};
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function markPaymentRefundPending(paymentId,{providerReference}={}){
    if(!useDatabase){const p=[...(memory.payments?.values()||[])].find(x=>x.id===String(paymentId));if(!p){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}if(p.status==='refunded'||p.status==='refund_pending')return p;if(p.status!=='paid'){const e=new Error('Payment is not refundable in its current state.');e.code='INVALID_PAYMENT_STATE';throw e;}p.status='refund_pending';if(providerReference)p.providerReference=String(providerReference);p.updatedAt=new Date().toISOString();const b=memory.bookings.get(String(p.bookingId));if(b)b.paymentStatus='refund_pending';return p;}
    const client=await pool.connect();try{await client.query('begin');const {rows}=await client.query('select p.*,b.customer_id from payments p join bookings b on b.id=p.booking_id where p.id=$1 for update',[paymentId]);if(!rows[0]){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}if(['refunded','refund_pending'].includes(rows[0].status)){await client.query('commit');return {id:String(rows[0].id),bookingId:String(rows[0].booking_id),status:rows[0].status};}if(rows[0].status!=='paid'){const e=new Error('Payment is not refundable in its current state.');e.code='INVALID_PAYMENT_STATE';throw e;}await client.query('update payments set status=\'refund_pending\',provider_reference=coalesce($2,provider_reference),updated_at=now() where id=$1',[paymentId,providerReference||null]);await client.query('update bookings set payment_status=\'refund_pending\',updated_at=now() where id=$1',[rows[0].booking_id]);await client.query('commit');return {id:String(rows[0].id),bookingId:String(rows[0].booking_id),status:'refund_pending'};}catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function claimRefundRequest(paymentId){
    const key=String(paymentId);
    if(!useDatabase){
      const existing=memory.financialTransactions.get(key);
      if(existing && ['pending','submitted','completed'].includes(existing.status)) return {created:false,status:existing.status,idempotencyKey:existing.idempotencyKey};
      const p=[...(memory.payments?.values()||[])].find(x=>x.id===key);
      if(!p){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      if(p.status==='refunded') return {created:false,status:'completed',idempotencyKey:`refund:${key}`};
      if(!['paid','refund_pending'].includes(p.status)){const e=new Error('Payment is not refundable in its current state.');e.code='INVALID_PAYMENT_STATE';throw e;}
      p.status='refund_pending';p.updatedAt=new Date().toISOString();
      const tx={bookingId:String(p.bookingId),paymentId:key,transactionType:'refund',status:'pending',idempotencyKey:`refund:${key}`};
      memory.financialTransactions.set(key,tx);
      return {created:true,status:'pending',idempotencyKey:tx.idempotencyKey};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query('select p.*,b.id as booking_id from payments p join bookings b on b.id=p.booking_id where p.id=$1 for update',[paymentId]);
      if(!rows[0]){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}
      const existing=await client.query("select id,status,idempotency_key from financial_transactions where booking_id=$1 and transaction_type='refund' order by created_at desc limit 1 for update",[rows[0].booking_id]);
      if(existing.rows[0] && ['pending','submitted','completed'].includes(existing.rows[0].status)){await client.query('commit');return {created:false,status:existing.rows[0].status,idempotencyKey:existing.rows[0].idempotency_key};}
      if(rows[0].status==='refunded'){await client.query('commit');return {created:false,status:'completed',idempotencyKey:`refund:${paymentId}`};}
      if(!['paid','refund_pending'].includes(rows[0].status)){const e=new Error('Payment is not refundable in its current state.');e.code='INVALID_PAYMENT_STATE';throw e;}
      await client.query("update payments set status='refund_pending',updated_at=now() where id=$1",[paymentId]);
      let tx;
      if(existing.rows[0]){
        tx=await client.query("update financial_transactions set status='pending',updated_at=now() where id=$1 returning id,status,idempotency_key",[existing.rows[0].id]);
      } else {
        tx=await client.query("insert into financial_transactions(booking_id,customer_id,amount_paise,currency,transaction_type,status,provider,provider_transaction_id,idempotency_key) values($1,(select customer_id from bookings where id=$1),$2,'INR','refund',$3,$4,null,$5) returning id,status,idempotency_key",[rows[0].booking_id,rows[0].amount_paise,'pending',rows[0].provider,`refund:${paymentId}`]);
      }
      await client.query("update bookings set payment_status='refund_pending',updated_at=now() where id=$1",[rows[0].booking_id]);
      await client.query('commit');
      return {created:true,status:'pending',idempotencyKey:tx.rows[0].idempotency_key};
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function markRefundRetryable(paymentId){
    if(!useDatabase){const tx=memory.financialTransactions.get(String(paymentId));if(tx)tx.status='retryable';return;}
    await pool.query("update financial_transactions set status='retryable',updated_at=now() where booking_id=(select booking_id from payments where id=$1) and transaction_type='refund' and status='pending'",[paymentId]);
  }

  async function completePaymentRefund({paymentId,providerReference}={}){
    if(!providerReference){const e=new Error('Provider refund reference is required.');e.code='REFUND_PROVIDER_REFERENCE_REQUIRED';throw e;}
    if(!useDatabase){const p=[...(memory.payments?.values()||[])].find(x=>x.id===String(paymentId));if(!p){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}if(p.status==='refunded')return p;if(p.status!=='refund_pending'){const e=new Error('Payment is not awaiting a refund.');e.code='INVALID_PAYMENT_STATE';throw e;}p.status='refunded';p.providerReference=String(providerReference);p.updatedAt=new Date().toISOString();const b=memory.bookings.get(String(p.bookingId));if(b)b.paymentStatus='refunded';return p;}
    const client=await pool.connect();try{await client.query('begin');const {rows}=await client.query('select p.*,b.id as booking_id from payments p join bookings b on b.id=p.booking_id where p.id=$1 for update',[paymentId]);if(!rows[0]){const e=new Error('Payment not found.');e.code='PAYMENT_NOT_FOUND';throw e;}if(rows[0].status==='refunded'){await client.query('commit');return {id:String(rows[0].id),bookingId:String(rows[0].booking_id),status:'refunded'};}if(rows[0].status!=='refund_pending'){const e=new Error('Payment is not awaiting a refund.');e.code='INVALID_PAYMENT_STATE';throw e;}await client.query('update payments set status=\'refunded\',provider_reference=$2,updated_at=now() where id=$1',[paymentId,String(providerReference)]);await client.query('update bookings set payment_status=\'refunded\',updated_at=now() where id=$1',[rows[0].booking_id]);await client.query('update security_deposits set status=\'refunded\',refund_provider_reference=$2,refunded_at=now(),updated_at=now() where booking_id=$1 and status=\'refund_pending\'',[rows[0].booking_id,String(providerReference)]);await client.query('commit');return {id:String(rows[0].id),bookingId:String(rows[0].booking_id),status:'refunded',providerReference:String(providerReference)};}catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }
  async function applyDepositRefundEvent(event) {
    if (!event || event.status !== 'refunded' || !event.providerOrderId || !event.providerReference) return {handled:false};
    if (!useDatabase) {
      const payment=[...(memory.payments?.values()||[])].find(p=>String(p.providerOrderId||'')===String(event.providerOrderId));
      if (!payment) return {handled:false};
      const deposit=memory.securityDeposits.get(String(payment.bookingId));
      if (!deposit || deposit.status!=='refund_pending' || Math.round(Number(deposit.refundableAmount||0)*100)!==Number(event.amountPaise)) return {handled:false};
      if(memory.paymentEvents.has(event.eventId)) return {handled:true,applied:false,duplicate:true};
      memory.paymentEvents.set(event.eventId,event);
      deposit.status='refunded';
      deposit.refundProviderReference=String(event.providerReference);
      deposit.refundedAt=new Date().toISOString();
      return {handled:true,applied:true,duplicate:false};
    }
    const client=await pool.connect();
    try{
      await client.query('begin');
      const p=await client.query('select id,booking_id,amount_paise from payments where provider_order_id=$1 for update',[event.providerOrderId]);
      if(!p.rows[0]){await client.query('rollback');return {handled:false};}
      const d=await client.query('select status,refundable_amount_paise from security_deposits where booking_id=$1 for update',[p.rows[0].booking_id]);
      if(!d.rows[0] || String(d.rows[0].status)!=='refund_pending' || Number(d.rows[0].refundable_amount_paise)!==Number(event.amountPaise)){await client.query('rollback');return {handled:false};}
      const inserted=await client.query('insert into payment_events(provider_event_id,booking_id,status,provider_reference,amount_paise,currency,provider_order_id,received_at) values($1,$2,\'refunded\',$3,$4,\'INR\',$5,now()) on conflict(provider_event_id) do nothing returning id',[event.eventId,p.rows[0].booking_id,event.providerReference,event.amountPaise,event.providerOrderId]);
      if(!inserted.rows[0]){await client.query('commit');return {handled:true,applied:false,duplicate:true};}
      await client.query("update security_deposits set status='refunded',refund_provider_reference=$2,refunded_at=now(),updated_at=now() where booking_id=$1",[p.rows[0].booking_id,event.providerReference]);
      await client.query('commit');
      return {handled:true,applied:true,duplicate:false};
    }catch(e){try{await client.query('rollback')}catch{};throw e;}finally{client.release();}
  }

  async function applyPaymentEvent(event){
    if (!useDatabase) {
      if (memory.paymentEvents.has(event.eventId)) return { applied:false, duplicate:true };
      const payment = event.providerOrderId ? [...memory.payments.values()].find(p => p.providerOrderId === String(event.providerOrderId)) : (event.bookingId ? memory.payments.get(String(event.bookingId)) : null);
      const resolvedBookingId = payment?.bookingId;
      const booking = resolvedBookingId ? memory.bookings.get(String(resolvedBookingId)) : null;
      if (!booking || !payment) return { applied:false, duplicate:false, invalid:true };
      // Provider order/payment and booking must remain bound; never let a webhook
      // choose a different booking via a client/provider-supplied bookingId.
      if (event.bookingId && String(event.bookingId) !== String(payment.bookingId)) return { applied:false, duplicate:false, invalid:true };
      if (event.providerOrderId && payment.providerOrderId !== String(event.providerOrderId)) return { applied:false, duplicate:false, invalid:true };
      // Persist the first valid event before mutating booking/payment state so a retry is a strict replay.

      const expectedPaise = Math.round(Number(booking.pricing?.total || 0) * 100);
      if (event.status==='paid' && !['requested','confirmed'].includes(String(booking.status))) return { applied:false, duplicate:false, invalid:true };
      if (event.currency !== 'INR' || Number(event.amountPaise) !== expectedPaise || !event.providerReference || !canTransition(booking.paymentStatus || 'unpaid', event.status)) {
        return { applied:false, duplicate:false, invalid:true };
      }
      memory.paymentEvents.set(event.eventId, event);
      booking.paymentStatus = event.status;
      booking.paymentProviderReference = event.providerReference;
      const paymentRecord = event.providerOrderId
        ? [...memory.payments.values()].find(p => p.providerOrderId === String(event.providerOrderId))
        : memory.payments.get(String(resolvedBookingId));
      if (event.status==='paid') { const deposit=memory.securityDeposits.get(String(resolvedBookingId)); if(deposit) deposit.status='held'; }
      if (event.status==='refund_pending') { const deposit=memory.securityDeposits.get(String(resolvedBookingId)); if(deposit) deposit.status='refund_pending'; }
      if (event.status==='refunded') { const deposit=memory.securityDeposits.get(String(resolvedBookingId)); if(deposit) { deposit.status='refunded'; deposit.refundProviderReference=event.providerReference; } }
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
      const resolvedBookingId = String(payment.booking_id);
      if (event.bookingId && String(event.bookingId) !== resolvedBookingId) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
      if (event.providerOrderId && String(payment.provider_order_id) !== String(event.providerOrderId)) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
      const bookingResult = await client.query('select id,payment_status,total_paise,fleet_order_id,status from bookings where id=$1 for update',[resolvedBookingId]);
      if (!bookingResult.rows[0]) {
        await client.query('rollback');
        return { applied:false, duplicate:false, invalid:true };
      }
      const booking = bookingResult.rows[0];
      let fleetOrder = null;
      if (booking.fleet_order_id) {
        const fleetResult = await client.query('select id,payment_status,total_paise,status from fleet_orders where id=$1 for update',[booking.fleet_order_id]);
        fleetOrder = fleetResult.rows[0] || null;
        if (!fleetOrder) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
      }
      const expectedTotalPaise = fleetOrder ? Number(fleetOrder.total_paise) : Number(booking.total_paise);
      const currentPaymentStatus = fleetOrder ? String(fleetOrder.payment_status) : String(booking.payment_status);
      if (event.status==='paid' && (fleetOrder ? fleetOrder.status !== 'requested' : !['requested','confirmed'].includes(String(booking.status)))) {
        await client.query('rollback'); return { applied:false, duplicate:false, invalid:true };
      }
      if (event.currency !== 'INR' || Number(event.amountPaise) !== expectedTotalPaise || Number(event.amountPaise) !== Number(payment.amount_paise) || !event.providerReference || !canTransition(currentPaymentStatus, event.status)) {
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
      if(fleetOrder){
        await client.query('update fleet_orders set payment_status=$2,updated_at=now() where id=$1',[fleetOrder.id,event.status]);
        await client.query('update bookings set payment_status=$2,payment_provider_reference=$3,updated_at=now() where fleet_order_id=$1',[fleetOrder.id,event.status,event.providerReference]);
        if(event.status==='paid') await client.query("update security_deposits set status='held',updated_at=now() where booking_id in (select booking_id from fleet_order_items where fleet_order_id=$1) and status in ('pending','held')",[fleetOrder.id]);
        if(event.status==='refund_pending') await client.query("update security_deposits set status='refund_pending',updated_at=now() where booking_id in (select booking_id from fleet_order_items where fleet_order_id=$1) and status in ('held','refund_pending')",[fleetOrder.id]);
        if(event.status==='refunded') await client.query("update security_deposits set status='refunded',refund_provider_reference=$2,refunded_at=now(),updated_at=now() where booking_id in (select booking_id from fleet_order_items where fleet_order_id=$1) and status in ('held','refund_pending','release_pending')",[fleetOrder.id,event.providerReference]);
      }else{
        if(event.status==='paid') await client.query("update security_deposits set status='held',updated_at=now() where booking_id=$1 and status in ('pending','held')",[resolvedBookingId]);
        if(event.status==='refund_pending') await client.query("update security_deposits set status='refund_pending',updated_at=now() where booking_id=$1 and status in ('held','refund_pending')",[resolvedBookingId]);
        if(event.status==='refunded') await client.query("update security_deposits set status='refunded',refund_provider_reference=$2,refunded_at=now(),updated_at=now() where booking_id=$1 and status in ('held','refund_pending','release_pending')",[resolvedBookingId,event.providerReference]);
      }
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
    const kyc = await getKycStatus(customerId);
    if (!kyc || kyc.status !== 'VERIFIED') throw Object.assign(new Error('KYC verification is required before payment.'), { code:'KYC_REQUIRED' });
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

  async function createFleetOrderPayment({orderId,customerId,provider,amountPaise,idempotencyKey,providerOrder}={}) {
    const kyc = await getKycStatus(customerId);
    if (!kyc || kyc.status !== 'VERIFIED') throw Object.assign(new Error('KYC verification is required before payment.'), { code:'KYC_REQUIRED' });
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
    return c ? { id:c.id, fullName:c.fullName, phone:c.phone, email:c.email, passwordHash:c.passwordHash, role:c.role || 'customer', supabaseUserId:c.supabaseUserId, kycStatus:c.kycStatus || 'UNVERIFIED', activeKycId:c.activeKycId || null } : null;
  }

  async function findCustomerById(id) {
    if (useDatabase) {
      const { rows } = await pool.query('select id,full_name,phone,email,password_hash,role,supabase_user_id,kyc_status,active_kyc_id from customers where id=$1', [id]);
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

  const FLEET_STATES = new Set(['AVAILABLE','RESERVED','RENTED','RETURNED','INSPECTION','MAINTENANCE','INACTIVE']);
  const FLEET_STATE_TRANSITIONS = {
    AVAILABLE:new Set(['RESERVED','MAINTENANCE','INACTIVE']), RESERVED:new Set(['RENTED','AVAILABLE','INACTIVE']),
    RENTED:new Set(['RETURNED','MAINTENANCE']), RETURNED:new Set(['INSPECTION']), INSPECTION:new Set(['AVAILABLE','MAINTENANCE']),
    MAINTENANCE:new Set(['AVAILABLE','INACTIVE']), INACTIVE:new Set(['AVAILABLE']),
  };

  const validateFleetVehicleInput = (input={}) => {
    const fleetVehicleClass=String(input.fleetVehicleClass||input.vehicleClass||'bike').toLowerCase();
    const dailyRate=Number(input.dailyRate),deposit=Number(input.securityDeposit||0);
    if(!['bike','scooter'].includes(fleetVehicleClass)) { const e=new Error('RideOn fleet currently supports bikes and scooters only.');e.code='INVALID_FLEET_VEHICLE';throw e; }
    if(!String(input.name||'').trim()||!String(input.city||'').trim()||!Number.isFinite(dailyRate)||dailyRate<0||!Number.isFinite(deposit)||deposit<0){const e=new Error('Invalid fleet vehicle details.');e.code='INVALID_FLEET_VEHICLE';throw e;}
    if(input.registrationNumber!=null&&String(input.registrationNumber).trim().length>30){const e=new Error('Registration number is too long.');e.code='INVALID_FLEET_VEHICLE';throw e;}
    if(input.currentOdometer!=null&&(!Number.isInteger(Number(input.currentOdometer))||Number(input.currentOdometer)<0)){const e=new Error('Odometer must be a non-negative integer.');e.code='INVALID_FLEET_VEHICLE';throw e;}
    if(input.currentFuelBattery!=null&&(!Number.isFinite(Number(input.currentFuelBattery))||Number(input.currentFuelBattery)<0||Number(input.currentFuelBattery)>100)){const e=new Error('Fuel/battery level must be between 0 and 100.');e.code='INVALID_FLEET_VEHICLE';throw e;}
    return {...input,type:'bike',fleetVehicleClass,dailyRate,securityDeposit};
  };

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
    const params=[];const where=["v.active=true","coalesce(v.type::text,'') <> 'car'","coalesce(v.fleet_vehicle_class,'bike') in ('bike','scooter')","coalesce(v.operational_state,'AVAILABLE') not in ('MAINTENANCE','INACTIVE')","coalesce(v.maintenance_required,false)=false"];
    if(query){params.push('%'+query+'%');where.push("lower(coalesce(v.name,'') || ' ' || coalesce(v.make,'') || ' ' || coalesce(v.model,'') || ' ' || coalesce(v.variant,'')) like $"+params.length);}
    if(classFilter){params.push(classFilter);where.push("lower(coalesce(v.fleet_vehicle_class,'bike'))=$"+params.length);}
    if(brandFilter){params.push(brandFilter);where.push("lower(coalesce(v.make,''))=$"+params.length);}
    if(modelFilter){params.push(modelFilter);where.push("lower(coalesce(v.model,''))=$"+params.length);}
    if(cityFilter){params.push(cityFilter);where.push("lower(trim(coalesce(v.city,'')))=lower(trim($"+params.length+"))");}
    if(min!=null&&Number.isFinite(min)){params.push(Math.round(min*100));where.push("v.daily_rate_paise>=$"+params.length);}
    if(max!=null&&Number.isFinite(max)){params.push(Math.round(max*100));where.push("v.daily_rate_paise<=$"+params.length);}
    let order='v.name asc,v.created_at desc';
    if(sortValue==='price_asc')order='v.daily_rate_paise asc,v.name asc';
    else if(sortValue==='price_desc')order='v.daily_rate_paise desc,v.name asc';
    const limitParam=params.length+1;
    const offsetParam=params.length+2;
    const {rows}=await pool.query(
      `select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,variant,color,pickup_location,service_area,fleet_vehicle_class,operational_state,maintenance_required,description,image_urls,delivery_available,active,created_at,updated_at
       from vehicles v
       where ${where.join(' and ')}
       order by ${order}
       limit $${limitParam} offset $${offsetParam}`,
      [...params,safeLimit,safeOffset]
    );
    return rows.map(mapManagedVehicle);
  }

  async function getRideOnFleetVehicle(vehicleId) {
    if(!useDatabase){
      const v=[...memory.vehicles.values()].find(x=>String(x.id)===String(vehicleId)&&x.active!==false);
      return v||null;
    }
    const {rows}=await pool.query('select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,description,image_urls,delivery_available,active,created_at,updated_at from vehicles where id=$1 and active=true',[vehicleId]);
    return rows[0]?mapManagedVehicle(rows[0]):null;
  }

  async function listRideOnFleetAdmin({q='',type='',city='',status='',registration='',model='',limit=50,offset=0}={}) {
    const safeLimit=Math.max(1,Math.min(100,Number(limit)||50)),safeOffset=Math.max(0,Number(offset)||0);
    const typeFilter=String(type||'').trim().toLowerCase(),statusFilter=String(status||'').trim().toUpperCase();
    if(!useDatabase){ let rows=[...memory.vehicles.values(),...fleet].filter(v=>String(v.type||'').toLowerCase()!=='car'); rows=rows.filter(v=>(!typeFilter||String(v.fleetVehicleClass||v.vehicleClass||'bike').toLowerCase()===typeFilter)&&(!statusFilter||String(v.operationalState||'AVAILABLE').toUpperCase()===statusFilter)&&(!city||String(v.city||'').toLowerCase()===String(city).toLowerCase())&&(!registration||String(v.registrationNumber||'').toLowerCase().includes(String(registration).toLowerCase()))&&(!model||String(v.model||'').toLowerCase().includes(String(model).toLowerCase()))&&(!q||[v.name,v.make,v.model,v.variant,v.city,v.registrationNumber].filter(Boolean).join(' ').toLowerCase().includes(String(q).toLowerCase()))); return rows.slice(safeOffset,safeOffset+safeLimit); }
    const params=[],where=["v.type::text<>'car'"];
    if(typeFilter){params.push(typeFilter);where.push('lower(coalesce(v.fleet_vehicle_class,\'bike\'))=$'+params.length);}
    if(statusFilter){if(!FLEET_STATES.has(statusFilter)){const e=new Error('Invalid fleet status.');e.code='INVALID_FLEET_STATE';throw e;}params.push(statusFilter);where.push('v.operational_state=$'+params.length);}
    if(city){params.push(String(city));where.push('lower(trim(v.city))=lower(trim($'+params.length+'))');}
    if(registration){params.push('%'+String(registration).toLowerCase()+'%');where.push('lower(coalesce(v.registration_number,\'\')) like $'+params.length);}
    if(model){params.push('%'+String(model).toLowerCase()+'%');where.push('lower(coalesce(v.model,\'\')) like $'+params.length);}
    if(q){params.push('%'+String(q).toLowerCase()+'%');where.push("lower(coalesce(v.name,'') || ' ' || coalesce(v.make,'') || ' ' || coalesce(v.model,'') || ' ' || coalesce(v.variant,'') || ' ' || coalesce(v.registration_number,'')) like $"+params.length);}
    params.push(safeLimit,safeOffset);
    const qResult=await pool.query('select id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,variant,color,pickup_location,pickup_latitude,pickup_longitude,service_area,fleet_vehicle_class,operational_state,maintenance_required,current_odometer,current_fuel_battery,active,created_at,updated_at from vehicles v where '+where.join(' and ')+' order by created_at desc limit $'+(params.length-1)+' offset $'+params.length,params);
    return qResult.rows.map(mapManagedVehicle);
  }

  async function getRideOnFleetDashboard() {
    if(!useDatabase){const rows=[...memory.vehicles.values(),...fleet].filter(v=>String(v.type||'').toLowerCase()!=='car');const count=s=>rows.filter(v=>String(v.operationalState||'AVAILABLE').toUpperCase()===s).length;return {totalFleet:rows.length,available:count('AVAILABLE'),reserved:count('RESERVED'),rented:count('RENTED'),maintenance:count('MAINTENANCE'),inactive:count('INACTIVE')};}
    const r=await pool.query("select count(*)::int total, count(*) filter(where operational_state='AVAILABLE')::int available, count(*) filter(where operational_state='RESERVED')::int reserved, count(*) filter(where operational_state='RENTED')::int rented, count(*) filter(where operational_state='MAINTENANCE')::int maintenance, count(*) filter(where operational_state='INACTIVE' or active=false)::int inactive from vehicles where type::text<>'car' and coalesce(fleet_vehicle_class,'bike') in ('bike','scooter')");
    const x=r.rows[0]||{};return {totalFleet:Number(x.total||0),available:Number(x.available||0),reserved:Number(x.reserved||0),rented:Number(x.rented||0),maintenance:Number(x.maintenance||0),inactive:Number(x.inactive||0)};
  }

  async function createRideOnFleetVehicle(input,actorUserId) {
    const data=validateFleetVehicleInput(input); const id=crypto.randomUUID();
    if(!useDatabase){const reg=String(data.registrationNumber||'').trim().toLowerCase();if(reg&&[...memory.vehicles.values()].some(v=>String(v.registrationNumber||'').trim().toLowerCase()===reg))throw Object.assign(new Error('A vehicle with this registration number already exists.'),{code:'VEHICLE_EXISTS'});const v={id,ownerId:null,...data,active:data.active!==false,operationalState:'AVAILABLE',maintenanceRequired:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};memory.vehicles.set(id,v);return v;}
    try{const q=await pool.query('insert into vehicles(id,owner_id,type,name,make,model,year,city,daily_rate_paise,security_deposit_paise,transmission,fuel,seats,registration_number,description,image_urls,delivery_available,variant,color,pickup_location,pickup_latitude,pickup_longitude,service_area,fleet_vehicle_class,operational_state,maintenance_required,current_odometer,current_fuel_battery,active,updated_at) values($1,null,\'bike\',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,\'AVAILABLE\',false,$25,$26,$27,now()) returning *',[id,data.name,data.make||null,data.model||null,data.year||null,data.city,Math.round(data.dailyRate*100),Math.round(data.securityDeposit*100),data.transmission||null,data.fuel||null,data.seats||null,data.registrationNumber||null,data.description||null,data.imageUrls||[],data.deliveryAvailable!==false,data.variant||null,data.color||null,data.pickupLocation||null,data.pickupLatitude??null,data.pickupLongitude??null,data.serviceArea||{},data.fleetVehicleClass,data.currentOdometer??null,data.currentFuelBattery??null,data.active!==false]);await pool.query('insert into fleet_operation_audit(vehicle_id,actor_user_id,action,next_state,details) values($1,$2,\'vehicle_created\',\'AVAILABLE\',$3)',[id,actorUserId||null,JSON.stringify({registrationNumber:data.registrationNumber||null})]);return mapManagedVehicle(q.rows[0]);}catch(error){if(error.code==='23505')throw Object.assign(new Error('A vehicle with this registration number already exists.'),{code:'VEHICLE_EXISTS'});throw error;}
  }

  async function updateRideOnFleetVehicle(vehicleId,input,actorUserId) {
    const data=validateFleetVehicleInput(input); if(!useDatabase){const v=memory.vehicles.get(String(vehicleId));if(!v||String(v.type||'').toLowerCase()==='car')return null;Object.assign(v,data,{ownerId:null,updatedAt:new Date().toISOString()});return v;}
    const fields={name:'name',make:'make',model:'model',year:'year',city:'city',dailyRate:'daily_rate_paise',securityDeposit:'security_deposit_paise',transmission:'transmission',fuel:'fuel',seats:'seats',registrationNumber:'registration_number',description:'description',imageUrls:'image_urls',deliveryAvailable:'delivery_available',variant:'variant',color:'color',pickupLocation:'pickup_location',pickupLatitude:'pickup_latitude',pickupLongitude:'pickup_longitude',serviceArea:'service_area',fleetVehicleClass:'fleet_vehicle_class',currentOdometer:'current_odometer',currentFuelBattery:'current_fuel_battery'}; const sets=[],params=[vehicleId]; for(const [k,col] of Object.entries(fields)){if(data[k]===undefined)continue;let val=data[k];if(k==='dailyRate'||k==='securityDeposit')val=Math.round(Number(val)*100);params.push(val);sets.push(col+'=$'+params.length);} if(!sets.length)return getRideOnFleetVehicle(vehicleId); sets.push('owner_id=null','updated_at=now()'); const q=await pool.query('update vehicles set '+sets.join(',')+' where id=$1 and type::text<>\'car\' returning *',params); if(!q.rows[0])return null; await pool.query('insert into fleet_operation_audit(vehicle_id,actor_user_id,action,details) values($1,$2,\'vehicle_updated\',$3)',[vehicleId,actorUserId||null,JSON.stringify({fields:Object.keys(input)})]); return mapManagedVehicle(q.rows[0]);
  }

  async function setRideOnFleetVehicleState(vehicleId,nextState,actorUserId) {
    const state=String(nextState||'').toUpperCase();if(!FLEET_STATES.has(state)){const e=new Error('Invalid fleet state.');e.code='INVALID_FLEET_STATE';throw e;}
    if(!useDatabase){const v=memory.vehicles.get(String(vehicleId));if(!v)return null;const current=String(v.operationalState||'AVAILABLE').toUpperCase();if(current!==state&&!FLEET_STATE_TRANSITIONS[current]?.has(state)){const e=new Error('Vehicle state transition is not allowed.');e.code='INVALID_FLEET_TRANSITION';throw e;}v.operationalState=state;v.active=state!=='INACTIVE';v.maintenanceRequired=state==='MAINTENANCE';v.updatedAt=new Date().toISOString();return v;}
    const client=await pool.connect();try{await client.query('begin');const q=await client.query("select id,operational_state,active from vehicles where id=$1 and type::text<>'car' for update",[vehicleId]);if(!q.rows[0])return null;const current=String(q.rows[0].operational_state||'AVAILABLE').toUpperCase();if(current!==state&&!FLEET_STATE_TRANSITIONS[current]?.has(state)){const e=new Error('Vehicle state transition is not allowed.');e.code='INVALID_FLEET_TRANSITION';throw e;}await client.query('update vehicles set operational_state=$2,maintenance_required=$3,active=$4,updated_at=now() where id=$1',[vehicleId,state,state==='MAINTENANCE',state!=='INACTIVE']);await client.query('insert into fleet_operation_audit(vehicle_id,actor_user_id,action,previous_state,next_state) values($1,$2,\'status_changed\',$3,$4)',[vehicleId,actorUserId||null,current,state]);await client.query('commit');return getRideOnFleetVehicle(vehicleId);}catch(e){try{await client.query('rollback')}catch{}throw e;}finally{client.release();}
  }

  async function recordFleetMaintenance({vehicleId,status,notes='',cost=0,serviceDate=null,nextServiceDate=null,odometerAtService=null,actorUserId}) {
    const normalized=String(status||'').toLowerCase();if(!['required','scheduled','started','completed'].includes(normalized)){const e=new Error('Invalid maintenance status.');e.code='INVALID_MAINTENANCE_STATUS';throw e;}const costNumber=Number(cost);if(!Number.isFinite(costNumber)||costNumber<0){const e=new Error('Maintenance cost is invalid.');e.code='INVALID_MAINTENANCE';throw e;}
    if(!useDatabase){const v=memory.vehicles.get(String(vehicleId));if(!v)return null;v.maintenanceRequired=normalized!=='completed';v.operationalState=normalized==='completed'?'INSPECTION':'MAINTENANCE';v.updatedAt=new Date().toISOString();return v;}
    const client=await pool.connect();try{await client.query('begin');const v=await client.query("select id,operational_state from vehicles where id=$1 and type::text<>'car' for update",[vehicleId]);if(!v.rows[0])return null;await client.query('insert into vehicle_maintenance(vehicle_id,status,notes,cost_paise,service_date,next_service_date,odometer_at_service,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[vehicleId,normalized,String(notes||'').slice(0,2000),Math.round(costNumber*100),serviceDate,nextServiceDate,odometerAtService,actorUserId||null]);const next=normalized==='completed'?'INSPECTION':'MAINTENANCE';await client.query('update vehicles set operational_state=$2,maintenance_required=$3,updated_at=now() where id=$1',[vehicleId,next,normalized!=='completed']);await client.query('insert into fleet_operation_audit(vehicle_id,actor_user_id,action,previous_state,next_state,details) values($1,$2,$3,$4,$5,$6)',[vehicleId,actorUserId||null,'maintenance_'+normalized,v.rows[0].operational_state,next,JSON.stringify({cost:costNumber})]);await client.query('commit');return getRideOnFleetVehicle(vehicleId);}catch(e){try{await client.query('rollback')}catch{}throw e;}finally{client.release();}
  }

  async function recordFleetInspection({vehicleId,bookingId=null,inspectionType='routine',odometer=null,fuelBattery=null,exteriorCondition='',damageNotes='',inspectionStatus='passed',conditionPhotos=[],actorUserId}) {
    if(!['pickup','return','maintenance','routine'].includes(inspectionType)||!['pending','passed','failed','damage_review'].includes(inspectionStatus)){const e=new Error('Invalid inspection data.');e.code='INVALID_INSPECTION';throw e;}
    if(!useDatabase){const v=memory.vehicles.get(String(vehicleId));if(!v)return null;v.currentOdometer=odometer??v.currentOdometer;v.currentFuelBattery=fuelBattery??v.currentFuelBattery;v.operationalState=inspectionStatus==='passed'?'AVAILABLE':'MAINTENANCE';return v;}
    const client=await pool.connect();try{await client.query('begin');const v=await client.query("select id,operational_state from vehicles where id=$1 and type::text<>'car' for update",[vehicleId]);if(!v.rows[0])return null;await client.query('insert into vehicle_inspections(vehicle_id,booking_id,inspection_type,odometer,fuel_battery,exterior_condition,damage_notes,inspection_status,condition_photos,inspected_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[vehicleId,bookingId,inspectionType,odometer,fuelBattery,String(exteriorCondition||'').slice(0,2000),String(damageNotes||'').slice(0,2000),inspectionStatus,conditionPhotos,actorUserId||null]);const next=inspectionStatus==='passed'?'AVAILABLE':'MAINTENANCE';await client.query('update vehicles set current_odometer=coalesce($2,current_odometer),current_fuel_battery=coalesce($3,current_fuel_battery),operational_state=$4,maintenance_required=$5,updated_at=now() where id=$1',[vehicleId,odometer,fuelBattery,next,next==='MAINTENANCE']);await client.query('insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,previous_state,next_state) values($1,$2,$3,\'inspection_completed\',$4,$5)',[vehicleId,bookingId,actorUserId||null,v.rows[0].operational_state,next]);await client.query('commit');return getRideOnFleetVehicle(vehicleId);}catch(e){try{await client.query('rollback')}catch{}throw e;}finally{client.release();}
  }

  async function assignFleetDeliveryStaff({bookingId,vehicleId,staffUserId,assignmentType='delivery',scheduledAt=null,actorUserId}) {
    const staff=await findCustomerById(staffUserId);if(!staff||staff.role!=='delivery_staff'){const e=new Error('Assigned user is not delivery staff.');e.code='INVALID_ASSIGNEE';throw e;}
    if(!useDatabase)return {id:crypto.randomUUID(),bookingId:String(bookingId),vehicleId:String(vehicleId),assignmentType,staffUserId:String(staffUserId),status:'assigned',scheduledAt};
    const b=await pool.query('select id,vehicle_id from bookings where id=$1 and vehicle_id=$2',[bookingId,vehicleId]);if(!b.rows[0]){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
    const q=await pool.query("insert into vehicle_assignments(booking_id,vehicle_id,assignment_type,staff_user_id,status,scheduled_at) values($1,$2,$3,$4,'assigned',$5) returning *",[bookingId,vehicleId,assignmentType,staffUserId,scheduledAt||null]);await pool.query('update bookings set assigned_staff_user_id=$2,scheduled_fulfillment_at=coalesce($3,scheduled_fulfillment_at),updated_at=now() where id=$1',[bookingId,staffUserId,scheduledAt||null]);await pool.query('insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,details) values($1,$2,$3,\'assignment_created\',$4)',[vehicleId,bookingId,actorUserId||null,JSON.stringify({staffUserId,assignmentType})]);return q.rows[0];
  }



  function mapDeliveryJob(row) {
    const vehicleImageUrls = Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : [];
    return {
      assignmentId: row.assignment_id ? String(row.assignment_id) : null,
      assignmentType: row.assignment_type || 'delivery',
      assignmentStatus: row.assignment_status || null,
      bookingId: String(row.booking_id),
      vehicleId: String(row.vehicle_id),
      vehicle: {
        id: String(row.vehicle_id),
        name: row.vehicle_name || 'RideOn vehicle',
        type: row.vehicle_type || 'bike',
        imageUrls: vehicleImageUrls,
        pickupLocation: row.pickup_location || null,
        pickupLatitude: row.pickup_latitude == null ? null : Number(row.pickup_latitude),
        pickupLongitude: row.pickup_longitude == null ? null : Number(row.pickup_longitude),
      },
      customerId: String(row.customer_id),
      customerName: row.customer_name || 'Customer',
      customerPhone: row.customer_phone || null,
      startAt: iso(row.start_at),
      endAt: iso(row.end_at),
      address: row.delivery_address || null,
      deliveryLatitude: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
      deliveryLongitude: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
      deliveryStatus: row.delivery_status || 'scheduled',
      lifecycleState: row.lifecycle_state || null,
      bookingStatus: row.booking_status || null,
      paymentStatus: row.payment_status || null,
      scheduledAt: iso(row.scheduled_at),
      pickupRequestedAt: iso(row.pickup_requested_at),
      deliveredAt: iso(row.delivered_at),
      assignedStaffUserId: row.assigned_staff_user_id ? String(row.assigned_staff_user_id) : null,
      returnRequestedAt: iso(row.return_requested_at),
      returnLocation: row.return_location || null,
      notes: row.customer_notes || null,
    };
  }

  async function listDeliveryJobs(staffUserId, { scope='available', limit=30, offset=0 }={}) {
    const safeLimit=Math.max(1,Math.min(100,Number(limit)||30));
    const safeOffset=Math.max(0,Number(offset)||0);
    if(!useDatabase) return [];
    const params=[safeLimit,safeOffset];
    if(String(scope)==='mine'){
      params.push(staffUserId);
      const {rows}=await pool.query(
        `select a.id as assignment_id,a.assignment_type,a.status as assignment_status,a.scheduled_at,
                b.id as booking_id,b.vehicle_id,b.customer_id,b.start_at,b.end_at,b.delivery_address,
                b.delivery_latitude,b.delivery_longitude,b.delivery_status,b.lifecycle_state,b.status as booking_status,
                b.payment_status,b.pickup_requested_at,b.delivered_at,b.assigned_staff_user_id,b.return_requested_at,b.return_location,b.customer_notes,
                c.name as customer_name,c.phone as customer_phone,
                v.name as vehicle_name,v.type as vehicle_type,v.image_urls,v.pickup_location,v.pickup_latitude,v.pickup_longitude
           from vehicle_assignments a
           join bookings b on b.id=a.booking_id
           join customers c on c.id=b.customer_id
           join vehicles v on v.id=a.vehicle_id
          where a.staff_user_id=$3
            and (a.status in ('assigned','started')
                 or (a.assignment_type='delivery' and a.status='completed' and b.delivery_status='delivered'
                     and not exists (select 1 from vehicle_assignments ap where ap.booking_id=b.id and ap.assignment_type='pickup' and ap.status<>'cancelled')))
          order by coalesce(a.scheduled_at,b.start_at) asc
          limit $1 offset $2`,
        params
      );
      return rows.map(mapDeliveryJob);
    }
    const {rows}=await pool.query(
      `select null::uuid as assignment_id,'delivery'::text as assignment_type,null::text as assignment_status,
              b.scheduled_fulfillment_at as scheduled_at,
              b.id as booking_id,b.vehicle_id,b.customer_id,b.start_at,b.end_at,b.delivery_address,
              b.delivery_latitude,b.delivery_longitude,b.delivery_status,b.lifecycle_state,b.status as booking_status,
              b.payment_status,b.pickup_requested_at,b.delivered_at,b.assigned_staff_user_id,b.return_requested_at,b.return_location,b.customer_notes,
              c.name as customer_name,c.phone as customer_phone,
              v.name as vehicle_name,v.type as vehicle_type,v.image_urls,v.pickup_location,v.pickup_latitude,v.pickup_longitude
         from bookings b
         join customers c on c.id=b.customer_id
         join vehicles v on v.id=b.vehicle_id
        where b.status='confirmed'
          and b.payment_status in ('paid','held','settlement_pending','settled')
          and b.delivery_required=true
          and b.delivery_status in ('scheduled','ready')
          and b.assigned_staff_user_id is null
          and not exists (
            select 1 from vehicle_assignments ax
             where ax.booking_id=b.id and ax.assignment_type='delivery'
               and ax.status in ('assigned','started')
          )
        order by coalesce(b.scheduled_fulfillment_at,b.start_at) asc
        limit $1 offset $2`,
      params
    );
    return rows.map(mapDeliveryJob);
  }

  async function acceptDeliveryJob(staffUserId, bookingId) {
    if(!useDatabase){const e=new Error('Delivery dispatch is unavailable.');e.code='DELIVERY_DISPATCH_UNAVAILABLE';throw e;}
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query(
        `select b.*,v.name as vehicle_name,v.type as vehicle_type
           from bookings b join vehicles v on v.id=b.vehicle_id
          where b.id=$1 for update`,[bookingId]);
      const b=rows[0];
      if(!b){const e=new Error('Delivery request not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(b.status!=='confirmed'||!b.delivery_required||!['paid','held','settlement_pending','settled'].includes(String(b.payment_status))){
        const e=new Error('This delivery is not ready to be accepted.');e.code='DELIVERY_NOT_READY';throw e;
      }
      if(b.assigned_staff_user_id && String(b.assigned_staff_user_id)!==String(staffUserId)){const e=new Error('This delivery has already been accepted.');e.code='DELIVERY_ALREADY_ASSIGNED';throw e;}
      const existing=await client.query("select id,staff_user_id,status from vehicle_assignments where booking_id=$1 and assignment_type='delivery' and status in ('assigned','started') for update",[bookingId]);
      if(existing.rows[0] && String(existing.rows[0].staff_user_id)!==String(staffUserId)){const e=new Error('This delivery has already been accepted.');e.code='DELIVERY_ALREADY_ASSIGNED';throw e;}
      let assignment=existing.rows[0];
      if(!assignment){
        const ins=await client.query("insert into vehicle_assignments(booking_id,vehicle_id,assignment_type,staff_user_id,status,scheduled_at) values($1,$2,'delivery',$3,'assigned',coalesce($4,$5)) returning *",[bookingId,b.vehicle_id,staffUserId,b.scheduled_fulfillment_at,b.start_at]);
        assignment=ins.rows[0];
      }
      await client.query("update bookings set assigned_staff_user_id=$2,scheduled_fulfillment_at=coalesce(scheduled_fulfillment_at,start_at),updated_at=now() where id=$1",[bookingId,staffUserId]);
      await client.query("insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,details) values($1,$2,$3,'delivery_job_accepted',$4)",[b.vehicle_id,bookingId,staffUserId,JSON.stringify({assignmentId:assignment.id})]);
      await client.query('commit');
      return {assignmentId:String(assignment.id),bookingId:String(bookingId),status:'assigned',staffUserId:String(staffUserId)};
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function startDeliveryForStaff(staffUserId, bookingId) {
    const now=new Date(); const expiresAt=new Date(now.getTime()+Math.max(30,Number(process.env.TRACKING_SESSION_MAX_MINUTES||180))*60000);
    if(!useDatabase){const e=new Error('Delivery dispatch is unavailable.');e.code='DELIVERY_DISPATCH_UNAVAILABLE';throw e;}
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query(`select b.*,v.owner_id from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1 for update`,[bookingId]);
      const b=rows[0];if(!b){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(String(b.assigned_staff_user_id)!==String(staffUserId)){const e=new Error('This delivery is not assigned to you.');e.code='DELIVERY_NOT_ASSIGNED';throw e;}
      if(b.status!=='confirmed'){const e=new Error('Delivery can only start after the booking is confirmed.');e.code='DELIVERY_START_NOT_ALLOWED';throw e;}
      if(!b.delivery_required||b.delivery_latitude==null||b.delivery_longitude==null||!String(b.delivery_address||'').trim()){const e=new Error('A valid delivery location is required before delivery can start.');e.code='DELIVERY_LOCATION_REQUIRED';throw e;}
      if(!['paid','held','settlement_pending','settled'].includes(String(b.payment_status))){const e=new Error('Payment must be confirmed before delivery can start.');e.code='PAYMENT_REQUIRED_FOR_DELIVERY';throw e;}
      const active=await client.query("select id from tracking_sessions where booking_id=$1 and status='active' for update",[bookingId]);
      if(active.rows[0]){const e=new Error('Delivery tracking is already active.');e.code='DELIVERY_ALREADY_ACTIVE';throw e;}
      const {rows:created}=await client.query("insert into tracking_sessions(booking_id,vendor_id,staff_user_id,status,expires_at) values($1,null,$2,'active',$3) returning *",[bookingId,staffUserId,expiresAt]);
      await client.query("update vehicle_assignments set status='started',updated_at=now() where booking_id=$1 and assignment_type='delivery' and staff_user_id=$2 and status='assigned'",[bookingId,staffUserId]);
      await client.query("update bookings set delivery_status='in_delivery',delivery_started_at=now(),lifecycle_state='DELIVERY_STARTED',updated_at=now() where id=$1",[bookingId]);
      await client.query("insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,next_state,details) values($1,$2,$3,'delivery_started','DELIVERY_STARTED',$4)",[b.vehicle_id,bookingId,staffUserId,JSON.stringify({trackingSessionId:created[0].id})]);
      await client.query('commit');
      return mapTrackingSession(created[0]);
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function getActiveTrackingSessionForStaff(staffUserId, bookingId) {
    if(!useDatabase) return null;
    const {rows}=await pool.query("select * from tracking_sessions where booking_id=$1 and staff_user_id=$2 and status='active' order by started_at desc limit 1",[bookingId,staffUserId]);
    return rows[0]?mapTrackingSession(rows[0]):null;
  }

  async function updateDeliveryLocationForStaff(staffUserId, bookingId, {latitude,longitude,accuracyMeters,recordedAt}={}) {
    const lat=Number(latitude),lon=Number(longitude),accuracy=accuracyMeters==null?null:Number(accuracyMeters),when=recordedAt?new Date(recordedAt):new Date();
    if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){const e=new Error('Invalid delivery location.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    if(accuracy!=null&&(!Number.isFinite(accuracy)||accuracy<0||accuracy>10000)){const e=new Error('Invalid GPS accuracy.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    if(Number.isNaN(when.getTime())||when.getTime()>Date.now()+120000){const e=new Error('Invalid location timestamp.');e.code='INVALID_DELIVERY_TIMESTAMP';throw e;}
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query("select ts.* from tracking_sessions ts where ts.booking_id=$1 and ts.staff_user_id=$2 and ts.status='active' for update",[bookingId,staffUserId]);
      const session=rows[0];if(!session){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      if(new Date(session.expires_at)<=new Date()){await client.query("update tracking_sessions set status='expired',ended_at=now() where id=$1",[session.id]);const e=new Error('Delivery tracking session expired.');e.code='TRACKING_SESSION_EXPIRED';throw e;}
      if(session.last_location_at&&when.getTime()<new Date(session.last_location_at).getTime()-5000){const e=new Error('Location update is older than the last accepted update.');e.code='STALE_LOCATION_UPDATE';throw e;}
      const {rows:updated}=await client.query("update tracking_sessions set last_latitude=$2,last_longitude=$3,last_accuracy_meters=$4,last_location_at=$5 where id=$1 returning *",[session.id,lat,lon,accuracy,when.toISOString()]);
      await client.query('commit');
      return mapTrackingSession(updated[0]);
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function completeDeliveryForStaff(staffUserId, bookingId, {latitude=null,longitude=null}={}) {
    const finalLat=latitude==null?null:Number(latitude),finalLon=longitude==null?null:Number(longitude);
    if((finalLat==null)!==(finalLon==null)||finalLat!=null&&(!Number.isFinite(finalLat)||finalLat<-90||finalLat>90)||finalLon!=null&&(!Number.isFinite(finalLon)||finalLon<-180||finalLon>180)){const e=new Error('Invalid final delivery location.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query("select ts.*,b.status as booking_status,b.vehicle_id from tracking_sessions ts join bookings b on b.id=ts.booking_id where ts.booking_id=$1 and ts.staff_user_id=$2 and ts.status='active' for update",[bookingId,staffUserId]);
      const ts=rows[0];if(!ts){const e=new Error('Delivery tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      if(new Date(ts.expires_at)<=new Date()){await client.query("update tracking_sessions set status='expired',ended_at=now() where id=$1",[ts.id]);const e=new Error('Delivery tracking session expired.');e.code='TRACKING_SESSION_EXPIRED';throw e;}
      if(ts.booking_status!=='confirmed'){const e=new Error('Delivery can no longer be completed.');e.code='DELIVERY_COMPLETION_NOT_ALLOWED';throw e;}
      const lat=finalLat??(ts.last_latitude==null?null:Number(ts.last_latitude)),lon=finalLon??(ts.last_longitude==null?null:Number(ts.last_longitude));
      await client.query("update tracking_sessions set status='completed',ended_at=now(),last_latitude=coalesce($2,last_latitude),last_longitude=coalesce($3,last_longitude),last_location_at=case when $2 is not null then now() else last_location_at end where id=$1",[ts.id,lat,lon]);
      await client.query("update vehicle_assignments set status='completed',updated_at=now() where booking_id=$1 and assignment_type='delivery' and staff_user_id=$2 and status in ('assigned','started')",[bookingId,staffUserId]);
      await client.query("update bookings set delivery_status='delivered',delivered_at=now(),delivery_final_latitude=$2,delivery_final_longitude=$3,lifecycle_state='ACTIVE_RENTAL',updated_at=now() where id=$1",[bookingId,lat,lon]);
      await client.query("insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,next_state,details) values($1,$2,$3,'delivery_completed','ACTIVE_RENTAL',$4)",[ts.vehicle_id,bookingId,staffUserId,JSON.stringify({trackingSessionId:ts.id})]);
      const {rows:bookingRows}=await client.query("select b.*,v.name as vehicle_name,v.type as vehicle_type,v.image_urls from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1",[bookingId]);
      await client.query('commit');
      return {booking:mapBooking(bookingRows[0]),session:mapTrackingSession({...ts,status:'completed',ended_at:new Date().toISOString(),last_latitude:lat,last_longitude:lon,last_location_at:lat==null?ts.last_location_at:new Date().toISOString()})};
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function startPickupForStaff(staffUserId, bookingId) {
    const now=new Date(); const expiresAt=new Date(now.getTime()+Math.max(30,Number(process.env.TRACKING_SESSION_MAX_MINUTES||180))*60000);
    if(!useDatabase){const e=new Error('Pickup dispatch is unavailable.');e.code='PICKUP_DISPATCH_UNAVAILABLE';throw e;}
    const client=await pool.connect();
    try{await client.query('begin');
      const {rows}=await client.query("select b.*,v.id as vehicle_id from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1 for update",[bookingId]);
      const b=rows[0];if(!b){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(String(b.assigned_staff_user_id)!==String(staffUserId)){const e=new Error('This pickup is not assigned to you.');e.code='DELIVERY_NOT_ASSIGNED';throw e;}
      const assignment=await client.query("select id,status from vehicle_assignments where booking_id=$1 and vehicle_id=$2 and assignment_type='pickup' and staff_user_id=$3 and status in ('assigned','started') order by created_at desc limit 1 for update",[bookingId,b.vehicle_id,staffUserId]);
      if(!assignment.rows[0]){const e=new Error('Request pickup first.');e.code='PICKUP_NOT_ASSIGNED';throw e;}
      if(!['ACTIVE_RENTAL','RETURN_REQUESTED'].includes(String(b.lifecycle_state))){const e=new Error('This rental is not ready for pickup.');e.code='PICKUP_NOT_READY';throw e;}
      const active=await client.query("select id from tracking_sessions where booking_id=$1 and status='active' for update",[bookingId]);
      if(active.rows[0]){const e=new Error('Pickup tracking is already active.');e.code='DELIVERY_ALREADY_ACTIVE';throw e;}
      const {rows:created}=await client.query("insert into tracking_sessions(booking_id,vendor_id,staff_user_id,status,expires_at) values($1,null,$2,'active',$3) returning *",[bookingId,staffUserId,expiresAt]);
      await client.query("update vehicle_assignments set status='started',updated_at=now() where id=$1",[assignment.rows[0].id]);
      await client.query("update bookings set lifecycle_state='PICKUP_STARTED',updated_at=now() where id=$1",[bookingId]);
      await client.query("insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,next_state,details) values($1,$2,$3,'pickup_started','PICKUP_STARTED',$4)",[b.vehicle_id,bookingId,staffUserId,JSON.stringify({trackingSessionId:created[0].id,assignmentId:assignment.rows[0].id})]);
      await client.query('commit'); return mapTrackingSession(created[0]);
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function completePickupForStaff(staffUserId, bookingId, {latitude=null,longitude=null,returnLocation=null,odometer=null,fuelBattery=null,returnedCondition='',damageNotes='',notes='',evidencePhotos=[]}={}) {
    const finalLat=latitude==null?null:Number(latitude),finalLon=longitude==null?null:Number(longitude);
    if((finalLat==null)!==(finalLon==null)||finalLat!=null&&(!Number.isFinite(finalLat)||finalLat<-90||finalLat>90)||finalLon!=null&&(!Number.isFinite(finalLon)||finalLon<-180||finalLon>180)){const e=new Error('Invalid final pickup location.');e.code='INVALID_DELIVERY_LOCATION';throw e;}
    if(odometer!=null&&(!Number.isInteger(Number(odometer))||Number(odometer)<0)){const e=new Error('Invalid odometer.');e.code='INVALID_RETURN_DETAILS';throw e;}
    if(fuelBattery!=null&&(!Number.isFinite(Number(fuelBattery))||Number(fuelBattery)<0||Number(fuelBattery)>100)){const e=new Error('Invalid fuel or battery level.');e.code='INVALID_RETURN_DETAILS';throw e;}
    const client=await pool.connect();
    try{await client.query('begin');
      const {rows}=await client.query("select ts.*,b.status as booking_status,b.vehicle_id,b.customer_id,b.return_location,b.end_at from tracking_sessions ts join bookings b on b.id=ts.booking_id where ts.booking_id=$1 and ts.staff_user_id=$2 and ts.status='active' for update",[bookingId,staffUserId]);
      const ts=rows[0];if(!ts){const e=new Error('Pickup tracking is not active.');e.code='TRACKING_NOT_ACTIVE';throw e;}
      if(new Date(ts.expires_at)<=new Date()){await client.query("update tracking_sessions set status='expired',ended_at=now() where id=$1",[ts.id]);const e=new Error('Pickup tracking session expired.');e.code='TRACKING_SESSION_EXPIRED';throw e;}
      if(ts.booking_status!=='confirmed'){const e=new Error('This booking cannot be returned through pickup.');e.code='RETURN_NOT_ALLOWED';throw e;}
      const assignment=await client.query("select id from vehicle_assignments where booking_id=$1 and vehicle_id=$2 and assignment_type='pickup' and staff_user_id=$3 and status='started' order by created_at desc limit 1 for update",[bookingId,ts.vehicle_id,staffUserId]);
      if(!assignment.rows[0]){const e=new Error('Pickup assignment is not active.');e.code='PICKUP_NOT_ASSIGNED';throw e;}
      const lat=finalLat??(ts.last_latitude==null?null:Number(ts.last_latitude)),lon=finalLon??(ts.last_longitude==null?null:Number(ts.last_longitude));const now=new Date();
      await client.query("update tracking_sessions set status='completed',ended_at=$2,last_latitude=coalesce($3,last_latitude),last_longitude=coalesce($4,last_longitude),last_location_at=case when $3 is not null then $2 else last_location_at end where id=$1",[ts.id,now.toISOString(),lat,lon]);
      await client.query("insert into rental_returns(booking_id,vehicle_id,customer_id,staff_user_id,requested_at,returned_at,return_location,odometer,fuel_battery,returned_condition,damage_notes,evidence_photos,notes) values($1,$2,$3,$4,(select return_requested_at from bookings where id=$1),$5,$6,$7,$8,$9,$10,$11,$12)",[bookingId,ts.vehicle_id,ts.customer_id,staffUserId,now.toISOString(),returnLocation||ts.return_location||null,odometer==null?null:Number(odometer),fuelBattery==null?null:Number(fuelBattery),String(returnedCondition||'').slice(0,2000),String(damageNotes||'').slice(0,2000),Array.isArray(evidencePhotos)?evidencePhotos.slice(0,12):[],String(notes||'').slice(0,2000)]);
      await client.query("update vehicle_assignments set status='completed',updated_at=now() where id=$1",[assignment.rows[0].id]);
      await client.query("update bookings set lifecycle_state='RETURNED',return_received_at=$2,return_location=coalesce($3,return_location),return_notes=coalesce($4,return_notes),updated_at=now() where id=$1",[bookingId,now.toISOString(),returnLocation||null,String(notes||'').slice(0,2000)||null]);
      await client.query("update vehicles set operational_state='RETURNED',current_odometer=coalesce($2,current_odometer),current_fuel_battery=coalesce($3,current_fuel_battery),updated_at=now() where id=$1",[ts.vehicle_id,odometer==null?null:Number(odometer),fuelBattery==null?null:Number(fuelBattery)]);
      await client.query("insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,next_state,details) values($1,$2,$3,'pickup_completed','RETURNED',$4)",[ts.vehicle_id,bookingId,staffUserId,JSON.stringify({trackingSessionId:ts.id,latitude:lat,longitude:lon})]);
      const {rows:bookingRows}=await client.query("select b.*,v.name as vehicle_name,v.type as vehicle_type,v.image_urls from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1",[bookingId]);
      await client.query('commit');return {booking:mapBooking(bookingRows[0]),session:mapTrackingSession({...ts,status:'completed',ended_at:now.toISOString(),last_latitude:lat,last_longitude:lon,last_location_at:lat==null?ts.last_location_at:now.toISOString()})};
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function requestPickupForStaff(staffUserId, bookingId) {
    if(!useDatabase){const e=new Error('Pickup dispatch is unavailable.');e.code='PICKUP_DISPATCH_UNAVAILABLE';throw e;}
    const client=await pool.connect();
    try{
      await client.query('begin');
      const {rows}=await client.query("select b.*,v.name as vehicle_name,v.type as vehicle_type from bookings b join vehicles v on v.id=b.vehicle_id where b.id=$1 for update",[bookingId]);
      const b=rows[0];if(!b){const e=new Error('Booking not found.');e.code='BOOKING_NOT_FOUND';throw e;}
      if(String(b.assigned_staff_user_id)!==String(staffUserId)){const e=new Error('Only the delivery rider assigned to this booking can request its pickup.');e.code='DELIVERY_NOT_ASSIGNED';throw e;}
      if(b.delivery_status!=='delivered'){const e=new Error('Pickup can be requested only after the vehicle has been delivered.');e.code='PICKUP_NOT_READY';throw e;}
      if(!['ACTIVE_RENTAL','RETURN_REQUESTED'].includes(String(b.lifecycle_state))){const e=new Error('This rental is not ready for pickup.');e.code='PICKUP_NOT_READY';throw e;}
      const existing=await client.query("select id,status from vehicle_assignments where booking_id=$1 and assignment_type='pickup' and status in ('assigned','started') for update",[bookingId]);
      if(existing.rows[0]){await client.query('commit');return {assignmentId:String(existing.rows[0].id),bookingId:String(bookingId),status:existing.rows[0].status};}
      const {rows:created}=await client.query("insert into vehicle_assignments(booking_id,vehicle_id,assignment_type,staff_user_id,status,scheduled_at) values($1,$2,'pickup',$3,'assigned',coalesce($4,now())) returning *",[bookingId,b.vehicle_id,staffUserId,b.return_requested_at||b.end_at]);
      await client.query("update bookings set pickup_requested_at=coalesce(pickup_requested_at,now()),pickup_requested_by=$2,lifecycle_state=case when lifecycle_state='ACTIVE_RENTAL' then 'RETURN_REQUESTED' else lifecycle_state end,updated_at=now() where id=$1",[bookingId,staffUserId]);
      await client.query("insert into fleet_operation_audit(vehicle_id,booking_id,actor_user_id,action,details) values($1,$2,$3,'pickup_requested',$4)",[b.vehicle_id,bookingId,staffUserId,JSON.stringify({assignmentId:created[0].id})]);
      await client.query('commit');
      return {assignmentId:String(created[0].id),bookingId:String(bookingId),status:'assigned',scheduledAt:iso(created[0].scheduled_at)};
    }catch(error){try{await client.query('rollback')}catch{};throw error;}finally{client.release();}
  }

  async function listConditionEvidence(bookingId) {
    if(!useDatabase) return [];
    const {rows}=await pool.query(`select e.*,c.full_name as actor_name from rental_condition_evidence e left join customers c on c.id=e.actor_user_id where e.booking_id=$1 order by e.phase asc,e.created_at asc`,[bookingId]);
    return rows.map(row=>({id:String(row.id),bookingId:String(row.booking_id),vehicleId:String(row.vehicle_id),phase:row.phase,actorUserId:String(row.actor_user_id),actorRole:row.actor_role,actorName:row.actor_name||null,mediaType:row.media_type,bucket:row.storage_bucket,path:row.storage_path,url:row.media_url,contentType:row.content_type,fileSizeBytes:Number(row.file_size_bytes),capturedAt:iso(row.captured_at),latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude),metadata:row.metadata||{},createdAt:iso(row.created_at)}));
  }

  async function addConditionEvidence({bookingId,vehicleId,actorUserId,actorRole,phase,mediaType,bucket,storagePath,mediaUrl,contentType,fileSizeBytes,capturedAt=null,latitude=null,longitude=null,metadata={}}) {
    if(!useDatabase) return {id:crypto.randomUUID(),bookingId:String(bookingId),vehicleId:String(vehicleId),phase,actorUserId:String(actorUserId),actorRole,mediaType,bucket,path:storagePath,url:mediaUrl,contentType,fileSizeBytes,capturedAt};
    const {rows}=await pool.query(`insert into rental_condition_evidence
      (booking_id,vehicle_id,actor_user_id,actor_role,phase,media_type,storage_bucket,storage_path,media_url,content_type,file_size_bytes,captured_at,latitude,longitude,metadata)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [bookingId,vehicleId,actorUserId,actorRole,phase,mediaType,bucket,storagePath,mediaUrl,contentType,fileSizeBytes,capturedAt,latitude,longitude,metadata||{}]);
    const row=rows[0];
    return {id:String(row.id),bookingId:String(row.booking_id),vehicleId:String(row.vehicle_id),phase:row.phase,actorUserId:String(row.actor_user_id),actorRole:row.actor_role,mediaType:row.media_type,bucket:row.storage_bucket,path:row.storage_path,url:row.media_url,contentType:row.content_type,fileSizeBytes:Number(row.file_size_bytes),capturedAt:iso(row.captured_at),latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude),metadata:row.metadata||{},createdAt:iso(row.created_at)};
  }

  async function upsertConditionReport({bookingId,vehicleId,actorUserId,actorRole,phase,conditionStatus,damageNotes='',odometer=null,fuelBattery=null,evidenceCount=0,acknowledged=false,capturedAt=null,latitude=null,longitude=null,metadata={}}) {
    const allowed=['no_damage','existing_damage','new_damage','damage_review'];
    if(!allowed.includes(String(conditionStatus))){const e=new Error('Invalid vehicle condition status.');e.code='INVALID_CONDITION_STATUS';throw e;}
    if(!useDatabase) return {id:crypto.randomUUID(),bookingId:String(bookingId),vehicleId:String(vehicleId),phase,conditionStatus,damageNotes,evidenceCount,acknowledged};
    const {rows}=await pool.query(`insert into rental_condition_reports
      (booking_id,vehicle_id,actor_user_id,actor_role,phase,condition_status,damage_notes,odometer,fuel_battery,evidence_count,acknowledged,captured_at,latitude,longitude,metadata)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,now()),$13,$14,$15)
      on conflict(booking_id,phase,actor_user_id) do update set
        condition_status=excluded.condition_status,damage_notes=excluded.damage_notes,odometer=excluded.odometer,
        fuel_battery=excluded.fuel_battery,evidence_count=excluded.evidence_count,acknowledged=excluded.acknowledged,
        captured_at=excluded.captured_at,latitude=excluded.latitude,longitude=excluded.longitude,metadata=excluded.metadata
      returning *`,
      [bookingId,vehicleId,actorUserId,actorRole,phase,conditionStatus,String(damageNotes||'').slice(0,4000),odometer==null?null:Number(odometer),fuelBattery==null?null:Number(fuelBattery),Number(evidenceCount)||0,Boolean(acknowledged),capturedAt,latitude,longitude,metadata||{}]);
    const row=rows[0];
    if(phase==='delivery') await pool.query('update bookings set delivery_condition_status=$2,updated_at=now() where id=$1',[bookingId,conditionStatus]);
    if(phase==='pickup') await pool.query('update bookings set pickup_condition_status=$2,updated_at=now() where id=$1',[bookingId,conditionStatus]);
    if(phase==='pickup') await pool.query('update rental_returns set customer_condition_status=$2,customer_evidence_count=$3 where booking_id=$1 and customer_id=$4',[bookingId,conditionStatus,Number(evidenceCount)||0,actorUserId]);
    return {id:String(row.id),bookingId:String(row.booking_id),vehicleId:String(row.vehicle_id),phase:row.phase,actorUserId:String(row.actor_user_id),actorRole:row.actor_role,conditionStatus:row.condition_status,damageNotes:row.damage_notes||'',odometer:row.odometer==null?null:Number(row.odometer),fuelBattery:row.fuel_battery==null?null:Number(row.fuel_battery),evidenceCount:Number(row.evidence_count||0),acknowledged:Boolean(row.acknowledged),capturedAt:iso(row.captured_at),latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude),metadata:row.metadata||{}};
  }

  async function listConditionReports(bookingId) {
    if(!useDatabase) return [];
    const {rows}=await pool.query('select r.*,c.full_name as actor_name from rental_condition_reports r left join customers c on c.id=r.actor_user_id where r.booking_id=$1 order by r.phase,r.created_at',[bookingId]);
    return rows.map(row=>({id:String(row.id),bookingId:String(row.booking_id),vehicleId:String(row.vehicle_id),phase:row.phase,actorUserId:String(row.actor_user_id),actorRole:row.actor_role,actorName:row.actor_name||null,conditionStatus:row.condition_status,damageNotes:row.damage_notes||'',odometer:row.odometer==null?null:Number(row.odometer),fuelBattery:row.fuel_battery==null?null:Number(row.fuel_battery),evidenceCount:Number(row.evidence_count||0),acknowledged:Boolean(row.acknowledged),capturedAt:iso(row.captured_at),latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude),metadata:row.metadata||{}}));
  }

  async function getKycStatus(customerId) {
    if (!useDatabase) {
      const customer = memory.customers.get(String(customerId));
      return customer ? { status: customer.kycStatus || 'UNVERIFIED', activeKycId: customer.activeKycId || null } : null;
    }
    const { rows } = await pool.query(
      'select id,kyc_status,active_kyc_id from public.customers where id=$1',
      [customerId]
    );
    return rows[0] ? { customerId:String(rows[0].id), status:rows[0].kyc_status || 'UNVERIFIED', activeKycId:rows[0].active_kyc_id ? String(rows[0].active_kyc_id) : null } : null;
  }

  async function createKycVerification({ clientId='rideon_internal', externalUserId, documentType, documentHash, provider }) {
    if (!useDatabase) {
      const id=crypto.randomUUID();
      const row={id,clientId,externalUserId:String(externalUserId),documentType,documentHash:documentHash||null,documentStatus:'PENDING',ocrDataExtracted:{},livenessScore:null,faceMatchScore:null,governmentRefId:null,provider:provider||null,providerVerificationId:null,providerEventId:null,decisionReason:null,submittedAt:new Date().toISOString(),verifiedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      memory.kycVerifications.set(id,row);
      const customer=memory.customers.get(String(externalUserId)); if(customer){customer.kycStatus='PENDING';customer.activeKycId=id;}
      return row;
    }
    const client=await pool.connect();
    try {
      await client.query('begin');
      const user=await client.query('select id from public.customers where id=$1 for update',[externalUserId]);
      if(!user.rows[0]) { const e=new Error('Customer not found.'); e.code='CUSTOMER_NOT_FOUND'; throw e; }
      const { rows }=await client.query(
        `insert into kyc_core.verifications(client_id,external_user_id,document_type,document_hash,document_status,provider)
         values($1,$2,$3,$4,'PENDING',$5)
         returning *`,
        [clientId,externalUserId,documentType,documentHash||null,provider||null]
      );
      await client.query('update public.customers set kyc_status=$2,active_kyc_id=$3,updated_at=now() where id=$1',[externalUserId,'PENDING',rows[0].id]);
      await client.query('commit');
      return mapKycVerification(rows[0]);
    } catch(error) { try{await client.query('rollback');}catch{}; throw error; } finally { client.release(); }
  }

  const mapKycVerification = (row) => row && ({
    id:String(row.id),
    clientId:row.client_id,
    externalUserId:String(row.external_user_id),
    documentType:row.document_type,
    documentHash:row.document_hash || null,
    documentStatus:row.document_status,
    ocrDataExtracted:row.ocr_data_extracted || {},
    livenessScore:row.liveness_score == null ? null : Number(row.liveness_score),
    faceMatchScore:row.face_match_score == null ? null : Number(row.face_match_score),
    governmentRefId:row.government_ref_id || null,
    provider:row.provider || null,
    providerVerificationId:row.provider_verification_id || null,
    providerEventId:row.provider_event_id || null,
    decisionReason:row.decision_reason || null,
    submittedAt:iso(row.submitted_at),
    verifiedAt:iso(row.verified_at),
    createdAt:iso(row.created_at),
    updatedAt:iso(row.updated_at),
  });

  async function getKycVerification(id, customerId) {
    if (!useDatabase) {
      const row=memory.kycVerifications.get(String(id));
      return row && String(row.externalUserId)===String(customerId) ? row : null;
    }
    const { rows }=await pool.query(
      'select * from kyc_core.verifications where id=$1 and external_user_id=$2',
      [id,customerId]
    );
    return rows[0] ? mapKycVerification(rows[0]) : null;
  }

  async function findKycVerificationById(id) {
    if (!useDatabase) return memory.kycVerifications.get(String(id)) || null;
    const { rows }=await pool.query('select * from kyc_core.verifications where id=$1 limit 1',[id]);
    return rows[0] ? mapKycVerification(rows[0]) : null;
  }

  async function findKycVerificationByProviderReference({ provider, providerVerificationId }) {
    if (!providerVerificationId) return null;
    if (!useDatabase) {
      return [...memory.kycVerifications.values()].find(v=>String(v.provider||'')===String(provider||'') && String(v.providerVerificationId||'')===String(providerVerificationId)) || null;
    }
    const { rows }=await pool.query(
      'select * from kyc_core.verifications where provider=$1 and provider_verification_id=$2 limit 1',
      [provider,providerVerificationId]
    );
    return rows[0] ? mapKycVerification(rows[0]) : null;
  }

  async function findKycVerificationByProviderEvent(providerEventId) {
    if (!providerEventId) return null;
    if (!useDatabase) return [...memory.kycVerifications.values()].find(v=>String(v.providerEventId||'')===String(providerEventId)) || null;
    const { rows }=await pool.query('select * from kyc_core.verifications where provider_event_id=$1 limit 1',[providerEventId]);
    return rows[0] ? mapKycVerification(rows[0]) : null;
  }

  async function isKycBlacklisted(documentHash) {
    if (!documentHash) return false;
    if (!useDatabase) return memory.kycBlacklist.has(String(documentHash));
    const { rowCount }=await pool.query('select 1 from kyc_core.global_blacklist where document_hash=$1 limit 1',[documentHash]);
    return rowCount>0;
  }

  async function addKycBlacklist({ documentHash, reason }) {
    if (!documentHash) throw Object.assign(new Error('Document hash is required.'),{code:'INVALID_DOCUMENT_HASH'});
    if (!useDatabase) {
      const row={documentHash:String(documentHash),reason:String(reason||'Risk policy violation'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      memory.kycBlacklist.set(String(documentHash),row); return row;
    }
    const { rows }=await pool.query(
      `insert into kyc_core.global_blacklist(document_hash,reason)
       values($1,$2)
       on conflict(document_hash) do update set reason=excluded.reason,updated_at=now()
       returning id,document_hash,reason,created_at,updated_at`,
      [documentHash,String(reason||'Risk policy violation')]
    );
    return rows[0];
  }

  async function applyKycVerificationResult({ verificationId, status, ocrDataExtracted={}, livenessScore=null, faceMatchScore=null, governmentRefId=null, providerVerificationId=null, providerEventId=null, decisionReason=null, blacklist=false }) {
    const finalStatus=String(status||'PENDING').toUpperCase();
    if(!['PENDING','APPROVED','REJECTED'].includes(finalStatus)) throw Object.assign(new Error('Invalid KYC verification status.'),{code:'INVALID_KYC_STATUS'});
    if(!useDatabase) {
      const row=memory.kycVerifications.get(String(verificationId)); if(!row) return null;
      if(providerEventId && row.providerEventId && row.providerEventId===providerEventId) return {verification:row,duplicate:true};
      Object.assign(row,{documentStatus:finalStatus,ocrDataExtracted:ocrDataExtracted||{},livenessScore:livenessScore==null?null:Number(livenessScore),faceMatchScore:faceMatchScore==null?null:Number(faceMatchScore),governmentRefId:governmentRefId||null,providerVerificationId:providerVerificationId||row.providerVerificationId,providerEventId:providerEventId||row.providerEventId,decisionReason:decisionReason||null,verifiedAt:finalStatus==='APPROVED'||finalStatus==='REJECTED'?new Date().toISOString():null,updatedAt:new Date().toISOString()});
      const customer=memory.customers.get(String(row.externalUserId)); if(customer){const customerStatus=blacklist?'BLACKLISTED':finalStatus==='APPROVED'?'VERIFIED':finalStatus;customer.kycStatus=customerStatus;customer.activeKycId=customerStatus==='VERIFIED'?row.id:(customer.activeKycId===row.id?null:customer.activeKycId);}
      return {verification:row,duplicate:false};
    }
    const client=await pool.connect();
    try {
      await client.query('begin');
      const current=await client.query('select * from kyc_core.verifications where id=$1 for update',[verificationId]);
      if(!current.rows[0]) { await client.query('rollback'); return null; }
      if(providerEventId){
        const prior=await client.query('select id from kyc_core.verifications where provider_event_id=$1 and id<>$2 limit 1',[providerEventId,verificationId]);
        if(prior.rows[0]) { await client.query('commit'); return {verification:mapKycVerification(current.rows[0]),duplicate:true}; }
      }
      const verifiedAt=finalStatus==='APPROVED'||finalStatus==='REJECTED'?'now()':'null';
      const { rows }=await client.query(
        `update kyc_core.verifications
         set document_status=$2,ocr_data_extracted=$3,liveness_score=$4,face_match_score=$5,
             government_ref_id=coalesce($6,government_ref_id),
             provider_verification_id=coalesce($7,provider_verification_id),
             provider_event_id=coalesce($8,provider_event_id),
             decision_reason=$9,
             verified_at=${verifiedAt},
             updated_at=now()
         where id=$1
         returning *`,
        [verificationId,finalStatus,ocrDataExtracted||{},livenessScore,faceMatchScore,governmentRefId,providerVerificationId,providerEventId,decisionReason]
      );
      const blacklistStatus=blacklist?'BLACKLISTED':finalStatus==='APPROVED'?'VERIFIED':finalStatus;
      await client.query(
        `update public.customers
         set kyc_status=$2,
             active_kyc_id=case when $2='VERIFIED' then $3 else case when active_kyc_id=$3 then null else active_kyc_id end end,
             updated_at=now()
         where id=$1`,
        [current.rows[0].external_user_id,blacklistStatus,verificationId]
      );
      await client.query('commit');
      return {verification:mapKycVerification(rows[0]),duplicate:false};
    } catch(error) {
      try{await client.query('rollback');}catch{}
      if(error?.code==='23505' && providerEventId){
        const duplicate=await pool.query('select * from kyc_core.verifications where provider_event_id=$1 limit 1',[providerEventId]);
        if(duplicate.rows[0]) return {verification:mapKycVerification(duplicate.rows[0]),duplicate:true};
      }
      throw error;
    } finally { client.release(); }
  }

  return {health,close,settleFleetSecurityDeposit,applyDepositRefundEvent,getCancellationPreview,listVehicles,listLocations,listRideOnFleet,getRideOnFleetVehicle,listRideOnFleetAdmin,getRideOnFleetDashboard,createRideOnFleetVehicle,updateRideOnFleetVehicle,setRideOnFleetVehicleState,recordFleetMaintenance,recordFleetInspection,assignFleetDeliveryStaff,listDeliveryJobs,acceptDeliveryJob,startDeliveryForStaff,getActiveTrackingSessionForStaff,updateDeliveryLocationForStaff,updateTrackingRouteForStaff,completeDeliveryForStaff,requestPickupForStaff,startPickupForStaff,completePickupForStaff,getVehicle,createCustomer,createOrLinkCustomerFromSupabase,findCustomerBySupabaseUserId,findCustomerByPhone,findCustomerByEmail,findCustomerById,findVendorByCustomerId,ensureVendorForCustomer,updateVendor,updateVendorServiceLocation,getVendorServiceLocation,listMarketplaceVendors,getPublicVendorProfile,listPublicVendorVehicles,quoteMultiVehicle,createFleetOrder,loadFleetOrderTx,getFleetOrder,listCustomerFleetOrders,listVendorVehicles,getVendorVehicle,createVendorVehicle,updateVendorVehicle,deactivateVendorVehicle,listVendorBookings,listVendorFleetOrders,updateFleetOrderStatus,getVendorBooking,updateVendorBookingStatus,checkVehicleAvailability,getVehicleState,isVehicleUnavailable,createBooking,getBooking,updateBookingRouteData,startDelivery,updateDeliveryLocation,getActiveTrackingSession,updateTrackingRoute,getTrackingForCustomer,completeDelivery,abortDelivery,listCustomerBookings,cancelBooking,markPaymentRefundPending,claimRefundRequest,markRefundRetryable,completePaymentRefund,applyPaymentEvent,withPaymentLock,findPaymentById,findPaymentByProviderOrder,findPaymentByBooking,createOrGetPaymentOrder,createFleetOrderPayment,submitPaymentReference,verifyPayment,refundPayment,createOtp,consumeLatestOtp,incrementOtpAttempt,recordSecurityDepositInspection,seedMemoryVehicles,createSupportTicket,listMySupportTickets,getSupportTicket,listSupportMessages,addSupportMessage,closeSupportTicket,reopenSupportTicket,listSupportTickets,assignSupportTicket,updateSupportTicketStatus,resolveSupportTicket,getKycStatus,createKycVerification,getKycVerification,findKycVerificationById,findKycVerificationByProviderReference,findKycVerificationByProviderEvent,isKycBlacklisted,addKycBlacklist,applyKycVerificationResult,listConditionEvidence,addConditionEvidence,upsertConditionReport,listConditionReports};
}