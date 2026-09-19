import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*'}));
app.use(express.json({ limit: '32kb' }));

const fleet = [
  { id:'creta-01', type:'car', name:'Hyundai Creta', subtitle:'Automatic · 5 seats · Petrol', pricePerDay:2499, city:'Jaipur', seats:5, transmission:'Automatic', fuel:'Petrol', active:true },
  { id:'baleno-01', type:'car', name:'Maruti Baleno', subtitle:'Manual · 5 seats · Petrol', pricePerDay:1499, city:'Jaipur', seats:5, transmission:'Manual', fuel:'Petrol', active:true },
  { id:'classic-01', type:'bike', name:'Royal Enfield Classic 350', subtitle:'349 cc · 2 helmets included', pricePerDay:999, city:'Jaipur', active:true },
  { id:'activa-01', type:'bike', name:'Honda Activa 6G', subtitle:'Automatic · 2 seats · Petrol', pricePerDay:499, city:'Jaipur', active:true }
];
const bookings = new Map();
const bookingSchema = z.object({ customerName:z.string().trim().min(2).max(100), phone:z.string().trim().regex(/^\+?[0-9]{10,15}$/), vehicleId:z.string().min(1), startAt:z.string().datetime(), endAt:z.string().datetime(), delivery:z.boolean().default(true), address:z.string().trim().min(8).max(300), notes:z.string().max(500).optional() }).refine(x => new Date(x.endAt) > new Date(x.startAt), { message:'endAt must be after startAt', path:['endAt'] });
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

app.get('/health', (_req,res) => res.json({ status:'ok', service:'rideon-api', timestamp:new Date().toISOString() }));
app.get('/api/v1/vehicles', (req,res) => {
  const type = req.query.type?.toString().toLowerCase();
  const city = req.query.city?.toString().toLowerCase();
  const q = req.query.q?.toString().toLowerCase();
  const result = fleet.filter(v => v.active && (!type || type === 'all' || v.type === type) && (!city || v.city.toLowerCase() === city) && (!q || `${v.name} ${v.subtitle}`.toLowerCase().includes(q)));
  res.json({ data:result, meta:{ count:result.length, currency:'INR' } });
});
app.get('/api/v1/vehicles/:id', (req,res) => { const vehicle=fleet.find(v=>v.id===req.params.id && v.active); if(!vehicle) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND',message:'Vehicle not found'}}); res.json({data:vehicle}); });
app.post('/api/v1/bookings/quote', (req,res) => {
  const schema=z.object({vehicleId:z.string(),startAt:z.string().datetime(),endAt:z.string().datetime(),delivery:z.boolean().default(true)});
  const parsed=schema.safeParse(req.body); if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});
  const v=fleet.find(x=>x.id===parsed.data.vehicleId && x.active); if(!v) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND'}});
  const ms=new Date(parsed.data.endAt)-new Date(parsed.data.startAt); if(ms<=0) return res.status(400).json({error:{code:'INVALID_DATES',message:'End must be after start'}});
  const days=Math.max(1,Math.ceil(ms/86400000)); const rental=v.pricePerDay*days; const deliveryFee=parsed.data.delivery?199:0; const platformFee=Math.round(rental*.05); res.json({data:{vehicleId:v.id,days,rental,deliveryFee,platformFee,total:rental+deliveryFee+platformFee,currency:'INR',disclaimer:'Demo estimate; availability and final fees must be confirmed.'}});
});
app.post('/api/v1/bookings', (req,res) => {
  const parsed=bookingSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',details:parsed.error.flatten()}});
  const v=fleet.find(x=>x.id===parsed.data.vehicleId && x.active); if(!v) return res.status(404).json({error:{code:'VEHICLE_NOT_FOUND'}});
  const start=new Date(parsed.data.startAt), end=new Date(parsed.data.endAt); if(end<=start) return res.status(400).json({error:{code:'INVALID_DATES'}});
  const days=Math.max(1,Math.ceil((end-start)/86400000)); const rental=v.pricePerDay*days; const deliveryFee=parsed.data.delivery?199:0; const platformFee=Math.round(rental*.05);
  const booking={id:randomUUID(),...parsed.data,vehicle:{id:v.id,name:v.name,type:v.type},pricing:{days,rental,deliveryFee,platformFee,total:rental+deliveryFee+platformFee,currency:'INR'},status:'requested',paymentStatus:'unpaid',createdAt:new Date().toISOString()}; bookings.set(booking.id,booking); res.status(201).json({data:booking});
});
app.get('/api/v1/bookings/:id', (req,res) => { const b=bookings.get(req.params.id); if(!b) return res.status(404).json({error:{code:'BOOKING_NOT_FOUND'}}); res.json({data:b}); });
app.patch('/api/v1/bookings/:id/cancel', (req,res) => { const b=bookings.get(req.params.id); if(!b) return res.status(404).json({error:{code:'BOOKING_NOT_FOUND'}}); if(!['requested','confirmed'].includes(b.status)) return res.status(409).json({error:{code:'CANNOT_CANCEL',message:'This booking can no longer be cancelled through this endpoint'}}); b.status='cancelled'; b.updatedAt=new Date().toISOString(); res.json({data:b}); });
app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Route not found'}}));
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unexpected server error'}}); });
const port=Number(process.env.PORT)||4000;
if(process.env.NODE_ENV!=='test') app.listen(port,()=>console.log(`RideOn API listening on :${port}`));
export { app };
