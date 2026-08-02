const SUPABASE_URL = 'https://adzglgpoqfjtgbpeiudf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemdsZ3BvcWZqdGdicGVpdWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Njg5NzUsImV4cCI6MjEwMTA0NDk3NX0.vc4tTP0fGvSoiVvJiSwzu0c3oh-Vf5DVvKjGDWbWF2o';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const originalFetch = window.fetch;
window.fetch = async function(resource, config) {
    if (typeof resource === 'string' && resource.includes('/api/supabase')) {
        const url = new URL(resource);
        const path = url.pathname;
        let type = url.searchParams.get('type');
        let body = {};
        if (config?.body && typeof config.body === 'string') {
            try { body = JSON.parse(config.body); } catch(e){}
            if (!type) type = body.type;
        }
        const farmId = url.searchParams.get('farmId') || 'c7972aad-664f-43ad-934d-d88708d3e315';
        
        console.log('Intercepted Vercel request:', path, type, config?.method);

        try {
            if (path.includes('/api/supabase/paddocks')) {
                const { data } = await supabaseClient.from('Paddock').select('*').eq('farmId', farmId);
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

            if (path.includes('/api/supabase/ndvi')) {
                const { data } = await supabaseClient.from('PastureRecord')
                    .select('ndvi, date, tileUrl, Paddock!inner(name, farmId)')
                    .eq('type', 'SATELLITE')
                    .eq('Paddock.farmId', farmId);
                
                let csv = 'paddock_name,date,ndvi_mean,cloud_pc,map_id\n';
                data?.forEach(r => {
                    const d = new Date(r.date);
                    const dateStr = `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth()+1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
                    csv += `${r.Paddock.name},${dateStr},${r.ndvi || ""},0,${r.tileUrl || ""}\n`;
                });
                return new Response(csv);
            }

            if (path.includes('/api/supabase/exclusions')) {
                const { data } = await supabaseClient.from('PaddockExclusion').select('*').eq('farmId', farmId);
                let csv = 'paddock,reason\n';
                data?.forEach(e => csv += `${e.paddockName},${e.reason}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/supabase/partial')) {
                const { data } = await supabaseClient.from('PaddockPartial').select('*').eq('farmId', farmId);
                let csv = 'paddock,status\n';
                data?.forEach(e => csv += `${e.paddockName},${e.status}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/supabase/cal')) {
                const { data } = await supabaseClient.from('Calibration').select('*').eq('farmId', farmId);
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

            if (path.includes('/api/supabase/manual')) {
                const { data } = await supabaseClient.from('ManualMode').select('*').eq('farmId', farmId);
                let csv = '';
                if (data && data.length > 0) {
                    csv = data[0].data; // Assuming stored as CSV string in data field based on manual logic
                }
                return new Response(csv);
            }

            if (path.includes('/api/supabase/feed')) {
                const { data } = await supabaseClient.from('FeedSetting').select('*').eq('farmId', farmId);
                let csv = 'Setting,Value\n';
                data?.forEach(f => csv += `${f.key},${f.value}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/supabase/auth')) {
                const { data } = await supabaseClient.from('User').select('email, role');
                let csv = 'Email,Role\n';
                data?.forEach(u => csv += `${u.email},${u.role || 'USER'}\n`);
                return new Response(csv);
            }

            if (path.includes('/api/supabase/vehicles')) {
                if (config?.method === 'POST') {
                    return new Response(JSON.stringify({ success: true }));
                }
                const { data } = await supabaseClient.from('Vehicle').select('*, MaintenanceLog(*)').eq('farmId', farmId).eq('isDeleted', false);
                const flatLogs = [];
                const vehicles = data?.map(v => {
                    if (v.MaintenanceLog) {
                        v.MaintenanceLog.forEach(l => flatLogs.push({ ...l, date: l.date ? new Date(l.date).toISOString() : null }));
                    }
                    return { ...v, logs: undefined }; // or leave it, doesn't matter
                });
                return new Response(JSON.stringify({
                    success: true,
                    vehicles: vehicles || [],
                    logs: flatLogs
                }));
            }

            if (path.includes('/api/supabase/hs')) {
                if (config?.method === 'POST') {
                    return new Response(JSON.stringify({ success: true }));
                }

                if (type === 'get_auth' || type === 'auth_list') {
                    const { data } = await supabaseClient.from('User').select('email');
                    return new Response(JSON.stringify({ emails: data?.map(u => u.email) }));
                }

                if (type === 'breaks') {
                    const { data } = await supabaseClient.from('Break').select('*').eq('farmId', farmId);
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
                        supabaseClient.from('HS_Incident').select('*').eq('farmId', farmId),
                        supabaseClient.from('HS_Observation').select('*').eq('farmId', farmId),
                        supabaseClient.from('HS_Staff').select('*').eq('farmId', farmId),
                        supabaseClient.from('HS_Hazard').select('*').eq('farmId', farmId),
                        supabaseClient.from('HS_Meeting').select('*').eq('farmId', farmId)
                    ]);
                    
                    const formatIncidents = arr => (arr || []).map(i => {
                        let type='Incident', severity='Low', reporter='Unknown', treatment='', desc=i.description||'';
                        const tM=desc.match(/Type:\s*(.*?)[,\)]/i); if(tM) type=tM[1].trim();
                        const sM=desc.match(/Severity:\s*(.*?)[,\)]/i); if(sM) severity=sM[1].trim();
                        const rM=desc.match(/Reported by:\s*(.*?)[,\)]/i); if(rM) reporter=rM[1].trim();
                        const trM=desc.match(/Action Taken:\s*(.*?)[,\)]/i); if(trM) treatment=trM[1].trim();
                        const mdM=desc.match(/^(.*?)\s*\(/); if(mdM) desc=mdM[1].trim();
                        const d=i.date?new Date(i.date):new Date();
                        return { id: i.id, date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`, type, severity, reporter, treatment, description: desc, status: i.status };
                    });

                    const formatHazards = arr => (arr || []).map(h => {
                        let type='point', severity='Medium', desc=h.description||'';
                        const tM=desc.match(/Type:\s*(.*?)[,\)]/i); if(tM) type=tM[1].trim();
                        const sM=desc.match(/Severity:\s*(.*?)[,\)]/i); if(sM) severity=sM[1].trim();
                        const mdM=desc.match(/^(.*?)\s*\(/); if(mdM) desc=mdM[1].trim();
                        let name=desc; const dIdx=desc.indexOf('-'); if(dIdx>0){ name=desc.substring(0,dIdx).trim(); desc=desc.substring(dIdx+1).trim(); }
                        let lat=0, lng=0, polygon=[];
                        try{ const p=JSON.parse(h.coordinates); if(Array.isArray(p)){ polygon=p; if(p.length>0){lat=p[0].lat;lng=p[0].lng;} }else{ lat=p.lat;lng=p.lng; } }catch(e){}
                        return { id: h.id, name, severity, type, description: desc, reportedBy: h.reportedBy||'Unknown', reportedAt: h.date, status: h.status, mitigation: h.mitigation||'', lat, lng, polygon };
                    });

                    const formatObs = arr => (arr || []).map(o => {
                        let observed='Unknown', type='Observation', details=o.description||'', action='';
                        const oM=o.description?.match(/Observed:\s*(.*?)\./i); if(oM) observed=oM[1].trim();
                        const tM=o.description?.match(/Type:\s*(.*?)\./i); if(tM) type=tM[1].trim();
                        const dM=o.description?.match(/Details:\s*(.*?)\./i); if(dM) details=dM[1].trim();
                        const aM=o.description?.match(/Action:\s*(.*?)$/i); if(aM) action=aM[1].trim();
                        const d=o.date?new Date(o.date):new Date();
                        return { id: o.id, date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`, observer: o.observer||'Unknown', observed, type, details, action };
                    });

                    const formatMeetings = arr => (arr || []).map(m => {
                        let topic=m.topic||'Safety Meeting', notes='';
                        const nM=m.topic?.match(/Notes:\s*(.*)/i); if(nM){ notes=nM[1].trim(); topic=m.topic.substring(0,m.topic.indexOf('Notes:')).replace('-','').trim(); }
                        return { id: m.id, date: m.date, topic, notes, attendees: (m.attendees && typeof m.attendees === 'string') ? m.attendees.split(',').map(s=>s.trim()).filter(s=>s) : [] };
                    });

                    return new Response(JSON.stringify({
                        incidents: formatIncidents(incidents.data),
                        observations: formatObs(observations.data),
                        interactions: formatObs(observations.data),
                        hazards: formatHazards(hazards.data),
                        meetings: formatMeetings(meetings.data),
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
