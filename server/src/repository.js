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
  const memory = { customers:new Map(), bookings:new Map(), idempotency:new Map(), paymentEvents:new Map(), payments:new Map(), vendors:new Map(), vehicles:new Map(), securityDeposits:new Map(),trackingSessions:new Map() };

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
        const {rows}=await client.query('insert into bookings (customer_id,vehicle_id,vendor_id,start_at,end_at,delivery_required,delivery_address,delivery_latitude,delivery_longitude,vendor_service_latitude,vendor_service_longitude,delivery_fee_paise,rental_total_paise,platform_fee_paise,security_deposit_paise,total_paise,status,payment_status,customer_notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,\'requested\',\'unpaid\',$17) returning *',[input.customerId,input.vehicle.id,vehicleCheck.rows[0].owner_id||null,input.startAt,input.endAt,input.delivery,input.address,deliveryLatitude,deliveryLongitude,vendorServiceLatitude,vendorServiceLongitude,Math.round(input.pricing.deliveryFee * 100),Math.round(input.pricing.rental * 100),Math.round(input.pricing.platformFee * 100),Math.round((input.pricing.securityDeposit||0) * 100),Math.round(input.pricing.total * 100),input.notes||null]);
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

  const mapTrackingSession=(row)=>row&&({id:String(row.id),bookingId:String(row.booking_id),vendorId:String(row.vendor_id),status:row.status,startedAt:iso(row.started_at),endedAt:iso(row.ended_at),lastLatitude:row.last_latitude==null?null:Number(row.last_latitude),lastLongitude:row.last_longitude==null?null:Number(row.last_longitude),lastAccuracyMeters:row.last_accuracy_meters==null?null:Number(row.last_accuracy_meters),lastLocationAt:iso(row.last_location_at),lastRouteDistanceMeters:row.last_route_distance_meters==null?null:Number(row.last_route_distance_meters),lastRouteDurationSeconds:row.last_route_duration_seconds==null?null:Number(row.last_route_duration_seconds),lastRoutePolyline:row.last_route_polyline||null,lastRouteAt:iso(row.last_route_at),expiresAt:iso(row.expires_at)});

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
      const resolvedBookingId = event.bookingId || String(payment.booking_id);
      if (event.providerOrderId && String(payment.provider_order_id) !== String(event.providerOrderId)) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
      const bookingResult = await client.query('select id,payment_status,total_paise from bookings where id=$1 for update',[resolvedBookingId]);
      if (!bookingResult.rows[0]) {
        await client.query('rollback');
        return { applied:false, duplicate:false, invalid:true };
      }
      const booking = bookingResult.rows[0];
      if (event.status==='paid' && !['requested','confirmed'].includes(String(booking.status))) { await client.query('rollback'); return { applied:false, duplicate:false, invalid:true }; }
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
      if(event.status==='paid') await client.query("update security_deposits set status='held',updated_at=now() where booking_id=$1 and status in ('pending','held')",[resolvedBookingId]);
      if(event.status==='refund_pending') await client.query("update security_deposits set status='refund_pending',updated_at=now() where booking_id=$1 and status in ('held','refund_pending')",[resolvedBookingId]);
      if(event.status==='refunded') await client.query("update security_deposits set status='refunded',refund_provider_reference=$2,refunded_at=now(),updated_at=now() where booking_id=$1 and status in ('held','refund_pending','release_pending')",[resolvedBookingId,event.providerReference]);
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

  return {health,close,getCancellationPreview,listVehicles,listLocations,getVehicle,createCustomer,createOrLinkCustomerFromSupabase,findCustomerBySupabaseUserId,findCustomerByPhone,findCustomerByEmail,findCustomerById,findVendorByCustomerId,ensureVendorForCustomer,updateVendor,updateVendorServiceLocation,getVendorServiceLocation,listMarketplaceVendors,listVendorVehicles,getVendorVehicle,createVendorVehicle,updateVendorVehicle,deactivateVendorVehicle,listVendorBookings,getVendorBooking,updateVendorBookingStatus,checkVehicleAvailability,getVehicleState,isVehicleUnavailable,createBooking,getBooking,updateBookingRouteData,startDelivery,updateDeliveryLocation,getActiveTrackingSession,updateTrackingRoute,getTrackingForCustomer,completeDelivery,abortDelivery,listCustomerBookings,cancelBooking,markPaymentRefundPending,claimRefundRequest,markRefundRetryable,completePaymentRefund,applyPaymentEvent,withPaymentLock,findPaymentById,findPaymentByProviderOrder,findPaymentByBooking,createOrGetPaymentOrder,submitPaymentReference,verifyPayment,refundPayment,createOtp,consumeLatestOtp,incrementOtpAttempt,recordSecurityDepositInspection,seedMemoryVehicles};
}
