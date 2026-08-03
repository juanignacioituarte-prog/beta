const SUPABASE_URL = 'https://adzglgpoqfjtgbpeiudf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkemdsZ3BvcWZqdGdicGVpdWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Njg5NzUsImV4cCI6MjEwMTA0NDk3NX0.vc4tTP0fGvSoiVvJiSwzu0c3oh-Vf5DVvKjGDWbWF2o';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const originalFetch = window.fetch;
window.fetch = async function(resource, config) {
    if (typeof resource === 'string' && resource.includes('/api/supabase')) {
        const url = new URL(resource, window.location.href);
        const path = url.pathname;
        let type = url.searchParams.get('type');
        let body = {};
        if (config?.body && typeof config.body === 'string') {
            try { body = JSON.parse(config.body); } catch(e){}
            if (!type) type = body.type;
        }
        const farmId = url.searchParams.get('farmId') || 'c7972aad-664f-43ad-934d-d88708d3e315';
        
        console.log('Intercepted Supabase request:', path, type, config?.method);

        try {
            if (path.includes('/api/supabase/paddocks')) {
                const { data } = await supabaseClient.from('Paddock').select('*').eq('farmId', farmId);
                const featureCollection = {
                    type: "FeatureCollection",
                    name: "Paddocks",
                    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
                    features: (data || []).map(p => ({
                        type: "Feature",
                        properties: { ...p, id: p.id, name: p.name, calcArea: p.calcArea || p.areaHa || 0 },
                        geometry: p.boundary ? (typeof p.boundary === 'string' ? JSON.parse(p.boundary) : p.boundary) : null
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
                if (config?.method === 'POST') {
                    try {
                        const { date, entries } = body;
                        if (Array.isArray(entries)) {
                            const { data: paddockRows } = await supabaseClient.from('Paddock').select('id, name').eq('farmId', farmId);
                            const paddockMap = new Map();
                            (paddockRows || []).forEach(p => paddockMap.set(String(p.name).toLowerCase().trim(), p.id));

                            const recordsToUpsert = [];
                            for (const item of entries) {
                                const pName = String(item.paddockName || '').trim();
                                const paddockId = item.paddockId || paddockMap.get(pName.toLowerCase());
                                if (paddockId && item.cover !== null && item.cover !== undefined && item.cover !== '') {
                                    recordsToUpsert.push({
                                        id: `man-${paddockId}-${date || Date.now()}`,
                                        paddockId: paddockId,
                                        date: new Date(date || Date.now()).toISOString(),
                                        cover: Number(item.cover),
                                        type: 'MANUAL'
                                    });
                                }

                                if (item.isExcluded) {
                                    await supabaseClient.from('PaddockExclusion').upsert({
                                        id: `ex-${pName}`,
                                        farmId: farmId,
                                        paddockName: pName,
                                        reason: 'out_of_rotation'
                                    }, { onConflict: 'id' });
                                } else if (item.isExcluded === false) {
                                    await supabaseClient.from('PaddockExclusion').delete().eq('farmId', farmId).eq('paddockName', pName);
                                }
                            }

                            if (recordsToUpsert.length > 0) {
                                await supabaseClient.from('PastureRecord').upsert(recordsToUpsert, { onConflict: 'id' });
                            }
                        }
                    } catch(e) { console.error('Error saving manual farmwalk:', e); }
                    return new Response(JSON.stringify({ status: 'success', success: true }));
                }

                const { data } = await supabaseClient.from('PastureRecord')
                    .select('date, cover, Paddock!inner(name, farmId)')
                    .eq('type', 'MANUAL')
                    .eq('Paddock.farmId', farmId);
                
                return new Response(JSON.stringify(data || []));
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
                    if (body.type === 'feed_settings' || body.residual !== undefined) {
                        try {
                            await supabaseClient.from('FeedSetting').upsert({
                                id: 'feed-config-' + farmId,
                                farmId: farmId,
                                key: 'full_config',
                                value: JSON.stringify(body)
                            }, { onConflict: 'id' });
                        } catch(e) { console.error('Error upserting feed settings:', e); }
                        return new Response(JSON.stringify({ status: 'success', success: true }));
                    }

                    if (body.type === 'breaks' && Array.isArray(body.breaks)) {
                        try {
                            const { data: paddockRows } = await supabaseClient.from('Paddock').select('id, name').eq('farmId', farmId);
                            const paddockMap = new Map();
                            (paddockRows || []).forEach(p => paddockMap.set(String(p.name).toLowerCase().trim(), p.id));
                            const fallbackPaddockId = paddockRows && paddockRows.length > 0 ? paddockRows[0].id : '3988edce-766b-4fb7-953a-868f9bedacd1';

                            const rowsToUpsert = body.breaks.map(b => {
                                let points = b.vertices || [];
                                if (!Array.isArray(points) && points && typeof points === 'object') {
                                    points = points.points || points.vertices || [];
                                }
                                const paddockName = String(b.paddock || '').toLowerCase().trim();
                                const matchedPaddockId = paddockMap.get(paddockName) || fallbackPaddockId;

                                return {
                                    id: String(b.id),
                                    farmId: farmId,
                                    paddockId: matchedPaddockId,
                                    name: b.name || '',
                                    paddock: b.paddock || '',
                                    vertices: JSON.stringify(points),
                                    areaSqm: b.areaSqm || (b.areaHa ? Math.round(b.areaHa * 10000) : 0),
                                    areaHa: b.areaHa || (b.areaSqm ? b.areaSqm / 10000 : 0),
                                    distanceMeters: b.distanceMeters || 0,
                                    cropWidthMeters: b.cropWidthMeters || 0,
                                    cropMode: b.cropMode || 'polygon',
                                    group: b.group || '1st',
                                    comment: b.comment || '',
                                    isCropBreak: !!b.isCropBreak,
                                    cropStatus: b.cropStatus || 'marked',
                                    status: b.cropStatus || (b.isDeleted ? 'deleted' : 'active'),
                                    createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString(),
                                    createdBy: b.createdBy || 'Unknown',
                                    isDeleted: !!(b.isDeleted || b.deletedAt),
                                    deletedBy: b.deletedBy || null,
                                    deletedAt: (b.isDeleted || b.deletedAt) ? new Date(b.deletedAt || Date.now()).toISOString() : null,
                                    lastEditedBy: b.lastEditedBy || null,
                                    lastEditedAt: b.lastEditedAt ? new Date(b.lastEditedAt).toISOString() : null
                                };
                            });
                            await supabaseClient.from('Break').upsert(rowsToUpsert, { onConflict: 'id' });
                        } catch(e) { console.error('Error upserting breaks:', e); }
                    }
                    return new Response(JSON.stringify({ status: 'success', success: true }));
                }

                if (!type) {
                    const { data } = await supabaseClient.from('FeedSetting').select('*').eq('farmId', farmId).eq('key', 'full_config');
                    if (data && data.length > 0 && data[0].value) {
                        return new Response(data[0].value);
                    }
                    return new Response(JSON.stringify({}));
                }

                if (type === 'get_auth' || type === 'auth_list') {
                    const { data } = await supabaseClient.from('User').select('email');
                    return new Response(JSON.stringify({ emails: data?.map(u => u.email) }));
                }

                if (type === 'breaks') {
                    let allBreaks = [];
                    let from = 0;
                    const step = 1000;
                    while (true) {
                        const { data, error } = await supabaseClient.from('Break').select('*').eq('farmId', farmId).range(from, from + step - 1);
                        if (error || !data || data.length === 0) break;
                        allBreaks = allBreaks.concat(data);
                        if (data.length < step) break;
                        from += step;
                    }
                    return new Response(JSON.stringify({
                        breaks: allBreaks.map(b => {
                            let parsedVertices = [];
                            let extraMeta = {};
                            if (b.vertices) {
                                try {
                                    const p = typeof b.vertices === 'string' ? JSON.parse(b.vertices) : b.vertices;
                                    if (Array.isArray(p)) {
                                        parsedVertices = p;
                                    } else if (p && typeof p === 'object') {
                                        parsedVertices = p.points || p.vertices || [];
                                        extraMeta = p;
                                    }
                                } catch(e){}
                            }
                            return {
                                ...extraMeta,
                                ...b,
                                id: String(b.id),
                                name: b.name || extraMeta.name || '',
                                paddock: b.paddock || extraMeta.paddock || '',
                                vertices: parsedVertices,
                                areaSqm: b.areaSqm || extraMeta.areaSqm || (b.areaHa ? Math.round(b.areaHa * 10000) : 0),
                                areaHa: b.areaHa || extraMeta.areaHa || 0,
                                distanceMeters: b.distanceMeters || extraMeta.distanceMeters || 0,
                                cropWidthMeters: b.cropWidthMeters || extraMeta.cropWidthMeters || 0,
                                cropMode: b.cropMode || extraMeta.cropMode || 'polygon',
                                createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : extraMeta.createdAt,
                                createdBy: b.createdBy || extraMeta.createdBy || 'Unknown User',
                                group: b.group || extraMeta.group || '1st',
                                comment: b.comment || extraMeta.comment || '',
                                isCropBreak: b.isCropBreak !== undefined ? b.isCropBreak : (extraMeta.isCropBreak !== undefined ? extraMeta.isCropBreak : false),
                                cropStatus: b.cropStatus || b.status || extraMeta.cropStatus || 'marked',
                                isDeleted: b.isDeleted !== undefined ? b.isDeleted : (b.deletedAt ? true : (extraMeta.isDeleted || false)),
                                deletedBy: b.deletedBy || extraMeta.deletedBy || null,
                                deletedAt: b.deletedAt ? new Date(b.deletedAt).toISOString() : extraMeta.deletedAt,
                                lastEditedBy: b.lastEditedBy || extraMeta.lastEditedBy || null,
                                lastEditedAt: b.lastEditedAt ? new Date(b.lastEditedAt).toISOString() : extraMeta.lastEditedAt
                            };
                        })
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
                        return { ...i, id: i.id, date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`, type: i.type || type, severity: i.severity || severity, reporter: i.reporter || reporter, treatment: i.treatment || treatment, description: desc || i.description, status: i.status };
                    });

                    const formatHazards = arr => (arr || []).map(h => {
                        let type='point', severity='Medium', desc=h.description||'';
                        const tM=desc.match(/Type:\s*(.*?)[,\)]/i); if(tM) type=tM[1].trim();
                        const sM=desc.match(/Severity:\s*(.*?)[,\)]/i); if(sM) severity=sM[1].trim();
                        const mdM=desc.match(/^(.*?)\s*\(/); if(mdM) desc=mdM[1].trim();
                        let name=desc; const dIdx=desc.indexOf('-'); if(dIdx>0){ name=desc.substring(0,dIdx).trim(); desc=desc.substring(dIdx+1).trim(); }
                        let lat=0, lng=0, polygon=[];
                        let parsedCoords = null;
                        try{
                            parsedCoords = typeof h.coordinates === 'string' ? JSON.parse(h.coordinates) : h.coordinates;
                            if (Array.isArray(parsedCoords)) {
                                polygon = parsedCoords;
                                if (polygon.length > 0) { lat = polygon[0].lat; lng = polygon[0].lng; }
                            } else if (parsedCoords && typeof parsedCoords === 'object') {
                                lat = parsedCoords.lat || h.lat || 0;
                                lng = parsedCoords.lng || h.lng || 0;
                            }
                        }catch(e){
                            lat = h.lat || 0;
                            lng = h.lng || 0;
                        }
                        const finalCoords = (type === 'point' || !Array.isArray(polygon) || polygon.length === 0) ? { lat: lat || h.lat || 0, lng: lng || h.lng || 0 } : polygon;
                        return { ...h, id: h.id, name: h.name || name || 'Unnamed Hazard', severity: h.severity || severity || 'Medium', type: h.type || type || 'point', description: h.description || desc || '', reportedBy: h.reportedBy||'Unknown', reportedAt: h.date || h.createdAt || new Date().toISOString(), status: h.status || 'active', mitigation: h.mitigation||'', lat: lat || h.lat || 0, lng: lng || h.lng || 0, polygon, coordinates: finalCoords };
                    });

                    const formatObs = arr => (arr || []).map(o => {
                        let observed='Unknown', type='Observation', details=o.description||'', action='';
                        const oM=o.description?.match(/Observed:\s*(.*?)\./i); if(oM) observed=oM[1].trim();
                        const tM=o.description?.match(/Type:\s*(.*?)\./i); if(tM) type=tM[1].trim();
                        const dM=o.description?.match(/Details:\s*(.*?)\./i); if(dM) details=dM[1].trim();
                        const aM=o.description?.match(/Action:\s*(.*?)$/i); if(aM) action=aM[1].trim();
                        const d=o.date?new Date(o.date):new Date();
                        return { ...o, id: o.id, date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`, observer: o.observer||'Unknown', observed: o.observed || observed, type: o.type || type, details: o.details || details, action: o.action || action };
                    });

                    const formatMeetings = arr => (arr || []).map(m => {
                        let topic=m.topic||'Safety Meeting', notes=m.notes||'';
                        const nM=m.topic?.match(/Notes:\s*(.*)/i); if(nM){ notes=nM[1].trim(); topic=m.topic.substring(0,m.topic.indexOf('Notes:')).replace('-','').trim(); }
                        return { ...m, id: m.id, date: m.date, topic: m.topic || topic, notes: m.notes || notes, attendees: (m.attendees && typeof m.attendees === 'string') ? m.attendees.split(',').map(s=>s.trim()).filter(s=>s) : (Array.isArray(m.attendees) ? m.attendees : []) };
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
    
    return originalFetch.apply(window, arguments);
};
