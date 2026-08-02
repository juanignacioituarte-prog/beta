const SUPABASE_URL = 'https://adzglgpoqfjtgbpeiudf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemdsZ3BvcWZqdGdicGVpdWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Njg5NzUsImV4cCI6MjEwMTA0NDk3NX0.vc4tTP0fGvSoiVvJiSwzu0c3oh-Vf5DVvKjGDWbWF2o';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const originalFetch = window.fetch;
window.fetch = async function(resource, config) {
    if (typeof resource === 'string' && resource.includes('controlpanel-alpha.vercel.app')) {
        const url = new URL(resource);
        const path = url.pathname;
        const type = url.searchParams.get('type');
        const farmId = url.searchParams.get('farmId') || 'c7972aad-664f-43ad-934d-d88708d3e315';
        
        console.log('Intercepted Vercel request:', path, type, config?.method);

        try {
            if (path.includes('/api/beta/paddocks')) {
                const { data } = await supabase.from('Paddock').select('*').eq('farmId', farmId);
                const featureCollection = {
                    type: "FeatureCollection",
                    name: "Paddocks",
                    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
                    features: (data || []).map(p => ({
                        type: "Feature",
                        properties: { id: p.id, name: p.name },
                        geometry: p.boundary ? JSON.parse(p.boundary) : null
                    }))
                };
                return new Response(JSON.stringify(featureCollection));
            }

            if (path.includes('/api/beta/ndvi')) {
                const { data } = await supabase.from('PastureRecord')
                    .select('ndvi, date, Paddock!inner(name, farmId)')
                    .eq('type', 'SATELLITE')
                    .eq('Paddock.farmId', farmId);
                
                let csv = 'paddock_name,date,ndvi_mean,cloud_pc,map_id\n';
                data?.forEach(r => {
                    const d = new Date(r.date);
                    const dateStr = `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth()+1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
                    csv += `${r.Paddock.name},${dateStr},${r.ndvi || ""},0,\n`;
                });
                return new Response(csv);
            }

            if (path.includes('/api/beta/exclusions')) {
                const { data } = await supabase.from('PaddockExclusion').select('*').eq('farmId', farmId);
                let csv = 'paddock,reason\n';
                data?.forEach(e => csv += `${e.paddockName},${e.reason}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/beta/partial')) {
                const { data } = await supabase.from('PaddockPartial').select('*').eq('farmId', farmId);
                let csv = 'paddock,status\n';
                data?.forEach(e => csv += `${e.paddockName},${e.status}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/beta/cal')) {
                const { data } = await supabase.from('Calibration').select('*').eq('farmId', farmId);
                let csv = 'paddock_name,measured_cover,date\n';
                data?.forEach(c => {
                    let dateStr = '';
                    if (c.date) {
                        const d = new Date(c.date);
                        dateStr = `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth()+1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
                    }
                    csv += `${c.paddockName},${c.measuredCover ?? ''},${dateStr}\n`;
                });
                csv += '#N/A,,\n';
                return new Response(csv);
            }

            if (path.includes('/api/beta/manual')) {
                const { data } = await supabase.from('ManualMode').select('*').eq('farmId', farmId);
                let csv = '';
                if (data && data.length > 0) {
                    csv = data[0].data; // Assuming stored as CSV string in data field based on manual logic
                }
                return new Response(csv);
            }

            if (path.includes('/api/beta/feed')) {
                const { data } = await supabase.from('FeedSetting').select('*').eq('farmId', farmId);
                let csv = 'Setting,Value\n';
                data?.forEach(f => csv += `${f.key},${f.value}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/beta/auth')) {
                const { data } = await supabase.from('User').select('email, role');
                let csv = 'Email,Role\n';
                data?.forEach(u => csv += `${u.email},${u.role || 'USER'}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/beta/vehicles')) {
                if (config?.method === 'POST') {
                    return new Response(JSON.stringify({ success: true }));
                }
                const { data } = await supabase.from('Vehicle').select('*, MaintenanceLog(*)').eq('farmId', farmId).eq('isDeleted', false);
                return new Response(JSON.stringify({
                    vehicles: data?.map(v => ({
                        ...v,
                        logs: v.MaintenanceLog?.map(l => ({
                            ...l, date: new Date(l.date).toISOString()
                        }))
                    }))
                }));
            }

            if (path.includes('/api/beta/hs')) {
                if (config?.method === 'POST') {
                    return new Response(JSON.stringify({ success: true }));
                }

                if (type === 'get_auth' || type === 'auth_list') {
                    const { data } = await supabase.from('User').select('email');
                    return new Response(JSON.stringify({ emails: data?.map(u => u.email) }));
                }

                if (type === 'breaks') {
                    const { data } = await supabase.from('Break').select('*').eq('farmId', farmId);
                    return new Response(JSON.stringify({
                        breaks: data?.map(b => ({
                            ...b,
                            vertices: b.vertices ? JSON.parse(b.vertices) : [],
                            createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : null,
                            deletedAt: b.deletedAt ? new Date(b.deletedAt).toISOString() : null
                        }))
                    }));
                }

                if (type === 'hs_get_all') {
                    const [incidents, observations, staff, hazards, meetings] = await Promise.all([
                        supabase.from('HS_Incident').select('*').eq('farmId', farmId),
                        supabase.from('HS_Observation').select('*').eq('farmId', farmId),
                        supabase.from('HS_Staff').select('*').eq('farmId', farmId),
                        supabase.from('HS_Hazard').select('*').eq('farmId', farmId),
                        supabase.from('HS_Meeting').select('*').eq('farmId', farmId)
                    ]);
                    
                    return new Response(JSON.stringify({
                        incidents: incidents.data?.map(i => ({ ...i, date: new Date(i.date).toISOString() })) || [],
                        observations: observations.data?.map(o => ({ ...o, date: new Date(o.date).toISOString() })) || [],
                        interactions: observations.data?.map(o => ({ ...o, date: new Date(o.date).toISOString() })) || [],
                        hazards: hazards.data?.map(h => ({ ...h, date: h.date ? new Date(h.date).toISOString() : undefined })) || [],
                        meetings: meetings.data?.map(m => ({ ...m, date: m.date ? new Date(m.date).toISOString() : undefined })) || [],
                        staff: staff.data || []
                    }));
                }
            }
        } catch (e) {
            console.error('Supabase proxy error:', e);
            return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
        }
    }
    
    return originalFetch.apply(this, arguments);
};
