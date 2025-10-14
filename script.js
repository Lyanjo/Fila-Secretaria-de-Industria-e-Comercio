// Sistema de fila simples para Secretaria de Indústria e Comércio
// Regras básicas:
// - 8 salas/departamentos
// - recepção registra Nome, Documento, Preferencial e Sala
// - preferencial entra à frente de não preferenciais (mas mantém ordem entre preferenciais)
// - dados persistidos em localStorage

const NUM_SALAS = 8;
const SALAS = {
	1: 'Sala 1 - Junta Militar',
 	2: 'Sala 2 - Procon',
 	3: 'Sala 3 - Ouvidoria',
 	4: 'Sala 4 - Banco do povo/PAV',
 	5: 'Sala 5 - Frente de Trabalho',
 	6: 'Sala 6 - PAT',
 	7: 'Sala 7 - Preenchimento',
 	8: 'Sala 8 - SEBRAE'
};

function loadState(){
	const raw = localStorage.getItem('fila_state');
	if(!raw) return {queues: initQueues(), lastTicket: 0, serving: {}, history: [], users: [], currentUser: null};
	try{ return JSON.parse(raw);}catch(e){return {queues: initQueues(), lastTicket:0, serving:{}, history: [], users: [], currentUser: null}}
}

function initQueues(){
	const q = {};
	for(let i=1;i<=NUM_SALAS;i++) q[i]=[];
	return q;
}

// --- Daily counter helpers ---
function getTodayKey(){
	const d = new Date();
	return d.toISOString().slice(0,10); // YYYY-MM-DD
}

function ensureDailyCounts(){
	state.dailyCounts = state.dailyCounts || {};
	// ensure entry for today
	const k = getTodayKey();
	if(!state.dailyCounts[k]) state.dailyCounts[k] = 0;
}

function incrementDailyCount(){
	ensureDailyCounts();
	const k = getTodayKey();
	state.dailyCounts[k] = (state.dailyCounts[k] || 0) + 1;
	saveState();
	renderDailyCount();
}

// --- Supabase helpers (opcionais) ---
async function pushAtendimentoToDb(at){
	// at: { name, document, preferencial, sala, ticket, createdAt }
	if(window.supabase){
		try{
			const payload = { mucipe_nome: at.name, munic_doc: at.document, dep_direcionado: at.sala.toString(), senha: at.ticket, created_at: formatLocalTimestamp(at.createdAt) };
			const { data, error } = await window.supabase.from('atendimentos').insert([payload]).select().maybeSingle();
			if(error){
				console.warn('Supabase insert atendimentos error', error);
				return { success: false, error };
			}
			// se inseriu com sucesso, atualizar referência local (se existir na fila)
			try{
				state.queues = state.queues || {};
				const salaArr = state.queues[at.sala] || [];
				const found = salaArr.find(x=>x.ticket === at.ticket);
				if(found){
					found.remoteId = data && data.id;
					found.remoteSynced = true;
					saveState();
				}
			}catch(e){ /* silent */ }
			return { success: true, data };
		}catch(e){ console.warn('Supabase atendimentos exception', e); return { success:false, error:e }; }
	} else {
		// fallback: grava no state.history já existente (já fazemos isso localmente)
		return { success: false, error: 'no-supabase' };
	}
}

async function pushUserToDb(user){
	// user: { email, password, role, ativo? }
	if(!window.supabase) return { success:false, error: 'no-supabase' };
	try{
		const payload = { email: user.email, senha_hash: user.password || '', departamento: roleToDbDept(user.role), ativo: (typeof user.ativo !== 'undefined' ? user.ativo : true) };
		try{
			// tentar upsert com onConflict por email
			const upsertQ = window.supabase.from('login_usuarios').upsert([payload], { onConflict: ['email'] });
			const { data, error } = await upsertQ.select().maybeSingle();
			if(error){
				// fallback: alguns backends não suportam ON CONFLICT → fazer manualmente
				console.warn('[pushUserToDb] upsert error, attempting fallback', error);
				// tentar localizar por email
				const { data: existing, error: selErr } = await window.supabase.from('login_usuarios').select('*').eq('email', payload.email).limit(1).maybeSingle();
				if(selErr) return { success:false, error: selErr };
				if(existing && existing.id){
					const upd = { senha_hash: payload.senha_hash, departamento: payload.departamento, ativo: payload.ativo };
					const { data: updated, error: updErr } = await window.supabase.from('login_usuarios').update(upd).eq('id', existing.id).select().maybeSingle();
					if(updErr) return { success:false, error: updErr };
					return { success:true, data: updated };
				} else {
					const { data: ins, error: insErr } = await window.supabase.from('login_usuarios').insert([payload]).select().maybeSingle();
					if(insErr) return { success:false, error: insErr };
					return { success:true, data: ins };
				}
			}
			return { success:true, data };
		}catch(e){
			console.error('[pushUserToDb] inner exception', e);
			return { success:false, error: e };
		}
	}catch(e){
		console.error('[pushUserToDb] exception', e);
		return { success:false, error: e };
	}
}

// helpers to map local role <-> DB departamento string
function roleToDbDept(role){
    if(!role) return null;
    if(role === 'adm') return 'Administrador';
    if(role === 'recepcao') return 'Recepção';
    // numeric sala
    if(/^\d+$/.test(String(role))){
        const r = SALAS[parseInt(role,10)];
        if(r && r.indexOf(' - ')!==-1) return r.split(' - ')[1];
        return r || String(role);
    }
    return String(role);
}

function dbDeptToRole(dept){
    if(!dept) return null;
    const d = String(dept).trim();
    if(d === 'Administrador') return 'adm';
    if(d === 'Recepção') return 'recepcao';
    // try to match sala names
    for(const k in SALAS){
        const txt = SALAS[k];
        if(txt && txt.indexOf(' - ')!==-1){
            const name = txt.split(' - ')[1];
            if(name === d) return String(k);
        }
    }
    // fallback: return dept string (will not match numeric checks elsewhere)
    return d;
}

function renderDailyCount(){
	try{ if(dailyCountEl) dailyCountEl.textContent = (state.dailyCounts && state.dailyCounts[getTodayKey()]) || 0; }catch(e){}
}

let state = loadState();

function saveState(){ localStorage.setItem('fila_state', JSON.stringify(state)); }

// util
function formatTicket(num, sala){
	return `S${sala.toString().padStart(2,'0')}-${num.toString().padStart(3,'0')}`;
}

// --- Fila de sincronização (ops pendentes) ---
state.syncQueue = state.syncQueue || [];

function enqueueSync(op){
	// op: { type: 'createMunicipe'|'createAtendimento'|'createUser', payload }
	state.syncQueue.push(op);
	saveState();
}

async function processSyncQueue(){
	if(!window.navigator.onLine) return; // aguardar voltar online
	if(!window.supabase) return; // nada a sincronizar remotamente se não configurado
	if(!state.syncQueue || state.syncQueue.length===0) return;
	// trabalhar em cópia para evitar alterações durante iteração
	const queue = state.syncQueue.slice();
	for(const op of queue){
		try{
			if(op.type === 'createMunicipe'){
				// tentar inserir o munícipe remoto
				const payload = { nome: op.payload.name, documento: op.payload.document, preferencial: op.payload.preferencial, created_at: formatLocalTimestamp() };
				// usar upsert para evitar conflito quando já existe um registro com mesmo documento
				console.info('[processSyncQueue:createMunicipe] payload:', payload);
				const upsertMun = window.supabase.from('municipes').upsert([payload], { onConflict: ['documento'] });
				const { data, error } = await upsertMun.select().maybeSingle();
				if(error){
					console.error('[processSyncQueue:createMunicipe] upsert error', error);
					// se houve conflito de chave única (registro já existe), buscar o registro existente e atualizar o cache local
					if(error.code === '23505' || error.status === 409){
						try{
							const { data: existing, error: selErr } = await window.supabase.from('municipes').select('*').eq('documento', op.payload.document).limit(1).maybeSingle();
							if(selErr){
								console.warn('Erro ao buscar munícipe existente após conflito', selErr);
								// não remover da fila, tentar novamente depois
								continue;
							}
							// se erro 42P10 -> ON CONFLICT não aplicável (sem constraint) -> tentar fallback manual
							else if(error && error.code === '42P10'){
								console.warn('[processSyncQueue:createMunicipe] ON CONFLICT not supported; fallback manual upsert by documento');
								try{
									const { data: existing, error: selErr } = await window.supabase.from('municipes').select('*').eq('documento', op.payload.document).limit(1).maybeSingle();
									if(selErr){ console.error('[processSyncQueue:createMunicipe] select existing error', selErr); throw selErr; }
									if(existing && existing.id){
										const upd = { nome: payload.nome, preferencial: payload.preferencial, created_at: payload.created_at };
										const { error: updErr } = await window.supabase.from('municipes').update(upd).eq('id', existing.id);
										if(updErr){ console.error('[processSyncQueue:createMunicipe] fallback update error', updErr); throw updErr; }
										// atualizar cache local similar ao caso de sucesso
										state.municipes = state.municipes || [];
										let found = null;
										if(op.payload.localId) found = state.municipes.find(x=>x.localId === op.payload.localId);
										if(!found) found = state.municipes.find(x=>x.documento === op.payload.document);
										if(found){ found.id = existing.id; found.nome = existing.nome; found.documento = existing.documento; found.preferencial = existing.preferencial; found.createdAt = existing.created_at || found.createdAt; }
										else state.municipes.push({ nome: existing.nome, documento: existing.documento, preferencial: existing.preferencial, id: existing.id, createdAt: existing.created_at });
										const idx = state.syncQueue.findIndex(x=>x === op);
										if(idx !== -1) state.syncQueue.splice(idx,1);
										saveState();
										continue;
									} else {
										// inserir sem on_conflict
										const { error: insErr, data: ins } = await window.supabase.from('municipes').insert([payload]).select().maybeSingle();
										if(insErr){ console.error('[processSyncQueue:createMunicipe] fallback insert error', insErr); throw insErr; }
										// update local cache
										state.municipes = state.municipes || [];
										if(op.payload.localId){
											let found = state.municipes.find(x=>x.localId === op.payload.localId);
											if(found){ found.id = ins.id; found.nome = ins.nome; found.documento = ins.documento; found.preferencial = ins.preferencial; found.createdAt = ins.created_at; }
											else state.municipes.push({ nome: ins.nome, documento: ins.documento, preferencial: ins.preferencial, id: ins.id, createdAt: ins.created_at });
										} else {
											const exists = state.municipes.find(x=>x.documento === ins.documento);
											if(!exists) state.municipes.push({ nome: ins.nome, documento: ins.documento, preferencial: ins.preferencial, id: ins.id, createdAt: ins.created_at });
										}
										const idx = state.syncQueue.findIndex(x=>x === op);
										if(idx !== -1) state.syncQueue.splice(idx,1);
										saveState();
										continue;
									}
								}catch(fbE){ console.warn('Erro fallback createMunicipe', fbE); continue; }
							}
							if(existing){
								state.municipes = state.municipes || [];
								// tentar mapear pelo localId se presente, senão pelo documento
								let found = null;
								if(op.payload.localId) found = state.municipes.find(x=>x.localId === op.payload.localId);
								if(!found) found = state.municipes.find(x=>x.documento === op.payload.document);
								if(found){
									found.id = existing.id;
									found.nome = existing.nome;
									found.documento = existing.documento;
									found.preferencial = existing.preferencial;
									found.createdAt = existing.created_at || found.createdAt;
								} else {
									state.municipes.push({ nome: existing.nome, documento: existing.documento, preferencial: existing.preferencial, id: existing.id, createdAt: existing.created_at });
								}
								// remover op da fila
								const idx = state.syncQueue.findIndex(x=>x === op);
								if(idx !== -1) state.syncQueue.splice(idx,1);
								saveState();
								continue;
							} else {
								// não encontrou registro existente — manter na fila para tentar depois
								continue;
							}
						}catch(selEx){
							console.warn('Erro ao tratar conflito createMunicipe', selEx);
							continue;
						}
					}
					// outros erros: lançar para cair no catch abaixo e manter a op na fila
					throw error;
				} else {
					// sucesso: atualizar cache local (mapear localId → id remoto se aplicável)
					state.municipes = state.municipes || [];
					if(op.payload.localId){
						let found = state.municipes.find(x=>x.localId === op.payload.localId);
						if(found){
							found.id = data.id;
							found.nome = data.nome;
							found.documento = data.documento;
							found.preferencial = data.preferencial;
							found.createdAt = data.created_at;
						} else {
							state.municipes.push({ nome: data.nome, documento: data.documento, preferencial: data.preferencial, id: data.id, createdAt: data.created_at });
						}
					} else {
						// sem localId, apenas garantir que o registro exista no cache
						const exists = state.municipes.find(x=>x.documento === data.documento);
						if(!exists) state.municipes.push({ nome: data.nome, documento: data.documento, preferencial: data.preferencial, id: data.id, createdAt: data.created_at });
					}
					// remover op da fila
					const idx = state.syncQueue.findIndex(x=>x === op);
					if(idx !== -1) state.syncQueue.splice(idx,1);
					saveState();
				}
			} else if(op.type === 'createAtendimento'){
				const at = op.payload;
				const payload = { mucipe_nome: at.name, munic_doc: at.document, dep_direcionado: at.sala.toString(), senha: at.ticket, created_at: formatLocalTimestamp(at.createdAt) };
				if(at && at.inicio_atendimento) payload.inicio_atendimento = at.inicio_atendimento;
				if(typeof at.concluido !== 'undefined') payload.concluido = !!at.concluido;
				const { data, error } = await window.supabase.from('atendimentos').insert([payload]).select().maybeSingle();
				if(error){
					console.warn('createAtendimento insert error', error);
					throw error;
				}
				// mapear item local por ticket e atualizar flags
				try{
					state.queues = state.queues || {};
					const salaArr = state.queues[at.sala] || [];
					const found = salaArr.find(x=>x.ticket === at.ticket);
					if(found){
						found.remoteId = data && data.id;
						found.remoteSynced = true;
						// se inserido com inicio_atendimento no payload, atualizar o local serving se necessário
						if(at.inicio_atendimento){ found.inicio_atendimento = at.inicio_atendimento; }
						saveState();
					}
				}catch(e){ /* silent */ }
			} else if(op.type === 'createUser'){
				const u = op.payload;
				const payload = { email: u.email, senha_hash: u.password || '', departamento: roleToDbDept(u.role), ativo: true };
				console.info('[processSyncQueue:createUser] payload:', payload);
				const upsertUserQ = window.supabase.from('login_usuarios').upsert([payload], { onConflict: ['email'] });
				const { data, error } = await upsertUserQ.select().maybeSingle();
				if(error){
					console.error('[processSyncQueue:createUser] upsert error', error);
					if(error && (error.code === '42P10' || (error.details && String(error.details).includes('ON CONFLICT')))){
						console.warn('[processSyncQueue:createUser] fallback: no unique constraint for ON CONFLICT -> trying manual upsert');
						// tentar localizar por email
						const { data: existing, error: selErr } = await window.supabase.from('login_usuarios').select('*').eq('email', payload.email).limit(1).maybeSingle();
						if(selErr){ console.error('[processSyncQueue:createUser] select existing error', selErr); throw selErr; }
						if(existing && existing.id){
							const upd = { senha_hash: payload.senha_hash, departamento: payload.departamento, ativo: payload.ativo };
							const { error: updErr } = await window.supabase.from('login_usuarios').update(upd).eq('id', existing.id);
							if(updErr){ console.error('[processSyncQueue:createUser] fallback update error', updErr); throw updErr; }
						} else {
							const { error: insErr } = await window.supabase.from('login_usuarios').insert([payload]);
							if(insErr){ console.error('[processSyncQueue:createUser] fallback insert error', insErr); throw insErr; }
						}
					} else {
						throw error;
					}
				}
			} else if(op.type === 'updateAtendimento'){
				// payload: { remoteId, concluido, inicio_atendimento }
				try{
					const p = op.payload || {};
					if(!p.remoteId) throw new Error('missing remoteId');
					const upd = {};
					if(typeof p.concluido !== 'undefined') upd.concluido = p.concluido;
					if(typeof p.inicio_atendimento !== 'undefined') upd.inicio_atendimento = p.inicio_atendimento;
					const { error } = await window.supabase.from('atendimentos').update(upd).eq('id', p.remoteId);
					if(error) throw error;
				}catch(e){
					console.warn('updateAtendimento failed', e);
					throw e;
				}
				} else if(op.type === 'updateUser'){
					// payload: { originalEmail, changes }
					try{
						const p = op.payload || {};
						const res = await updateUserRemote(p.originalEmail, p.changes);
						if(!res || !res.success) throw res && res.error ? res.error : new Error('updateUser failed');
					}catch(e){
						console.warn('processSyncQueue updateUser failed', e);
						throw e;
					}
				}
				// se chegou aqui, remover op da fila
				const idx = state.syncQueue.findIndex(x=>x === op);
				if(idx!==-1) state.syncQueue.splice(idx,1);
				saveState();
			}catch(e){
				console.warn('sync op failed, keeping in queue', op, e);
				// não remover, tentar novamente depois
			}
	}
}

// processar fila quando voltar online
window.addEventListener('online', ()=>{ console.info('online - tentando sincronizar'); processSyncQueue(); });
// tentar processar no carregamento
setTimeout(processSyncQueue, 2000);

// buscar usuários remotos e sincronizar com state.users
async function fetchRemoteUsers(){
	if(!window.supabase) return;
	try{
		const { data, error } = await window.supabase.from('login_usuarios').select('*').limit(1000);
		if(error){ console.warn('fetchRemoteUsers error', error); return; }
		if(!data) return;
		// mapear para state.users (manter local users' passwords untouched)
		state.users = state.users || [];
		// substituir/merge por email (mantemos senha local quando existente)
		data.forEach(u=>{
			const email = u.email;
			let local = state.users.find(x=>x.email === email);
			const role = dbDeptToRole(u.departamento);
			if(local){
				local.role = role;
				// do not overwrite local password
			} else {
				state.users.push({ email, password: '', role, remoteId: u.id, ativo: u.ativo });
			}
		});
		saveState();
	}catch(e){ console.warn('fetchRemoteUsers exception', e); }
}

// registra o ultimo login (timestamp) no Supabase, aceita falhar e enfileirar
async function recordLastLogin(email){
	try{
		const now = new Date();
		// usar ISO no formato UTC, Postgres timestamptz interpreta corretamente
		const iso = now.toISOString();
		// atualizar localmente primeiro para feedback rápido
		try{
			state.users = state.users || [];
			const uu = state.users.find(x=>x.email === email);
			if(uu){ uu.ultimo_login = iso; saveState(); }
		}catch(_){ /* silent */ }

		if(window.supabase && window.navigator.onLine){
			// pedir retorno do update para garantir sucesso
			const { data, error } = await window.supabase.from('login_usuarios').update({ ultimo_login: iso }).eq('email', email).select().maybeSingle();
			if(error){
				try{ console.warn('recordLastLogin supabase update error', error.code || error.status || '', error.message || error); }catch(_){ console.warn('recordLastLogin supabase update error', error); }
				// enfileirar updateUser para tentar depois
				enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes: { ultimo_login: iso } } });
				return { success:false, error };
			}
			console.info('[recordLastLogin] updated remote for', email, data && data.ultimo_login);
			return { success:true, data };
		} else {
			// offline: enfileirar
			enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes: { ultimo_login: iso } } });
			console.info('[recordLastLogin] queued updateUser for', email, iso);
			return { success:true, queued:true };
		}
	}catch(e){
		console.warn('recordLastLogin exception', e);
		const iso2 = (new Date()).toISOString();
		enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes: { ultimo_login: iso2 } } });
		return { success:false, error: e };
	}
}

// Atualiza usuário remoto parcialmente (envia apenas campos presentes em 'changes')
async function updateUserRemote(originalEmail, changes){
	// changes: { email?, password?, role? }
	if(!window.supabase) return { success:false, error: new Error('no supabase') };
	try{
		// buscar usuário existente pelo email
		const { data: existing, error: selErr } = await window.supabase.from('login_usuarios').select('*').eq('email', originalEmail).limit(1).maybeSingle();
		if(selErr){ return { success:false, error: selErr }; }
		if(!existing || !existing.id){
			// não encontrou: tentar inserir como novo (usando email de changes ou original)
			const insertPayload = {};
			insertPayload.email = (changes && changes.email) ? changes.email : originalEmail;
			if(changes && typeof changes.password !== 'undefined') insertPayload.senha_hash = changes.password || '';
			if(changes && typeof changes.role !== 'undefined') insertPayload.departamento = roleToDbDept(changes.role);
			if(changes && typeof changes.ultimo_login !== 'undefined') insertPayload.ultimo_login = changes.ultimo_login;
			insertPayload.ativo = true;
			const { data: insData, error: insErr } = await window.supabase.from('login_usuarios').insert([insertPayload]).select().maybeSingle();
			if(insErr) return { success:false, error: insErr };
			return { success:true, data: insData };
		}
		// preparar payload apenas com campos que existam em changes
		const upd = {};
	if(changes && typeof changes.email !== 'undefined') upd.email = changes.email;
	if(changes && typeof changes.password !== 'undefined') upd.senha_hash = changes.password;
	if(changes && typeof changes.role !== 'undefined') upd.departamento = roleToDbDept(changes.role);
	if(changes && typeof changes.ativo !== 'undefined') upd.ativo = changes.ativo;
	// suportar atualizacao de ultimo_login (pode vir como ISO string)
	if(changes && typeof changes.ultimo_login !== 'undefined') upd.ultimo_login = changes.ultimo_login;
		// se não há nada para atualizar, retornar sucesso
		if(Object.keys(upd).length === 0) return { success:true, data: existing };
		const { error: updErr } = await window.supabase.from('login_usuarios').update(upd).eq('id', existing.id);
		if(updErr) return { success:false, error: updErr };
		return { success:true };
	}catch(e){ return { success:false, error: e }; }
}

// buscar usuários remotos ao iniciar (se supabase disponível)
window.addEventListener('online', ()=>{ fetchRemoteUsers(); });
setTimeout(()=>{ fetchRemoteUsers(); }, 2500);

// --- Contador remoto de atendimentos para hoje ---
async function fetchRemoteTodayCount(retries = 2){
	if(!window.supabase) return;
	try{
		const today = getTodayKey(); // YYYY-MM-DD (local)
		// buscar registros recentes para não varrer toda a tabela (pegar últimos 48h)
		const start = new Date(); start.setHours(0,0,0,0);
		const fetchFrom = new Date(start); fetchFrom.setDate(fetchFrom.getDate() - 1); // 1 dia antes para cobrir possíveis diferenças de fuso
	const fromISO = formatLocalTimestamp(fetchFrom);

	const { data, error } = await window.supabase.from('atendimentos').select('created_at').gte('created_at', fromISO).order('created_at', { ascending: false }).limit(1000);
		if(error){ console.warn('fetchRemoteTodayCount supabase error', error); throw error; }
		const rows = Array.isArray(data) ? data : [];
		// função utilitária para extrair YYYY-MM-DD na data local do created_at
		function localDateKey(iso){
			if(!iso) return null;
			const d = new Date(iso);
			const y = d.getFullYear();
			const m = String(d.getMonth()+1).padStart(2,'0');
			const day = String(d.getDate()).padStart(2,'0');
			return `${y}-${m}-${day}`;
		}
		let countToday = 0;
		for(const r of rows){
			const key = localDateKey(r.created_at || r.createdAt || r.createdAt);
			if(key === today) countToday++;
		}
		state.dailyCounts = state.dailyCounts || {};
		state.dailyCounts[today] = countToday;
		saveState();
		renderDailyCount();
	}catch(e){
		console.warn('fetchRemoteTodayCount failed', e);
		if(retries>0){
			setTimeout(()=> fetchRemoteTodayCount(retries-1), 1000);
		}
	}
}

// buscar atendimentos remotos recentes e mesclar nas filas locais (evita duplicatas por senha/ticket)
async function fetchRemoteAtendimentos(departamentoFiltro){
	if(!window.supabase) return [];
	try{
		// buscar atendimentos não concluídos (ou recentes) para popular as filas
		// buscar atendimentos que não foram concluídos (concluido IS NULL)
		const q = window.supabase.from('atendimentos').select('*').is('concluido', null).order('created_at', { ascending: true }).limit(500);
		const { data, error } = await q;
		if(error){ console.warn('fetchRemoteAtendimentos error', error); return []; }
		const rows = Array.isArray(data) ? data : [];
	// mapear para state.queues por dep_direcionado (campo no banco)
	// NOTE: este sistema agora mantém filas por sala somente com dados REMOTOS
	state.queues = {};
		// coletar ids/tickets retornados para permitir pruning (remoção) de itens que foram concluídos
		const fetchedBySala = {};
		rows.forEach(r=>{
			try{
				const salaKey = r.dep_direcionado || '';
				// tentar extrair número da sala (se estiver no formato "Sala X - Nome" ou apenas número)
				let salaNum = null;
				if(/^[0-9]+$/.test(String(salaKey))) salaNum = salaKey;
				else {
					// procurar correspondência com SALAS
					for(const k in SALAS){ if(String(SALAS[k]).indexOf(salaKey)!==-1 || SALAS[k].indexOf(salaKey)!==-1) { salaNum = k; break; } }
				}
				// se departamentoFiltro fornecido e não bate, pular
				if(departamentoFiltro && String(departamentoFiltro) !== String(salaNum)) return;
				if(!salaNum) return;
				fetchedBySala[salaNum] = fetchedBySala[salaNum] || { ids: new Set(), tickets: new Set() };
				if(r.id) fetchedBySala[salaNum].ids.add(String(r.id));
				if(r.senha) fetchedBySala[salaNum].tickets.add(String(r.senha));
				state.queues[salaNum] = state.queues[salaNum] || [];
				// apenas registros com concluido == null já foram filtrados na query
				// evitar duplicata por senha (campo senha)
				// Sempre re-criar a lista com base no resultado remoto (remoção de dados locais)
				state.queues[salaNum].push({ name: r.mucipe_nome || r.nome || '', document: r.munic_doc || '', preferencial: false, sala: parseInt(salaNum,10), ticket: r.senha || '', createdAt: r.created_at || r.createdAt, remoteId: r.id, remoteSynced: true });
			}catch(e){ /* silent */ }
		});
		// garantir que estado.serving reflita registro remoto ativo (se houver) para a sala em questão
		try{ if(!departamentoFiltro){ /* se sem filtro, não alteramos serving aqui */ } }catch(_){ }
		saveState();
		try{ if(currentDept) renderQueueForDept(currentDept); renderPublicPanel(); }catch(_){ }
		return rows;
	}catch(e){ console.warn('fetchRemoteAtendimentos exception', e); return []; }
}

// Chamar quando voltamos online para atualizar o contador remoto
window.addEventListener('online', ()=>{ fetchRemoteTodayCount(); });

// --- Busca de municipes (autocomplete) ---
const searchInput = document.getElementById('searchMunicipe');
const searchResultsEl = document.getElementById('searchResults');

async function searchMunicipes(q){
	q = (q||'').trim();
	if(!q) return [];
	// se supabase disponível, tentar pesquisa por nome ou documento (ilike)
	if(window.supabase){
		try{
			const { data, error } = await window.supabase.from('municipes').select('*').or(`nome.ilike.%${q}%,documento.ilike.%${q}%`).order('nome', { ascending: true }).limit(100);
			if(error){ console.warn('Supabase search municipes error', error); throw error; }
			const rows = data || [];
			// ordenar alfabeticamente por nome (case-insensitive, pt-BR)
			rows.sort((a,b)=>{
				const na = (a.nome || a.name || '').normalize('NFD').replace(/\p{Diacritic}/gu,'');
				const nb = (b.nome || b.name || '').normalize('NFD').replace(/\p{Diacritic}/gu,'');
				return na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
			});
			return rows.slice(0,10);
		}catch(e){ console.warn('searchMunicipes supabase failed', e); }
	}
	// fallback local
	state.municipes = state.municipes || [];
	const low = q.toLowerCase();
	const filtered = state.municipes.filter(m => (m.nome && m.nome.toLowerCase().includes(low)) || (m.documento && m.documento.toLowerCase().includes(low)));
	filtered.sort((a,b)=>{
		const na = (a.nome || '').normalize('NFD').replace(/\p{Diacritic}/gu,'');
		const nb = (b.nome || '').normalize('NFD').replace(/\p{Diacritic}/gu,'');
		return na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' });
	});
	return filtered.slice(0,10);
}

let searchTimer = null;
if(searchInput){
	searchInput.addEventListener('input', ()=>{
		clearTimeout(searchTimer);
		searchTimer = setTimeout(async ()=>{
			const q = searchInput.value.trim();
			const results = await searchMunicipes(q);
			// render results
			searchResultsEl.innerHTML = '';
			if(!results || results.length===0){ searchResultsEl.innerHTML = '<div class="search-empty">Nenhum resultado</div>'; return; }
			if(!results || results.length===0){ 
				searchResultsEl.innerHTML = '<div class="search-empty">Nenhum resultado</div>'; 
				// mostrar formulário inline para cadastro rápido
				const inlineReg = document.getElementById('inlineRegisterContainer');
				if(inlineReg) inlineReg.classList.remove('hidden');
				return; }
			results.forEach(r=>{
				const div = document.createElement('div');
				div.className = 'search-result-item';
				div.textContent = `${r.nome} — ${r.documento}`;
				div.addEventListener('click', ()=>{
					// preencher campos e definir selected
					selectedMunicipe = r;
					// atualizar caixa de info selecionado
					const selectedInfo = document.getElementById('selectedInfo');
					if(selectedInfo) selectedInfo.innerHTML = `<strong>${r.nome}</strong><br><small>${r.documento}</small>`;
					searchResultsEl.innerHTML = '';
					searchInput.value = '';
				});
				searchResultsEl.appendChild(div);
			});
		}, 300);
	});
}

// DOM refs
const receptionForm = document.getElementById('receptionForm');
const ticketIssuedEl = document.getElementById('ticketIssued');
const panelGrid = document.getElementById('panelGrid');
const dailyCountEl = document.getElementById('dailyCount');
// auth/user DOM refs
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const navUsers = document.getElementById('navUsers');
const screenLogin = document.getElementById('screen-login');
const screenUsers = document.getElementById('screen-users');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
// const cancelLogin = document.getElementById('cancelLogin'); // botão removido da UI
const userForm = document.getElementById('userForm');
const userEmail = document.getElementById('userEmail');
const userPassword = document.getElementById('userPassword');
const userPasswordConfirm = document.getElementById('userPasswordConfirm');
const userDept = document.getElementById('userDept');
const usersList = document.getElementById('usersList');
const cancelUser = document.getElementById('cancelUser');

// departamento (tela dinâmica)
const deptTitle = document.getElementById('deptTitle');
const deptCallNext = document.getElementById('deptCallNext');
const deptRecall = document.getElementById('deptRecall');
const deptQueueList = document.getElementById('deptQueueList');
let currentDept = null;

// Inicializar painel público
function renderPublicPanel(){
	if(!panelGrid) return;
	panelGrid.innerHTML = '';
	for(let i=1;i<=NUM_SALAS;i++){
		const div = document.createElement('div');
		div.className = 'panel-item';
		const serving = state.serving[i];
		// usar o rótulo completo definido em SALAS quando disponível (evita duplicar "Sala X - ...")
		const label = SALAS[i] || `Sala ${i}`;
		div.innerHTML = `<strong>${label}</strong><div>${serving ? (serving.display) : '<em>vazio</em>'}</div>`;
		panelGrid.appendChild(div);
	}
}

function renderQueueForDept(sala){
	if(!deptQueueList) return;
	deptQueueList.innerHTML = '';
	// usar apenas dados remotos para o painel do departamento
	const arr = (state.queues && state.queues[sala]) ? (state.queues[sala].slice()) : [];
	// badge indicando origem dos itens: Remoto / Local / Remoto + Local
	const hasRemote = Array.isArray(arr) && arr.length>0; // todos são remotos
	const hasLocal = false;
	const badge = document.createElement('div');
	badge.style.marginBottom = '6px';
	badge.style.fontSize = '0.85rem';
	let badgeText = 'Fonte: Local';
	let badgeColor = '#374151';
	if(hasRemote && hasLocal){ badgeText = 'Fonte: Remoto + Local'; badgeColor = '#065f46'; }
	else if(hasRemote){ badgeText = 'Fonte: Remoto'; badgeColor = '#065f46'; }
	else { badgeText = 'Fonte: Local'; badgeColor = '#374151'; }
	badge.style.color = badgeColor;
	badge.textContent = badgeText;
	// tornar badge clicável para forçar fetch imediato quando o usuário clicar no corner badge
	badge.style.cursor = 'pointer';
	badge.title = 'Clique para forçar atualização remota desta sala';
	badge.addEventListener('click', async ()=>{
		try{
			if(window.supabase && window.navigator.onLine){
				await fetchRemoteAtendimentos(sala);
				await fetchRemoteServing(sala);
				renderQueueForDept(sala);
				renderDeptCurrentServing(sala);
			} else {
				alert('Sem conexão com o Supabase.');
			}
		}catch(e){ console.warn('forced refresh failed', e); }
	});
	// posicionar no canto superior direito do container de fila
	badge.style.position = 'absolute';
	badge.style.right = '12px';
	badge.style.top = '8px';
	deptQueueList.style.position = 'relative';
	deptQueueList.appendChild(badge);
    if(arr.length===0){ deptQueueList.innerHTML = '<p>Nenhuma pessoa na fila.</p>'; return; }
	arr.forEach((item,idx)=>{
        const div = document.createElement('div');
        div.className = 'queue-item';
		// todos os itens são remotos aqui; mostrar badge verde de sincronizado
		const syncBadge = '<span title="Remoto" style="color:green;margin-left:6px;">●</span>';
		div.innerHTML = `<div><strong>${item.name}</strong> ${item.preferencial?'<span style="color:#b45309">(P)</span>':''}<br><small>${item.document}</small></div><div>${item.ticket} ${syncBadge}</div>`;
        deptQueueList.appendChild(div);
    });
}

// buscar atendimento ativo remoto (concluido = false) para uma sala específica e atualizar state.serving
async function fetchRemoteServing(departamentoFiltro){
	if(!window.supabase) return null;
	try{
		// buscar registro marcado como em atendimento (concluido = false) para o departamento
		const q = window.supabase.from('atendimentos').select('*').eq('concluido', false).order('inicio_atendimento', { ascending: true }).limit(1);
		if(departamentoFiltro) q.eq('dep_direcionado', String(departamentoFiltro));
		const { data, error } = await q;
		if(error){ console.warn('fetchRemoteServing error', error); return null; }
		const rows = Array.isArray(data) ? data : [];
		if(rows.length === 0){
			// limpar serving local para a sala
			if(state.serving && state.serving[departamentoFiltro]){ state.serving[departamentoFiltro] = null; saveState(); }
			return null;
		}
		const rec = rows[0];
		// mapear sala
		const salaKey = rec.dep_direcionado || '';
		let salaNum = null;
		if(/^[0-9]+$/.test(String(salaKey))) salaNum = String(salaKey);
		else { for(const k in SALAS){ if(String(SALAS[k]).indexOf(salaKey)!==-1 || SALAS[k].indexOf(salaKey)!==-1) { salaNum = String(k); break; } } }
		if(!salaNum) return null;
		state.serving = state.serving || {};
		state.serving[salaNum] = { name: rec.mucipe_nome || rec.nome || '', document: rec.munic_doc || '', sala: parseInt(salaNum,10), ticket: rec.senha || '', remoteId: rec.id, remoteSynced: true, inicio_atendimento: rec.inicio_atendimento || null };
		saveState();
		return state.serving[salaNum];
	}catch(e){ console.warn('fetchRemoteServing exception', e); return null; }
}

// --- Current serving card for department panels ---
function escapeHtml(str) {
		if (str === null || str === undefined) return '';
		return String(str)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
}

// Formata timestamp no formato local sem informação de fuso (YYYY-MM-DD HH:MM:SS)
function formatLocalTimestamp(input){
	const d = input ? new Date(input) : new Date();
	const pad = (n)=> String(n).padStart(2,'0');
	return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderCurrentServingHTML(serving){
		// não renderizar placeholder vazio; somente retornar HTML quando houver atendimento
		if(!serving) return '';
		const name = serving.name || serving.nome || '';
		const ticket = serving.ticket || serving.senha || '';
		const doc = serving.document || serving.documento || '';
		const initial = name && name[0] ? name[0].toUpperCase() : '•';
		// HTML mais trabalhado: nome em destaque, documento em linha menor e ticket no canto
		return `\
		<div class="current-serving dept-panel">\
		  <div class="left">\
		    <div class="avatar">${escapeHtml(initial)}</div>\
		    <div class="info">\
		      <div class="name">${escapeHtml(name)}</div>\
		      <div class="meta">${doc ? 'Documento: ' + escapeHtml(doc) : 'Documento: '}</div>\
		      <div class="meta-line">Endereço: ${escapeHtml(serving.endereco || serving.address || '')}</div>\
		      <div class="meta-line">Bairro: ${escapeHtml(serving.bairro || serving.neighborhood || '')}</div>\
		      <div class="meta-line">Cidade: ${escapeHtml(serving.cidade || serving.city || '')}</div>\
		      <div class="meta-line">Telefone: ${escapeHtml(serving.telefone || serving.phone || '')}</div>\
		    </div>\
		  </div>\
		  <div class="ticket-actions">\
		    <div class="ticket">${escapeHtml(ticket)}</div>\
		    <div class="actions-right">\
		      <button class="btn-complete" data-sala="${escapeHtml(String(serving.sala || serving.sala || ''))}">Completar Cadastro</button>\
		      <button class="btn-close" data-sala="${escapeHtml(String(serving.sala || serving.sala || ''))}">Encerrar Atendimento</button>\
		    </div>\
		  </div>\
		</div>`;
}

function renderDeptCurrentServing(sala){
		try{
				const titleEl = document.getElementById('deptTitle');
				if(!titleEl) return;
				// remove existing current-serving if presente
				const existing = document.querySelector('.current-serving.dept-panel');
				if(existing) existing.remove();
				const serving = state.serving && state.serving[sala] ? state.serving[sala] : null;
				const html = renderCurrentServingHTML(serving);
				// inserir logo após o título
			titleEl.insertAdjacentHTML('afterend', html); 
			// anexar handlers para botões do card (se presentes)
			attachCardHandlers();
		}catch(e){ console.warn('renderDeptCurrentServing error', e); }
}

function attachCardHandlers(){
	// delegação simples: procura botões recém-criados e anexa listeners
	const card = document.querySelector('.current-serving.dept-panel');
	if(!card) return;
	const btnComplete = card.querySelector('.btn-complete');
	const btnClose = card.querySelector('.btn-close');
	if(btnComplete){
		btnComplete.removeEventListener('click', onCompleteClick);
		btnComplete.addEventListener('click', onCompleteClick);
	}
	if(btnClose){
		btnClose.removeEventListener('click', onCloseClick);
		btnClose.addEventListener('click', onCloseClick);
	}
}

function onCompleteClick(e){
	// abrir formulário inline abaixo do cartão para completar cadastro sem remover da sala
	const card = e.currentTarget.closest('.current-serving.dept-panel');
	if(!card) return;
	// identificar sala e munícipe
	const sala = currentDept;
	const serving = sala && state.serving && state.serving[sala] ? state.serving[sala] : null;
	if(!serving) return;
	// criar container de edição se não existir
	let editBox = card.querySelector('.complete-edit-box');
	if(editBox){ editBox.remove(); }
	editBox = document.createElement('div');
	editBox.className = 'complete-edit-box';
	editBox.innerHTML = `
		<div style="margin-top:10px;padding:10px;border-radius:8px;background:#fff;border:1px solid #eef6ff">
			<label>Documento:<br/><input type="text" class="cmp-document" value="${escapeHtml(serving.document || serving.documento || '')}" /></label>
			<label>Endereço:<br/><input type="text" class="cmp-endereco" value="${escapeHtml(serving.endereco || serving.address || '')}" /></label>
			<label>Bairro:<br/><input type="text" class="cmp-bairro" value="${escapeHtml(serving.bairro || serving.neighborhood || '')}" /></label>
			<label>Cidade:<br/><input type="text" class="cmp-cidade" value="${escapeHtml(serving.cidade || serving.city || '')}" /></label>
			<label>Telefone:<br/><input type="text" class="cmp-telefone" value="${escapeHtml(serving.telefone || serving.phone || '')}" /></label>
			<div style="margin-top:8px;text-align:right">
				<button class="btn-cancel-complete">Cancelar</button>
				<button class="btn-save-complete">Confirmar alterações</button>
			</div>
		</div>
	`;
	card.appendChild(editBox);
	// handlers
	const btnCancel = editBox.querySelector('.btn-cancel-complete');
	const btnSave = editBox.querySelector('.btn-save-complete');
	if(btnCancel) btnCancel.addEventListener('click', ()=>{ editBox.remove(); });
	if(btnSave) btnSave.addEventListener('click', async ()=>{
		// coletar dados
		const doc = editBox.querySelector('.cmp-document').value.trim();
		const endereco = editBox.querySelector('.cmp-endereco').value.trim();
		const bairro = editBox.querySelector('.cmp-bairro').value.trim();
		const cidade = editBox.querySelector('.cmp-cidade').value.trim();
		const telefone = editBox.querySelector('.cmp-telefone').value.trim();
		// atualizar state.municipes / serving
		state.municipes = state.municipes || [];
		let muni = null;
		// tentar achar por documento
		if(doc) muni = state.municipes.find(m=>m.documento === doc || m.documento === (serving.document || serving.documento));
		if(!muni && serving){
			muni = state.municipes.find(m=>m.documento === (serving.document || serving.documento));
		}
		if(!muni){
			muni = { nome: serving.name || serving.nome || '', documento: doc || (serving.document||serving.documento||''), preferencial: !!serving.preferencial };
			state.municipes.push(muni);
		}
		muni.endereco = endereco;
		muni.bairro = bairro;
		muni.cidade = cidade;
		muni.telefone = telefone;
		saveState();
		// atualizar serving também
		serving.endereco = endereco; serving.bairro = bairro; serving.cidade = cidade; serving.telefone = telefone;
		state.serving = state.serving || {};
		state.serving[sala] = serving;
		saveState();
		// tentar enviar ao Supabase (upsert na tabela municipes)
		try{
			await updateMunicipeDetails(muni);
			alert('Dados atualizados com sucesso.');
			// re-render cartão
			const old = document.querySelector('.current-serving.dept-panel'); if(old) old.remove();
			renderDeptCurrentServing(sala);
		}catch(e){
			console.warn('updateMunicipeDetails failed', e);
			alert('Atualização falhou — dados salvos localmente e serão sincronizados.');
			// se erro de permissão (401) ou RLS (42501), enfileirar para tentar depois
			if(!muni.localId) muni.localId = 'local-' + Date.now() + '-' + Math.floor(Math.random()*1000);
			enqueueSync({ type: 'createMunicipe', payload: { name: muni.nome, document: muni.documento, preferencial: !!muni.preferencial, localId: muni.localId } });
		}
	});
}

// função para atualizar/inscrever detalhes do munícipe no Supabase
async function updateMunicipeDetails(muni){
    // muni: { nome, documento, endereco, bairro, cidade, telefone, id?, localId }
    state.municipes = state.municipes || [];
    try{
        if(window.supabase){
			const payload = {
				nome: muni.nome,
				documento: muni.documento,
				preferencial: !!muni.preferencial,
				endereco: muni.endereco || muni.address || '',
				bairro: muni.bairro || muni.neighborhood || '',
				cidade: muni.cidade || muni.city || '',
				telefone: muni.telefone || muni.phone || '',
				created_at: muni.createdAt || formatLocalTimestamp()
			};
			// upsert para evitar duplicates
			console.info('[updateMunicipeDetails] payload:', payload);
			const upsertMunQ = window.supabase.from('municipes').upsert([payload], { onConflict: ['documento'] });
			const { data, error } = await upsertMunQ.select().maybeSingle();
			if(error){ console.error('updateMunicipeDetails supabase error', error); 
				// em caso de erro de RLS ou not-null, rethrow para fallback/enfileiramento
				throw error; }
            // atualizar cache local com dados retornados
            const idx = state.municipes.findIndex(x=>x.documento === (data && data.documento) );
            if(idx !== -1) state.municipes[idx] = { ...state.municipes[idx], nome: data.nome, documento: data.documento, endereco: data.endereco, bairro: data.bairro, cidade: data.cidade, telefone: data.telefone, id: data.id };
            else state.municipes.push({ nome: data.nome, documento: data.documento, endereco: data.endereco, bairro: data.bairro, cidade: data.cidade, telefone: data.telefone, id: data.id });
            saveState();
            return data;
        } else {
            // offline: persistimos localmente e enfileiramos
            if(!muni.localId) muni.localId = 'local-' + Date.now() + '-' + Math.floor(Math.random()*1000);
            const exists = state.municipes.find(x=>x.localId === muni.localId || x.documento === muni.documento);
            if(!exists) state.municipes.push(muni);
            enqueueSync({ type: 'createMunicipe', payload: { name: muni.nome, document: muni.documento, preferencial: !!muni.preferencial, localId: muni.localId } });
            saveState();
            return muni;
        }
    }catch(e){
        throw e;
    }
}

async function onCloseClick(e){
	const card = e.currentTarget.closest('.current-serving.dept-panel');
	if(!card) return;
	// identificar sala a partir do título atual (deptTitle contém o nome)
	const sala = currentDept;
	if(!sala) return;
	if(!confirm('Confirma encerrar este atendimento?')) return;
	// marcar endedAt no histórico para o atendimento atual
	const serving = state.serving && state.serving[sala] ? state.serving[sala] : null;
	const endedAt = formatLocalTimestamp();
	if(serving){
		// adicionar ao history um encerramento (ou atualizar registro existente)
		state.history = state.history || [];
		// procurar último hist com mesmo ticket e sala
		let histIdx = -1;
		for(let i=state.history.length-1;i>=0;i--){
			if(state.history[i].ticket === serving.ticket && state.history[i].sala === parseInt(sala,10)) { histIdx = i; break; }
		}
		if(histIdx !== -1){ state.history[histIdx].endedAt = endedAt; }
		else {
			state.history.push({ name: serving.name, document: serving.document || serving.documento, sala: parseInt(sala,10), departamento: SALAS[sala], ticket: serving.ticket, datetime: formatLocalTimestamp(), endedAt });
		}
		saveState();
		// tentar atualizar atendimento remoto (se já tiver remoteId)
				if(serving.remoteId && window.supabase && window.navigator.onLine){
			try{
				const { error } = await window.supabase.from('atendimentos').update({ concluido: true }).eq('id', serving.remoteId);
				if(error){ console.warn('update concluido supabase failed', error); enqueueSync({ type: 'updateAtendimento', payload: { remoteId: serving.remoteId, concluido: true } }); }
			}catch(e){ console.warn('update concluido exception', e); enqueueSync({ type: 'updateAtendimento', payload: { remoteId: serving.remoteId, concluido: true } }); }
		} else if(serving.remoteId){
			// sem conexão, enfileirar
			enqueueSync({ type: 'updateAtendimento', payload: { remoteId: serving.remoteId, concluido: true } });
		}
	}
	// limpar atendimento local (não chamar próximo automaticamente)
	state.serving = state.serving || {};
	state.serving[sala] = null;
	saveState();
	renderPublicPanel();
	renderQueueForDept(sala);
	// remover card
	const existing = document.querySelector('.current-serving.dept-panel');
	if(existing) existing.remove();
	alert('Atendimento encerrado.');
}

function enableDeptControlsFor(sala){
    deptCallNext.disabled = !sala;
    deptRecall.disabled = !sala || !state.serving[sala];
}

// Chamar próximo: preferenciais primeiro (FIFO entre preferenciais), depois não preferenciais FIFO
async function callNextFor(sala){
    if(!sala) return;
	// se já existe um atendimento em andamento nesta sala, concluí-lo primeiro
	try{
		const current = state.serving && state.serving[sala] ? state.serving[sala] : null;
		if(current){
			// marcar histórico de encerramento
			const endedAt = formatLocalTimestamp();
			state.history = state.history || [];
			// tentar atualizar registro existente no histórico (último com mesmo ticket/sala)
			let histIdx = -1;
			for(let i=state.history.length-1;i>=0;i--){ if(state.history[i].ticket === current.ticket && state.history[i].sala === parseInt(sala,10)) { histIdx = i; break; } }
			if(histIdx !== -1){ state.history[histIdx].endedAt = endedAt; }
			else { state.history.push({ name: current.name, document: current.document || current.documento, sala: parseInt(sala,10), departamento: SALAS[sala], ticket: current.ticket, datetime: formatLocalTimestamp(current.calledAt || Date.now()), endedAt }); }
			// tentar atualizar remoto imediatamente
			if(window.supabase && window.navigator.onLine){
				try{
					if(current.remoteId){
						const { error } = await window.supabase.from('atendimentos').update({ concluido: true }).eq('id', current.remoteId);
						if(error){ console.warn('callNextFor: failed to mark current atendimento concluido', error); alert('Aviso: falha ao concluir atendimento no servidor.'); }
					} else {
						// sem remoteId, criar registro remoto marcado como concluído
						const payload = { mucipe_nome: current.name, munic_doc: current.document || '', dep_direcionado: current.sala ? String(current.sala) : String(sala), senha: current.ticket, created_at: formatLocalTimestamp(current.createdAt || Date.now()), inicio_atendimento: current.inicio_atendimento || null, concluido: true };
						const { data, error } = await window.supabase.from('atendimentos').insert([payload]).select().maybeSingle();
						if(error){ console.warn('callNextFor: failed to insert concluded atendimento', error); alert('Aviso: falha ao gravar encerramento no servidor.'); }
						else { current.remoteId = data && data.id; current.remoteSynced = true; }
					}
				}catch(e){ console.warn('callNextFor: exception updating current atendimento', e); alert('Erro ao comunicar com o servidor ao concluir atendimento.'); }
			} else {
				// modo online-only: exigir conexão
				alert('Operação requer conexão com o servidor para concluir atendimento em andamento. Tente quando estiver online.');
				return; // abortar chamada ao próximo até que a conclusão seja confirmada
			}
			// limpar atendimento local após conclusão
			state.serving = state.serving || {};
			state.serving[sala] = null;
			saveState();
			renderPublicPanel();
			renderQueueForDept(sala);
		}
	}catch(err){ console.warn('Erro ao concluir atendimento atual antes de chamar próximo', err); }
    const q = state.queues[sala];
    if(!q || q.length===0){
        state.serving[sala] = null;
        saveState();
        renderPublicPanel();
        renderQueueForDept(sala);
        enableDeptControlsFor(sala);
        alert('Nenhuma pessoa na fila para esta sala.');
        return;
    }

    // encontrar primeiro preferencial
    let index = q.findIndex(x=>x.preferencial);
    if(index===-1) index = 0; // pega primeiro não preferencial
    const next = q.splice(index,1)[0];
    const display = `${next.name} — ${next.ticket}`;
    state.serving[sala] = { ...next, display, calledAt: Date.now() };
    saveState();
    renderPublicPanel();
    renderQueueForDept(sala);
    enableDeptControlsFor(sala);

	// registrar histórico: quando chamado para atendimento consideramos que entrou em atendimento
    const hist = {
		name: next.name,
		document: next.document,
		departamento: SALAS[sala],
		sala: parseInt(sala,10),
		datetime: formatLocalTimestamp(),
		ticket: next.ticket
	};
	state.history = state.history || [];
	state.history.push(hist);
	saveState();
	// atualizar cartão do departamento se estivermos na tela desta sala
	if(currentDept && parseInt(currentDept,10) === parseInt(sala,10)) renderDeptCurrentServing(sala);

	// registrar inicio_atendimento imediato no Supabase quando possível
	try{
		const at = state.serving[sala];
		const inicioTs = formatLocalTimestamp();
		// atualizar localmente o objeto com inicio
		at.inicio_atendimento = inicioTs;
		saveState();
		// se existir remoteId, atualizar apenas o registro remoto
				if(at.remoteId && window.supabase && window.navigator.onLine){
			try{
				// marcar inicio e definir concluido = false para representar atendimento ativo
				const { error } = await window.supabase.from('atendimentos').update({ inicio_atendimento: inicioTs, concluido: false }).eq('id', at.remoteId);
				if(error){ console.warn('update inicio_atendimento supabase failed', error); enqueueSync({ type: 'updateAtendimento', payload: { remoteId: at.remoteId, inicio_atendimento: inicioTs, concluido: false } }); }
			}catch(e){ console.warn('update inicio_atendimento exception', e); enqueueSync({ type: 'updateAtendimento', payload: { remoteId: at.remoteId, inicio_atendimento: inicioTs, concluido: false } }); }
		} else {
				// sem remoteId: tentar inserir um registro remoto com inicio_atendimento
			if(window.supabase && window.navigator.onLine){
				try{
					const payload = { mucipe_nome: at.name, munic_doc: at.document, dep_direcionado: at.sala.toString(), senha: at.ticket, created_at: formatLocalTimestamp(at.createdAt), inicio_atendimento: inicioTs, concluido: false };
					const { data, error } = await window.supabase.from('atendimentos').insert([payload]).select().maybeSingle();
					if(error){ console.warn('insert inicio_atendimento failed', error); // enfileirar para retry
						// enfileira payload com inicio_atendimento para criar posteriormente
						enqueueSync({ type: 'createAtendimento', payload: { ...at, inicio_atendimento: inicioTs } });
					} else {
						// atualizar referência local
						at.remoteId = data && data.id;
						at.remoteSynced = true;
						saveState();
					}
				}catch(e){ console.warn('insert inicio_atendimento exception', e); enqueueSync({ type: 'createAtendimento', payload: { ...at, inicio_atendimento: inicioTs } }); }
			} else {
				// offline: enfileirar criação contendo inicio_atendimento para ser aplicada no servidor
				enqueueSync({ type: 'createAtendimento', payload: { ...at, inicio_atendimento: inicioTs } });
			}
		}
	}catch(e){ console.warn('callNextFor inicio_atendimento handling failed', e); }
}

function recallFor(sala){
    if(!sala) return;
    const serving = state.serving[sala];
    if(!serving){ alert('Nenhuma pessoa está sendo atendida nesta sala.'); return; }
    serving.recalledAt = Date.now();
    state.serving[sala] = serving;
    saveState();
    renderPublicPanel();
    alert(`Chamando novamente: ${serving.display}`);
	// atualizar cartão do departamento se estivermos na tela desta sala
	if(currentDept && parseInt(currentDept,10) === parseInt(sala,10)) renderDeptCurrentServing(sala);
}

// Recepção: cria ticket e adiciona à fila
// variável para munícipe selecionado a partir da busca
let selectedMunicipe = null;

if(receptionForm){
    receptionForm.addEventListener('submit', async (e)=>{
    	e.preventDefault();
    	// usar selectedMunicipe quando disponível (pré-cadastro ou busca)
    	let name = '';
    	let documentEl = '';
    	let preferencial = false;
    	if(selectedMunicipe){
    		name = selectedMunicipe.nome || selectedMunicipe.name || '';
    		documentEl = selectedMunicipe.documento || selectedMunicipe.document || '';
    		preferencial = !!selectedMunicipe.preferencial;
    	} else {
    		// fallback para campos inline caso existam
    		const nomeField = document.getElementById('nome');
    		const docField = document.getElementById('documento');
    		const prefField = document.getElementById('preferencial');
    		if(nomeField) name = nomeField.value.trim();
    		if(docField) documentEl = docField.value.trim();
    		if(prefField) preferencial = prefField.checked;
    	}
    	const sala = (document.getElementById('sala') || {}).value;
    	if(!name || !documentEl || !sala){ alert('Preencha todos os campos.'); return; }

    	state.lastTicket = (state.lastTicket || 0) + 1;
    	const ticket = formatTicket(state.lastTicket, sala);
    	const entry = { id: state.lastTicket, name, document: documentEl, preferencial, sala, ticket, createdAt: Date.now() };

    	// inserir: se preferencial, inserir antes do primeiro não preferencial (mas depois de outros preferenciais)
    	if(preferencial){
    		const q = state.queues[sala];
    		let idx = q.findIndex(x=>!x.preferencial);
    		if(idx===-1) q.push(entry); else q.splice(idx,0,entry);
    	} else {
    		state.queues[sala].push(entry);
    	}

    				saveState();
    					saveState();
    					ticketIssuedEl.textContent = `Registro realizado. Dirija-se à sala ${sala}. Senha: ${ticket}`;
    						// incrementar contador diário (pessoa passou pela recepção)
    						incrementDailyCount();
    						// tentar enviar ao Supabase (opcional). Se falhar, enfileirar para sincronizar depois
    						try{
    							if(window.supabase && window.navigator.onLine){
    								const res = await pushAtendimentoToDb(entry);
    								if(!res || !res.success){
    									// push falhou, enfileirar
    									entry.remoteSynced = false;
    									enqueueSync({ type: 'createAtendimento', payload: entry });
    								} else {
    									entry.remoteSynced = true;
    									entry.remoteId = res.data && res.data.id;
    								}
    							} else {
    								// enfileira para sincronização
    								entry.remoteSynced = false;
    								enqueueSync({ type: 'createAtendimento', payload: entry });
    							}
    						}catch(e){
    							console.warn('pushAtendimento failed, enqueueing', e);
    							entry.remoteSynced = false;
    							enqueueSync({ type: 'createAtendimento', payload: entry });
    						}
						// atualizar contador remoto/local imediatamente
						try{ if(window.supabase && window.navigator.onLine) fetchRemoteTodayCount(); }catch(_){ }
    			receptionForm.reset();
				// limpar seleção e esconder formulário inline caso esteja aberto
				selectedMunicipe = null;
				const selectedInfoEl = document.getElementById('selectedInfo');
				if(selectedInfoEl) selectedInfoEl.innerHTML = 'Nenhum munícipe selecionado';
				const searchEl = document.getElementById('searchMunicipe'); if(searchEl) searchEl.value = '';
				const nomeField = document.getElementById('nome'); if(nomeField) nomeField.value = '';
				const docField = document.getElementById('documento'); if(docField) docField.value = '';
    			const inlineRegContainer = document.getElementById('inlineRegisterContainer');
    			if(inlineRegContainer) inlineRegContainer.classList.add('hidden');
    			if(searchResultsEl) searchResultsEl.innerHTML = '';
    			renderPublicPanel();
    			if(currentDept && parseInt(currentDept,10) === parseInt(sala,10)) renderQueueForDept(sala);
    });
}


// --- Recepção etapa 1: cadastro do munícipe ---
const receptionRegisterForm = document.getElementById('receptionRegisterForm');
const regCancelBtn = document.getElementById('reg_cancel');

async function createMunicipe(m){
	// m: { name, document, preferencial }
	state.municipes = state.municipes || [];
	// gerar localId para referencia quando criado offline
	const localId = 'local-' + Date.now() + '-' + Math.floor(Math.random()*1000);
	try{
		if(window.supabase){
			// tentar inserir na tabela 'municipes' e retornar o registro criado
			const payload = { nome: m.name, documento: m.document, preferencial: m.preferencial, created_at: formatLocalTimestamp() };
			// usar upsert com onConflict para evitar erro de chave única (documento)
			console.info('[createMunicipe] payload:', payload);
			const upsertMunQ = window.supabase.from('municipes').upsert([payload], { onConflict: ['documento'] });
			const { data, error } = await upsertMunQ.select().maybeSingle();
			if(error){ console.error('[createMunicipe] upsert error', error); throw error; }
			// armazenar localmente também (fallback/offline)
			state.municipes.push({ nome: data.nome, documento: data.documento, preferencial: data.preferencial, id: data.id, createdAt: data.created_at });
			saveState();
			return { nome: data.nome, documento: data.documento, id: data.id, preferencial: data.preferencial };
		} else {
			// fallback: gravar localmente
			const existing = state.municipes.find(x=>x.documento === m.document);
			if(existing) return existing;
			const rec = { nome: m.name, documento: m.document, preferencial: m.preferencial, createdAt: formatLocalTimestamp(), localId };
			state.municipes.push(rec);
			// enfileirar criação remota para quando online
			enqueueSync({ type: 'createMunicipe', payload: { name: m.name, document: m.document, preferencial: m.preferencial, localId } });
			saveState();
			return rec;
		}
	}catch(e){
		// em caso de erro com Supabase, fallback local
		console.warn('createMunicipe fallback local', e);
		const existing = state.municipes.find(x=>x.documento === m.document);
		if(existing) return existing;
	const rec = { nome: m.name, documento: m.document, preferencial: m.preferencial, createdAt: formatLocalTimestamp(), localId };
		state.municipes.push(rec);
		enqueueSync({ type: 'createMunicipe', payload: { name: m.name, document: m.document, preferencial: m.preferencial, localId } });
		saveState();
		return rec;
	}
}

if(receptionRegisterForm){
	receptionRegisterForm.addEventListener('submit', async (ev)=>{
		ev.preventDefault();
		const name = document.getElementById('reg_nome').value.trim();
		const doc = document.getElementById('reg_documento').value.trim();
		const pref = document.getElementById('reg_preferencial').checked;
		if(!name || !doc){ alert('Preencha nome e documento.'); return; }
		// criar munícipe (Supabase quando disponível, senão local)
		const mun = await createMunicipe({ name, document: doc, preferencial: pref });
		// preencher o formulário principal de recepção com os dados retornados
		// marcar como selecionado
		selectedMunicipe = mun;
		const selectedInfo = document.getElementById('selectedInfo');
		if(selectedInfo) selectedInfo.innerHTML = `<strong>${mun.nome}</strong><br><small>${mun.documento}</small>`;
		// navegar para a etapa de direcionamento
		location.hash = 'reception';
		handleHash();
		alert('Munícipe cadastrado. Agora selecione o departamento e confirme o atendimento.');
	});
}

if(regCancelBtn){
	regCancelBtn.addEventListener('click', ()=>{
		location.hash = 'reception';
		handleHash();
	});
}

// botao abrir pré-cadastro removido do HTML, listener removido

// handler para pré-cadastro (direita)
const preCadastroForm = document.getElementById('preCadastroForm');
if(preCadastroForm){
	preCadastroForm.addEventListener('submit', async (ev)=>{
		ev.preventDefault();
		const name = document.getElementById('pre_nome').value.trim();
		const doc = document.getElementById('pre_documento').value.trim();
		const pref = document.getElementById('pre_preferencial').checked;
		if(!name || !doc){ alert('Nome e documento são obrigatórios'); return; }
		const mun = await createMunicipe({ name, document: doc, preferencial: pref });
		// atualizar selectedInfo para confirmar
		const selectedInfo = document.getElementById('selectedInfo');
		if(selectedInfo) selectedInfo.innerHTML = `<strong>${mun.nome}</strong><br><small>${mun.documento}</small>`;
		// marcar como selecionado para permitir criar atendimento imediatamente
		selectedMunicipe = mun;
		alert('Munícipe pré-cadastrado com sucesso. Você pode agora criar o atendimento no painel à esquerda.');
		preCadastroForm.reset();
	});
}

// Handlers para formulário inline de cadastro (quando não há resultados)
const receptionInlineRegisterForm = document.getElementById('receptionInlineRegisterForm');
const inlineRegCancel = document.getElementById('inline_reg_cancel');
const inlineRegContainer = document.getElementById('inlineRegisterContainer');
if(receptionInlineRegisterForm){
	receptionInlineRegisterForm.addEventListener('submit', async (ev)=>{
		ev.preventDefault();
		const name = document.getElementById('inline_reg_nome').value.trim();
		const doc = document.getElementById('inline_reg_documento').value.trim();
		const pref = document.getElementById('inline_reg_preferencial').checked;
		if(!name || !doc){ alert('Nome e documento são obrigatórios'); return; }
		const mun = await createMunicipe({ name, document: doc, preferencial: pref });
		// preencher recepção
		const nomeEl = document.getElementById('nome');
		const docEl = document.getElementById('documento');
		const prefEl = document.getElementById('preferencial');
		if(nomeEl) nomeEl.value = mun.nome || name;
		if(docEl) docEl.value = mun.documento || doc;
		if(prefEl) prefEl.checked = !!mun.preferencial;
		selectedMunicipe = mun;
		// esconder inline e limpar resultados
		if(inlineRegContainer) inlineRegContainer.classList.add('hidden');
		if(searchResultsEl) searchResultsEl.innerHTML = '';
		receptionInlineRegisterForm.reset();
		alert('Munícipe cadastrado com sucesso. Agora selecione o departamento e crie o atendimento.');
	});
}
if(inlineRegCancel){
	inlineRegCancel.addEventListener('click', ()=>{
		if(inlineRegContainer) inlineRegContainer.classList.add('hidden');
	});
}

// botões do departamento (tela)
if(deptCallNext) deptCallNext.addEventListener('click', ()=>{ if(currentDept) callNextFor(currentDept); });
if(deptRecall) deptRecall.addEventListener('click', ()=>{ if(currentDept) recallFor(currentDept); });

// Roteamento simples por hash
function showScreen(id){
	document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
	const el = document.getElementById(id);
	if(el) el.classList.remove('hidden');
	// atualizar UI do header/ações sempre que trocamos de tela
	try{ updateAuthUI(); }catch(e){ /* silent */ }
}

function handleHash(){
	const h = location.hash.replace('#','');
	// parar polling de dept anterior sempre que trocamos de tela
	try{ stopDeptPolling(); }catch(_){ }
	// checar permissões com base em state.currentUser
	const current = state.currentUser;
	const role = current ? current.role : null; // 'adm' or sala number
	// se não estiver logado, forçar tela de login (exceto quando já estiver em login)
	if(!role && h !== 'login'){
		location.hash = 'login';
		showScreen('screen-login');
		return;
	}
	// se o usuário for da recepção, ele só pode acessar a tela de recepção
	if(role === 'recepcao' && h !== 'reception' && h !== 'login'){
		// redirecionar silenciosamente para recepção e bloquear acesso
		alert('Acesso restrito: usuários da Recepção só podem acessar a aba Recepção.');
		location.hash = 'reception';
		showScreen('screen-reception');
		return;
	}
	// se o usuário estiver vinculado a uma sala específica (role numérica), permitir somente o painel dessa sala
	if(role && (/^\d+$/.test(String(role)))){
		const myDept = String(role);
		// permitir login explicitamente
		if(h !== 'login'){
			// se não estiver tentando acessar o dept correto, redirecionar
			if(!h.startsWith('dept-') || h.split('-')[1] !== myDept){
				alert('Acesso restrito: seu usuário só permite acessar o painel da sua sala.');
				location.hash = 'dept-' + myDept;
				// renderizar diretamente a tela do departamento
				currentDept = myDept;
				showScreen('screen-department');
				deptTitle.textContent = SALAS[myDept];
				renderQueueForDept(myDept);
				renderDeptCurrentServing(myDept);
				enableDeptControlsFor(myDept);
				return;
			}
		}
	}
	
	// permitir a tela de login explicitamente
	if(h === 'login'){
		showScreen('screen-login');
		return;
	}
	if(!h || h==='reception'){
		showScreen('screen-reception');
		// atualizar contador remoto quando entramos na tela de recepção
		if(window.supabase && window.navigator.onLine) fetchRemoteTodayCount();
		// também atualizar filas gerais no background para manter tudo sincronizado
		if(window.supabase && window.navigator.onLine) fetchRemoteAtendimentos().catch(()=>{});
		currentDept = null;
	} else if(h==='public'){
		// painel público acessível apenas se admin ou qualquer usuário
		showScreen('screen-public');
		currentDept = null;
		// atualizar filas públicas/remotas ao abrir painel público
		if(window.supabase && window.navigator.onLine) fetchRemoteAtendimentos().then(()=>{ renderPublicPanel(); }).catch(()=>{ renderPublicPanel(); });
		else renderPublicPanel();
	} else if(h==='departments'){
		// departments list: apenas adm
		if(!role || role!=='adm'){
			location.hash = 'reception'; return;
		}
		showScreen('screen-departments');
		currentDept = null;
		// garantir dados remotos atualizados
		if(window.supabase && window.navigator.onLine) fetchRemoteAtendimentos().catch(()=>{});
	} else if(h==='users'){
		// tela de usuários (apenas admin)
		if(!role || role!=='adm'){
			location.hash = 'reception'; return;
		}
		showScreen('screen-users');
		// Renderizar apenas usuários remotos (do Supabase) e atualizar imediatamente
		if(window.supabase && window.navigator.onLine) renderRemoteUsersList();
	} else if(h.startsWith('dept-')){
		const num = h.split('-')[1];
		if(!num || !SALAS[num]){ location.hash = 'departments'; return; }
		// verificar permissão: adm ok, caso contrário somente se role === num (sala) ou role === 'recepcao'?
		if(role && role!=='adm'){
			if(role !== num){ alert('Você não tem permissão para acessar esta sala.'); location.hash='reception'; return; }
		}
		currentDept = num;
		showScreen('screen-department');
		deptTitle.textContent = SALAS[num];
				// primeiro render local rapidamente
				renderQueueForDept(num);
				// tentar popular com dados remotos e re-renderizar
				if(window.supabase && window.navigator.onLine){
					// fetch immediately and then start short polling while on this screen
					fetchRemoteAtendimentos(num).then(()=>{
						renderQueueForDept(num);
					}).catch(e=>{ console.warn('fetchRemoteAtendimentos failed', e); });
					startDeptPolling(num);
				}
				// Nota: atualização remota também será entregue via realtime quando disponível
			// atualizar cartão 'em atendimento' para esta sala
			renderDeptCurrentServing(num);
		enableDeptControlsFor(num);
	} else {
		location.hash = 'reception';
	}
}



window.addEventListener('hashchange', handleHash);
handleHash();

// Inicialização
function ensureQueues(){
	// Garante que todas as salas existem no estado (útil quando migrando)
	for(let i=1;i<=NUM_SALAS;i++) if(!state.queues[i]) state.queues[i]=[];
}

// Inicialização
ensureQueues();
renderPublicPanel();

// garantir que o contador local exista e renderizar valor salvo (evita mostrar 0 ao recarregar)
ensureDailyCounts();
renderDailyCount();

// tenta buscar o contador remoto assim que o Supabase estiver inicializado e estivermos online
function ensureFetchTodayCountOnReady(attempts = 10, delayMs = 500){
	if(window.supabase && window.navigator.onLine){
		try{ fetchRemoteTodayCount(); }catch(e){ /* silent */ }
		return;
	}
	if(attempts <= 0) return;
	setTimeout(()=> ensureFetchTodayCountOnReady(attempts-1, delayMs), delayMs);
}
// chamar na inicialização
ensureFetchTodayCountOnReady();

// --- Realtime sync (Supabase) ---
function setupRealtimeSync(){
	if(!window.supabase) return;
	if(window._filaRealtimeSetup) return; // evitar múltiplas inscrições
	window._filaRealtimeSetup = true;
	console.info('[realtime] inicializando assinatura Supabase');

	const handleAtendimentoRecord = (event, rec)=>{
		try{
			if(!rec) return;
			// mapear sala similar ao fetchRemoteAtendimentos
			const salaKey = rec.dep_direcionado || '';
			let salaNum = null;
			if(/^[0-9]+$/.test(String(salaKey))) salaNum = String(salaKey);
			else {
				for(const k in SALAS){ if(String(SALAS[k]).indexOf(salaKey)!==-1 || SALAS[k].indexOf(salaKey)!==-1) { salaNum = String(k); break; } }
			}

			// helper para procurar e remover por remoteId ou senha
			const removeFromQueuesById = (id)=>{
				if(!id) return false;
				let removed = false;
				state.queues = state.queues || {};
				for(const s in state.queues){
					const arr = state.queues[s] || [];
					const idx = arr.findIndex(x => x.remoteId === id || String(x.ticket) === String(rec.senha));
					if(idx !== -1){ arr.splice(idx,1); removed = true; }
				}
				return removed;
			};

			// INSERT: novo registro criado no banco. Se concluido === null, fica na fila; se concluido === false, é atendimento ativo
			if(event === 'INSERT' || event === 'insert'){
				if(!salaNum) return;
				state.queues = state.queues || {};
				state.queues[salaNum] = state.queues[salaNum] || [];
				// interpretar estado do registro
				if(typeof rec.concluido === 'undefined' || rec.concluido === null){
					const exists = state.queues[salaNum].some(x => x.remoteId === rec.id || x.ticket === (rec.senha || ''));
					if(!exists){
						state.queues[salaNum].push({ name: rec.mucipe_nome || rec.nome || '', document: rec.munic_doc || '', preferencial: false, sala: parseInt(salaNum,10), ticket: rec.senha || '', createdAt: rec.created_at || rec.createdAt, remoteId: rec.id, remoteSynced: true });
						saveState();
						try{ if(currentDept && String(currentDept) === String(salaNum)) renderQueueForDept(salaNum); }catch(_){ }
						renderPublicPanel();
					}
				} else if(rec.concluido === false){
					// registro passou a atendimento ativo: colocar em state.serving
					state.serving = state.serving || {};
					state.serving[salaNum] = { name: rec.mucipe_nome || rec.nome || '', document: rec.munic_doc || '', sala: parseInt(salaNum,10), ticket: rec.senha || '', remoteId: rec.id, remoteSynced: true, inicio_atendimento: rec.inicio_atendimento || null };
					saveState();
					renderPublicPanel();
					if(currentDept && String(currentDept) === String(salaNum)) renderDeptCurrentServing(salaNum);
				} else if(rec.concluido === true){
					// concluído: remover de filas e serving
					const removed = removeFromQueuesById(rec.id);
					if(state.serving && state.serving[salaNum] && state.serving[salaNum].remoteId === rec.id) state.serving[salaNum] = null;
					saveState();
					renderPublicPanel();
					if(currentDept) renderQueueForDept(currentDept);
				}
				return;
			}

			// UPDATE: tratar atualização de estado (concluido campo) ou outras alterações
			if(event === 'UPDATE' || event === 'update'){
				// se rec.concluido === true: registro foi concluído
				if(typeof rec.concluido !== 'undefined' && rec.concluido === true){
					const removed = removeFromQueuesById(rec.id);
					// se alguém está sendo atendido com este remoteId, mover para history e limpar
					try{
						for(const s in state.serving){
							const sv = state.serving[s];
							if(sv && (sv.remoteId === rec.id || sv.ticket === (rec.senha || ''))){
								state.history = state.history || [];
								state.history.push({ name: sv.name, document: sv.document || sv.documento, sala: parseInt(s,10), departamento: SALAS[s], ticket: sv.ticket, datetime: sv.calledAt ? formatLocalTimestamp(sv.calledAt) : formatLocalTimestamp(), endedAt: formatLocalTimestamp() });
								state.serving[s] = null;
							}
						}
					}catch(_){ }
					saveState();
					renderPublicPanel();
					if(currentDept) renderQueueForDept(currentDept);
					return;
				}
				// se rec.concluido === false: registro foi marcado como em atendimento
				if(typeof rec.concluido !== 'undefined' && rec.concluido === false){
					// remover da fila local (se presente) e colocar em serving
					removeFromQueuesById(rec.id);
					state.serving = state.serving || {};
					state.serving[salaNum] = { name: rec.mucipe_nome || rec.nome || '', document: rec.munic_doc || '', sala: parseInt(salaNum,10), ticket: rec.senha || '', remoteId: rec.id, remoteSynced: true, inicio_atendimento: rec.inicio_atendimento || null };
					saveState();
					renderPublicPanel();
					if(currentDept && String(currentDept) === String(salaNum)) renderDeptCurrentServing(salaNum);
					return;
				}
				// rec.concluido é null/undefined ou outras alterações: atualizar dados na fila/serving
				try{
					state.queues = state.queues || {};
					let changed = false;
					for(const s in state.queues){
						const arr = state.queues[s] || [];
						const it = arr.find(x => x.remoteId === rec.id || x.ticket === (rec.senha || ''));
						if(it){
							it.remoteSynced = true; it.remoteId = rec.id; it.name = rec.mucipe_nome || it.name; it.document = rec.munic_doc || it.document;
							changed = true;
						}
					}
					// also update serving if matches
					for(const s in state.serving){
						const sv = state.serving[s];
						if(sv && (sv.remoteId === rec.id || sv.ticket === (rec.senha || ''))){
							sv.remoteSynced = true; sv.remoteId = rec.id; sv.name = rec.mucipe_nome || sv.name; sv.document = rec.munic_doc || sv.document; sv.inicio_atendimento = rec.inicio_atendimento || sv.inicio_atendimento;
							changed = true;
						}
					}
					if(changed){ saveState(); if(currentDept) renderQueueForDept(currentDept); renderPublicPanel(); }
				}catch(_){ }
				return;
			}

			// DELETE: remover se existir
			if(event === 'DELETE' || event === 'delete'){
				const removed = removeFromQueuesById(rec.id);
				if(removed){ saveState(); if(currentDept) renderQueueForDept(currentDept); renderPublicPanel(); }
				return;
			}
		}catch(e){ console.warn('[realtime] handleAtendimentoRecord error', e); }
	};

	const handleUserRecord = (event, rec)=>{
		try{
			if(!rec) return;
			// updates to login_usuarios: inserir/atualizar state.users
			state.users = state.users || [];
			const existing = state.users.find(x=>x.email === rec.email);
			const role = dbDeptToRole(rec.departamento);
			if(event === 'INSERT' || event === 'insert'){
				if(!existing) { state.users.push({ email: rec.email, password: '', role: role, remoteId: rec.id, ativo: rec.ativo }); saveState(); }
				else { existing.role = role; existing.remoteId = rec.id; existing.ativo = rec.ativo; saveState(); }
				if(location.hash.replace('#','') === 'users') renderRemoteUsersList();
				return;
			}
			if(event === 'UPDATE' || event === 'update'){
				if(existing){ existing.role = role; existing.ativo = rec.ativo; existing.remoteId = rec.id; saveState(); }
				else { state.users.push({ email: rec.email, password:'', role:role, remoteId: rec.id, ativo: rec.ativo }); saveState(); }
				if(location.hash.replace('#','') === 'users') renderRemoteUsersList();
				return;
			}
			if(event === 'DELETE' || event === 'delete'){
				const idx = state.users.findIndex(x=>x.email === rec.email || x.remoteId === rec.id);
				if(idx !== -1){ state.users.splice(idx,1); saveState(); if(location.hash.replace('#','') === 'users') renderRemoteUsersList(); }
				return;
			}
		}catch(e){ console.warn('[realtime] handleUserRecord error', e); }
	};

	// Suportar supabase-js v2 (channel) e v1 (from().on)
	try{
		if(typeof window.supabase.channel === 'function'){
			// v2
			const chAt = window.supabase.channel('realtime:atendimentos');
			chAt.on('postgres_changes', { event: '*', schema: 'public', table: 'atendimentos' }, (payload)=>{
				const ev = payload.eventType || payload.type || (payload?.event); // eventType for v2
				const rec = payload.new || payload.record || payload?.payload || payload.data || payload;
				handleAtendimentoRecord((ev || '').toUpperCase(), rec);
			});
			chAt.subscribe();

			const chUsr = window.supabase.channel('realtime:login_usuarios');
			chUsr.on('postgres_changes', { event: '*', schema: 'public', table: 'login_usuarios' }, (payload)=>{
				const ev = payload.eventType || payload.type || (payload?.event);
				const rec = payload.new || payload.record || payload?.payload || payload.data || payload;
				handleUserRecord((ev || '').toUpperCase(), rec);
			});
			chUsr.subscribe();
		} else if(window.supabase && typeof window.supabase.from === 'function' && window.supabase.from('atendimentos').on){
			// v1
			try{
				window.supabase.from('atendimentos').on('*', payload=>{
					const ev = (payload.event || payload.type || '').toUpperCase();
					const rec = payload.new || payload.record || payload;
					handleAtendimentoRecord(ev, rec);
				}).subscribe();
			}catch(e){ console.warn('[realtime] v1 atendimentos subscribe failed', e); }
			try{
				window.supabase.from('login_usuarios').on('*', payload=>{
					const ev = (payload.event || payload.type || '').toUpperCase();
					const rec = payload.new || payload.record || payload;
					handleUserRecord(ev, rec);
				}).subscribe();
			}catch(e){ console.warn('[realtime] v1 login_usuarios subscribe failed', e); }
		} else {
			console.info('[realtime] cliente supabase não expõe métodos de realtime conhecidos; será usado polling como fallback');
			// fallback: polling periódico para manter sincronização
			setInterval(async ()=>{
				try{ if(window.supabase && window.navigator.onLine){ await fetchRemoteAtendimentos(); fetchRemoteUsers(); } }catch(e){ /* silent */ }
			}, 5000); // a cada 5s
		}
	}catch(e){ console.warn('[realtime] setup failed', e); }
}

// iniciar realtime assim que supabase estiver pronto
function ensureRealtimeOnReady(attempts = 10, delayMs = 1000){
	if(window.supabase && window.navigator.onLine){ try{ setupRealtimeSync(); }catch(e){ console.warn('[realtime] ensure start failed', e); } return; }
	if(attempts <= 0) return;
	setTimeout(()=> ensureRealtimeOnReady(attempts-1, delayMs), delayMs);
}
ensureRealtimeOnReady();

// --- Department short-polling helpers ---
// Quando o usuário está em um painel de departamento, fazemos polling curto para reduzir janela de estalecimento
window._deptPollers = window._deptPollers || {};
function startDeptPolling(dept, intervalMs = 2000){
	try{
		stopDeptPolling();
	}catch(_){ }
	if(!dept) return;
	let id = 'dept-' + String(dept);
	if(window._deptPollers[id]) return; // já ativo
	const iv = setInterval(async ()=>{
		try{ 
			if(window.supabase && window.navigator.onLine){ 
				await fetchRemoteAtendimentos(dept);
				await fetchRemoteServing(dept);
				renderQueueForDept(dept);
				renderDeptCurrentServing(dept);
			}
		}catch(e){ /* silent */ }
	}, intervalMs);
	window._deptPollers[id] = iv;
}

function stopDeptPolling(){
	try{
		for(const k in (window._deptPollers||{})){
			try{ clearInterval(window._deptPollers[k]); }catch(_){ }
			delete window._deptPollers[k];
		}
	}catch(_){ }
}

// --- Usuários & Auth ---
function ensureAdminExists(){
	// se não há nenhum usuário, criar um admin padrão (email: admin@local, senha: admin)
	state.users = state.users || [];
	if(state.users.length===0){
		state.users.push({email:'admin@local', password:'admin', role:'adm'});
		saveState();
	}
}

ensureAdminExists();

function renderUsersList(){
	if(!usersList) return;
	usersList.innerHTML = '';
	// aplicar filtros definidos na UI
	const qEl = document.getElementById('userSearch');
	const deptEl = document.getElementById('userFilterDept');
	const sortEl = document.getElementById('userSort');
	const usersCountEl = document.getElementById('usersCount');
	const q = qEl ? (qEl.value || '').trim().toLowerCase() : '';
	const dept = deptEl ? (deptEl.value || '') : '';
	const sort = sortEl ? (sortEl.value || 'asc') : 'asc';

	let list = (state.users||[]).slice();
	// pesquisa por email (ou nome se os objetos tiverem name)
	if(q){
		list = list.filter(u=>{
			const email = (u.email||'').toLowerCase();
			const name = (u.name||u.nome||'').toLowerCase();
			return email.includes(q) || name.includes(q);
		});
	}
	// filtro por departamento / role
	if(dept){
		list = list.filter(u=>{
			return (u.role || '') === dept;
		});
	}
	// ordenação por email (case-insensitive, pt-BR)
	list.sort((a,b)=>{
		const ka = (a.email||'').normalize('NFD').replace(/\p{Diacritic}/gu,'');
		const kb = (b.email||'').normalize('NFD').replace(/\p{Diacritic}/gu,'');
		return sort === 'asc' ? ka.localeCompare(kb, 'pt-BR', { sensitivity: 'base' }) : kb.localeCompare(ka, 'pt-BR', { sensitivity: 'base' });
	});

	// atualizar contagem
	if(usersCountEl) usersCountEl.textContent = `${list.length} usuário(s)`;

	list.forEach(u=>{
		const div = document.createElement('div');
		div.className = 'queue-item';
		const info = document.createElement('div');
		// Mostrar o nome do departamento usando roleToDbDept (converte '1'->'Junta Militar', etc.)
		const deptLabel = roleToDbDept(u.role) || '';
		let roleLabel = deptLabel === 'Administrador' ? 'Administrador' : (deptLabel === 'Recepção' ? 'Recepção' : deptLabel);
		info.innerHTML = `<strong>${escapeHtml(u.email)}</strong><div style="font-size:0.85rem;">${escapeHtml(roleLabel)}</div>`;
		div.appendChild(info);
		// se o usuário atual for admin, adicionar botões de editar/excluir
		if(state.currentUser && state.currentUser.role === 'adm'){
			const actions = document.createElement('div');
			actions.style.display = 'flex';
			actions.style.gap = '8px';
			const editBtn = document.createElement('button');
			editBtn.textContent = 'Editar';
			editBtn.className = 'secondary';
			editBtn.addEventListener('click', ()=> startEditUser(u.email));
			const toggleBtn = document.createElement('button');
			toggleBtn.textContent = (u.ativo === false) ? 'Ativar' : 'Desativar';
			toggleBtn.className = 'secondary';
			toggleBtn.addEventListener('click', ()=> toggleUserActive(u.email));
			actions.appendChild(editBtn);
			actions.appendChild(toggleBtn);
			div.appendChild(actions);
		}
		usersList.appendChild(div);
	});
}

// Renderizar apenas usuários vindos do Supabase (sem mostrar users locais)
async function renderRemoteUsersList(){
	const usersListEl = document.getElementById('usersList');
	if(!usersListEl) return;
	usersListEl.innerHTML = '';
	// header / refresh
	const header = document.createElement('div');
	header.style.display = 'flex';
	header.style.justifyContent = 'space-between';
	header.style.alignItems = 'center';
	const title = document.createElement('div');
	title.textContent = 'Usuários (remotos)';
	title.style.fontWeight = '600';
	header.appendChild(title);
	// cabeçalho simples (sem botão de refresh manual)
	usersListEl.appendChild(header);

	if(!window.supabase){
		const p = document.createElement('div');
		p.textContent = 'Supabase não configurado — sem dados remotos para exibir.';
		p.style.marginTop = '8px';
		usersListEl.appendChild(p);
		return;
	}
	try{
		const { data, error } = await window.supabase.from('login_usuarios').select('*').order('email', { ascending: true }).limit(1000);
		if(error){ console.warn('renderRemoteUsersList supabase error', error); const p = document.createElement('div'); p.textContent = 'Erro ao buscar usuários remotos. Veja console.'; usersListEl.appendChild(p); return; }
		const rows = Array.isArray(data) ? data : [];
		if(rows.length === 0){ const p = document.createElement('div'); p.textContent = 'Nenhum usuário remoto encontrado.'; p.style.marginTop = '8px'; usersListEl.appendChild(p); return; }
		rows.forEach(u=>{
			const div = document.createElement('div');
			div.className = 'queue-item';
			const info = document.createElement('div');
			const roleLabel = roleToDbDept(u.departamento) || '';
			info.innerHTML = `<strong>${escapeHtml(u.email)}</strong><div style="font-size:0.85rem;">${escapeHtml(roleLabel)} ${u.ativo === false ? '<span style="color:#c02626;margin-left:8px">(desativado)</span>' : ''}</div>`;
			div.appendChild(info);
			usersListEl.appendChild(div);
		});
	}catch(e){ console.warn('renderRemoteUsersList exception', e); const p = document.createElement('div'); p.textContent = 'Erro ao buscar usuários remotos.'; usersListEl.appendChild(p); }
}

let editingUserEmail = null;

function startEditUser(email){
	const u = (state.users||[]).find(x=>x.email===email);
	if(!u) return;
	// abrir modal de escolha do que editar
	openEditChoiceModal(email);
}

// abre o modal de escolha e guarda o email sendo editado
function openEditChoiceModal(email){
	const modal = document.getElementById('editUserModal');
	if(!modal) return;
	modal.classList.remove('hidden');
	modal.setAttribute('aria-hidden','false');
	// limpar seleção anterior
	const radios = modal.querySelectorAll('input[name="editChoice"]');
	radios.forEach(r=> r.checked = false);
	// armazenar email no atributo para referência
	modal.dataset.editingEmail = email;
}

function closeEditChoiceModal(){
	const modal = document.getElementById('editUserModal');
	if(!modal) return;
	modal.classList.add('hidden');
	modal.setAttribute('aria-hidden','true');
	delete modal.dataset.editingEmail;
}

// confirmar escolha do modal e abrir o formulário em modo parcial
function confirmEditChoice(){
	const modal = document.getElementById('editUserModal');
	if(!modal) return;
	const choice = modal.querySelector('input[name="editChoice"]:checked');
	const email = modal.dataset.editingEmail;
	if(!choice || !email){ closeEditChoiceModal(); return; }
	const which = choice.value;
	closeEditChoiceModal();
	// abrir tela de users e preparar formulário
	const u = (state.users||[]).find(x=>x.email===email);
	if(!u) return;
	userEmail.value = u.email;
	userPassword.value = '';
	userPasswordConfirm.value = '';
	userDept.value = u.role === 'adm' ? 'adm' : u.role;
	editingUserEmail = u.email;
	showScreen('screen-users');
	// ajustar formulário para mostrar apenas o campo selecionado
	setTimeout(()=>{
		const submitBtn = userForm.querySelector('button[type=submit]');
		if(submitBtn) submitBtn.textContent = 'Atualizar usuário';
		// esconder campos não escolhidos para focar somente no que será editado
		const labels = userForm.querySelectorAll('label');
		// map inputs
		const emailLabel = labels[0];
		const pwdLabel = labels[1];
		const pwd2Label = labels[2];
		const deptLabel = labels[3];
		// reset visibility and enable all by default
		[emailLabel,pwdLabel,pwd2Label,deptLabel].forEach(el=>{ if(el){ el.style.display='block'; const inp = el.querySelector('input,select'); if(inp){ inp.disabled = false; } } });
		// adjust per choice: hide & disable non-selected, set required appropriately
		if(which === 'email'){
			if(pwdLabel) { pwdLabel.style.display='none'; pwdLabel.querySelector('input').disabled = true; }
			if(pwd2Label) { pwd2Label.style.display='none'; pwd2Label.querySelector('input').disabled = true; }
			if(deptLabel) { deptLabel.style.display='none'; deptLabel.querySelector('select').disabled = true; }
			// required only on the visible input
			userEmail.required = true; userPassword.required = false; userPasswordConfirm.required = false; userDept.required = false;
			userEmail.disabled = false; userEmail.focus();
		} else if(which === 'password'){
			if(emailLabel) { emailLabel.style.display='none'; emailLabel.querySelector('input').disabled = true; }
			if(deptLabel) { deptLabel.style.display='none'; deptLabel.querySelector('select').disabled = true; }
			userEmail.required = false; userPassword.required = true; userPasswordConfirm.required = true; userDept.required = false;
			userPassword.disabled = false; userPasswordConfirm.disabled = false; userPassword.focus();
		} else if(which === 'department'){
			if(emailLabel) { emailLabel.style.display='none'; emailLabel.querySelector('input').disabled = true; }
			if(pwdLabel) { pwdLabel.style.display='none'; pwdLabel.querySelector('input').disabled = true; }
			if(pwd2Label) { pwd2Label.style.display='none'; pwd2Label.querySelector('input').disabled = true; }
			userEmail.required = false; userPassword.required = false; userPasswordConfirm.required = false; userDept.required = false;
			userDept.disabled = false; userDept.focus();
		}
	},120);
}

// ligar handlers do modal (cancel/confirm)
document.addEventListener('click', (ev)=>{
	const modal = document.getElementById('editUserModal');
	if(!modal) return;
	if(ev.target && ev.target.id === 'editChoiceCancel'){
		closeEditChoiceModal();
	}
	if(ev.target && ev.target.id === 'editChoiceConfirm'){
		confirmEditChoice();
	}
	// fechar ao clicar fora do conteúdo
	if(ev.target && ev.target.classList && ev.target.classList.contains('modal')){
		closeEditChoiceModal();
	}
});

async function toggleUserActive(email){
	// alterna o campo 'ativo' localmente e tenta sincronizar
	state.users = state.users || [];
	const idx = state.users.findIndex(u=>u.email === email);
	if(idx === -1) return alert('Usuário não encontrado.');
	const user = state.users[idx];
	const newActive = !(typeof user.ativo === 'undefined' ? true : user.ativo);
	// proteção: não permitir desativar último admin
	if(user.role === 'adm' && !newActive){
		const adminCount = state.users.filter(u=>u.role==='adm' && (u.ativo===undefined || u.ativo===true)).length;
		if(adminCount <= 1){ alert('Não é possível desativar o último administrador ativo.'); return; }
	}
	user.ativo = newActive;
	saveState();
	renderUsersList();
	// tentar atualizar remoto
	const changes = { ativo: newActive };
	try{
		if(window.supabase && window.navigator.onLine){
			const res = await updateUserRemote(email, changes);
			if(!res || !res.success){
				enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes } });
			}
		} else {
			enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes } });
		}
	}catch(e){
		console.warn('toggleUserActive remote failed, enqueueing', e);
		enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes } });
	}
}

function showLogin(){
	showScreen('screen-login');
}

function logout(){
	state.currentUser = null;
	saveState();
	btnLogout.classList.add('hidden');
	btnLogin.classList.remove('hidden');
	navUsers.classList.add('hidden');
	// atualizar UI auth
	updateAuthUI();
	// voltar para recepção
	location.hash = 'reception';
	handleHash();
}

// autenticação usando Supabase -> tabela login_usuarios (email + senha)
async function authenticate(email, password){
	// prioriza Supabase quando disponível
	if(window.supabase && window.navigator.onLine){
		try{
			const { data, error } = await window.supabase.from('login_usuarios').select('*').eq('email', email).limit(1).maybeSingle();
			if(error){ console.warn('authenticate supabase select error', error); }
			if(data && data.email){
				// comparar senha em texto (campo senha_hash contém senha em claro neste protótipo)
				if(String(data.senha_hash || '') === String(password || '')){
					// bloquear usuários desativados
					if(data.ativo === false) return { success:false, error: 'inactive' };
					// mapear departamento -> role
					const role = dbDeptToRole(data.departamento);
					// tentar registrar ultimo_login (não-bloqueante)
					try{ recordLastLogin(data.email).catch(err=>console.warn('recordLastLogin async failed', err)); }catch(_){ }
					return { success: true, user: { email: data.email, role: role, ativo: data.ativo } };
				} else {
					return { success: false, error: 'invalid_credentials' };
				}
			}
			return { success:false, error: 'not_found' };
		}catch(e){ console.warn('authenticate supabase exception', e); return { success:false, error: e }; }
	}
	// fallback local
	const u = (state.users||[]).find(x=>x.email===email && x.password===password);
	if(!u) return { success:false, error: 'invalid_credentials' };
	if(u.ativo === false) return { success:false, error: 'inactive' };
	// registrar ultimo_login localmente/enfileirar (não-bloqueante)
	try{ recordLastLogin(u.email).catch(err=>console.warn('recordLastLogin async failed', err)); }catch(_){ }
	return { success:true, user: { email: u.email, role: u.role, ativo: u.ativo } };
}

// eventos de login/logout e cadastro
if(btnLogin) btnLogin.addEventListener('click', ()=> showLogin());
// cancelLogin button removed from UI
if(btnLogout) btnLogout.addEventListener('click', ()=> logout());

if(loginForm) loginForm.addEventListener('submit', async (e)=>{
	e.preventDefault();
	const email = loginEmail.value.trim();
	const pwd = loginPassword.value;
	const res = await authenticate(email, pwd);
	if(res && res.success && res.user){
		// Para evitar conceder acesso antes da troca de senha, primeiro verificamos se este
		// é o primeiro acesso (ultimo_login NULL) para usuários não-admin e apenas então
		// finalizamos o processo de login.
		try{
			if(window.supabase && window.navigator.onLine && res.user.role !== 'adm'){
				const { data, error } = await window.supabase.from('login_usuarios').select('ultimo_login').eq('email', email).limit(1).maybeSingle();
				if(error){ console.warn('Erro ao checar ultimo_login', error); }
				// se data existe e ultimo_login é null => forçar troca
				if(data && data.ultimo_login === null){
					const newPwd = await showForcePasswordModal();
					if(!newPwd){
						alert('É necessário trocar a senha no primeiro acesso. Login cancelado.');
						return; // abortar login
					}
					// tentar atualizar remoto (ou enfileirar)
					try{
						const updRes = await updateUserRemote(email, { password: newPwd });
						if(!updRes || !updRes.success){
							enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes: { password: newPwd } } });
							alert('Senha atualizada localmente e será sincronizada.');
						} else {
							alert('Senha atualizada com sucesso.');
						}
					}catch(upErr){
						console.warn('Falha ao atualizar senha remotamente', upErr);
						enqueueSync({ type: 'updateUser', payload: { originalEmail: email, changes: { password: newPwd } } });
						alert('Senha atualizada localmente e será sincronizada.');
					}
					// atualizar cache local
					state.users = state.users || [];
					const uu = state.users.find(x=>x.email === email);
					if(uu){ uu.password = newPwd; saveState(); }
				}
			}
		}catch(checkErr){ console.warn('Erro verificação primeiro acesso', checkErr); }
		// Finalmente, antes de marcar o usuário como logado, registrar ultimo_login remoto (ou enfileirar)
		try{
			await recordLastLogin(res.user.email);
		}catch(e){ console.warn('recordLastLogin failed', e); }
		state.currentUser = { email: res.user.email, role: res.user.role };
		saveState();
		btnLogout.classList.remove('hidden');
		btnLogin.classList.add('hidden');
		if(state.currentUser.role==='adm') navUsers.classList.remove('hidden'); else navUsers.classList.add('hidden');
		updateAuthUI();
		alert('Login efetuado'); location.hash='reception'; handleHash();
	} else {
		if(res && res.error === 'inactive'){
			alert('Usuário desativado. Contate o administrador.');
			return;
		}
		alert('Credenciais inválidas');
	}
});

// Modal para forçar troca de senha no primeiro acesso
function showForcePasswordModal(){
    return new Promise((resolve)=>{
		try{
			// criar overlay/modal com maior z-index e atributos ARIA
			const modal = document.createElement('div');
			modal.className = 'modal force-pwd-modal';
			modal.setAttribute('role','dialog');
			modal.setAttribute('aria-modal','true');
			modal.style.position = 'fixed';
			modal.style.left = '0'; modal.style.top = '0'; modal.style.right = '0'; modal.style.bottom = '0';
			modal.style.background = 'rgba(0,0,0,0.65)';
			modal.style.display = 'flex'; modal.style.alignItems = 'center'; modal.style.justifyContent = 'center';
			modal.style.zIndex = 2147483647; // máximo razoável
			modal.style.padding = '20px';
			// container
			const box = document.createElement('div');
			box.style.background = '#fff';
			box.style.padding = '20px';
			box.style.borderRadius = '8px';
			box.style.maxWidth = '480px';
			box.style.width = '100%';
			box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
			box.innerHTML = `
				<h3 style="margin-top:0">Primeiro acesso — troque sua senha</h3>
				<p>Por segurança, insira uma nova senha para sua conta.</p>
				<label style="display:block;margin-top:8px">Nova senha<br/><input type="password" id="forceNewPwd" style="width:100%;padding:8px" autocomplete="new-password" /></label>
				<label style="display:block;margin-top:8px">Confirme senha<br/><input type="password" id="forceNewPwd2" style="width:100%;padding:8px" autocomplete="new-password" /></label>
				<div style="margin-top:12px;text-align:right">
					<button id="forcePwdCancel" style="margin-right:8px">Cancelar</button>
					<button id="forcePwdConfirm">Confirmar</button>
				</div>
			`;
			modal.appendChild(box);
			// bloquear scroll da página enquanto modal aberto
			const prevOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			document.body.appendChild(modal);
			const inp1 = modal.querySelector('#forceNewPwd');
			const inp2 = modal.querySelector('#forceNewPwd2');
			const btnC = modal.querySelector('#forcePwdCancel');
			const btnOk = modal.querySelector('#forcePwdConfirm');
			const cleanup = ()=>{ try{ modal.remove(); }catch(_){ } document.body.style.overflow = prevOverflow; };
			btnC.addEventListener('click', ()=>{ cleanup(); resolve(null); });
			btnOk.addEventListener('click', ()=>{
				const v1 = inp1.value || '';
				const v2 = inp2.value || '';
				if(!v1){ alert('Senha não pode ser vazia'); return; }
				if(v1 !== v2){ alert('Senhas não conferem'); return; }
				cleanup(); resolve(v1);
			});
			// foco no primeiro input
			setTimeout(()=> inp1.focus(), 60);
			// fallback: se o modal não for visível (tamanhos muito pequenos), usar prompt sequencial
			setTimeout(()=>{
				const rect = inp1.getBoundingClientRect();
				if(rect.width < 20){ // sinal de problema de render
					// remover modal e usar prompt
					cleanup();
					try{
						const p1 = window.prompt('Primeiro acesso: nova senha');
						if(!p1) return resolve(null);
						const p2 = window.prompt('Confirme a nova senha');
						if(p1 !== p2){ alert('Senhas não conferem'); return resolve(null); }
						return resolve(p1);
					}catch(e){ return resolve(null); }
				}
			}, 300);
		}catch(err){
			// fallback simples: prompts
			try{
				const p1 = window.prompt('Primeiro acesso: nova senha');
				if(!p1) return resolve(null);
				const p2 = window.prompt('Confirme a nova senha');
				if(p1 !== p2){ alert('Senhas não conferem'); return resolve(null); }
				return resolve(p1);
			}catch(e){ return resolve(null); }
		}
    });
}

if(userForm) userForm.addEventListener('submit', async (e)=>{
	e.preventDefault();
	// apenas admin pode cadastrar (verificação extra)
	if(!state.currentUser || state.currentUser.role !== 'adm'){ alert('Apenas administradores podem cadastrar usuários.'); return; }
	const email = userEmail.value.trim();
	const pwd = userPassword.value;
	const pwd2 = userPasswordConfirm.value;
	const dept = userDept.value;
	if(pwd !== pwd2){ alert('Senhas não conferem.'); return; }
	state.users = state.users || [];
	const role = dept === 'adm' ? 'adm' : dept; // role 'adm' ou número da sala
	if(editingUserEmail){
		// edição
		const uIndex = state.users.findIndex(u=>u.email === editingUserEmail);
		if(uIndex === -1){ alert('Usuário não encontrado.'); return; }
		// evitar alterar para email que já existe em outro usuário
		if(email !== editingUserEmail && state.users.some(u=>u.email === email)){ alert('Outro usuário já usa esse email.'); return; }
		// não permitir remover último admin
		const wasAdmin = state.users[uIndex].role === 'adm';
		const willBeAdmin = role === 'adm';
		if(wasAdmin && !willBeAdmin){
			const adminCount = state.users.filter(u=>u.role==='adm').length;
			if(adminCount <= 1){ alert('Não é possível remover o último administrador.'); return; }
		}
		// Atualizar apenas campos habilitados/visíveis
		const emailVisible = !userEmail.disabled && userEmail.offsetParent !== null;
		const pwdVisible = !userPassword.disabled && userPassword.offsetParent !== null;
		const deptVisible = !userDept.disabled && userDept.offsetParent !== null;
		if(emailVisible) state.users[uIndex].email = email;
		if(pwdVisible && pwd) state.users[uIndex].password = pwd;
		if(deptVisible) state.users[uIndex].role = role;
		saveState();
		// tentar enviar atualização parcial ao Supabase
		try{
			// montar objeto de mudanças apenas com campos visíveis
			const changes = {};
			if(emailVisible) changes.email = email;
			if(pwdVisible && pwd) changes.password = pwd;
			if(deptVisible) changes.role = role;
			if(window.supabase && window.navigator.onLine){
				const res = await updateUserRemote(editingUserEmail, changes);
				if(!res || !res.success){
					// enfileirar updateUser para tentar novamente
					enqueueSync({ type: 'updateUser', payload: { originalEmail: editingUserEmail, changes } });
				}
			} else {
				enqueueSync({ type: 'updateUser', payload: { originalEmail: editingUserEmail, changes } });
			}
		}catch(e){ console.warn('updateUserRemote failed, enqueueing', e); enqueueSync({ type: 'updateUser', payload: { originalEmail: editingUserEmail, changes: { email: emailVisible ? email : undefined, password: pwdVisible ? pwd : undefined, role: deptVisible ? role : undefined } } }); }
	// resetar modo edição e UI
	editingUserEmail = null;
	resetUserFormMode();
	renderUsersList();
	alert('Usuário atualizado');
	userForm.reset();
	} else {
		// criação
		if((state.users||[]).some(u=>u.email===email)){ alert('Usuário já cadastrado.'); return; }
	state.users.push({email, password: pwd, role});
		saveState();
		renderUsersList();
		alert('Usuário cadastrado');
		userForm.reset();
		resetUserFormMode();
		// tentar enviar ao Supabase (upsert). Se falhar, enfileirar para sync
		try{
			if(window.supabase && window.navigator.onLine){
				const res = await pushUserToDb({email, password: pwd, role});
				if(!res || !res.success){
					// enfileira
					enqueueSync({ type: 'createUser', payload: { email, password: pwd, role } });
				}
			} else {
				enqueueSync({ type: 'createUser', payload: { email, password: pwd, role } });
			}
		}catch(e){
			console.warn('pushUserToDb failed, enqueueing', e);
			enqueueSync({ type: 'createUser', payload: { email, password: pwd, role } });
		}
	}
});

if(cancelUser) cancelUser.addEventListener('click', ()=>{ 
	// resetar modo edição/ formulário e restaurar campos visíveis/habilitados
	if(userForm) userForm.reset();
	editingUserEmail = null;
	// garantir todos os campos visíveis e habilitados
	const labels = userForm.querySelectorAll('label');
	labels.forEach(l=>{ l.style.display='block'; const inp = l.querySelector('input,select'); if(inp){ inp.disabled = false; inp.required = true; } });
	// por padrão, senha confirm é required quando criamos novo
	if(userPassword) userPassword.required = true;
	if(userPasswordConfirm) userPasswordConfirm.required = true;
	resetUserFormMode();
	// permanecer na aba de usuários (não navegar para recepção)
	showScreen('screen-users');
	renderUsersList();
});

// resetar modo edição quando o usuário sair do formulário
function resetUserFormMode(){
	editingUserEmail = null;
	const submitBtn = userForm.querySelector('button[type=submit]');
	if(submitBtn) submitBtn.textContent = 'Salvar usuário';
}

// atualizar UI inicial com base em currentUser
if(state.currentUser){
	if(btnLogout) btnLogout.classList.remove('hidden');
	if(btnLogin) btnLogin.classList.add('hidden');
	if(state.currentUser.role==='adm' && navUsers) navUsers.classList.remove('hidden');
}

// chamada inicial para sincronizar UI
updateAuthUI();
renderUsersList();

// conectar listeners dos controles de filtro de usuários (se existirem)
(function initUserFilters(){
	const qEl = document.getElementById('userSearch');
	const deptEl = document.getElementById('userFilterDept');
	const sortEl = document.getElementById('userSort');
	if(qEl) qEl.addEventListener('input', ()=>{ renderUsersList(); });
	if(deptEl) deptEl.addEventListener('change', ()=>{ renderUsersList(); });
	if(sortEl) sortEl.addEventListener('change', ()=>{ renderUsersList(); });
	// quando a tela de users for mostrada, focar o campo de busca
	const usersNav = document.getElementById('navUsers');
	if(usersNav){
		usersNav.addEventListener('click', ()=>{ setTimeout(()=>{ if(qEl) qEl.focus(); },200); });
	}
})();

// Expor para console (útil para debug)
window._fila = state;

// Helper de debug: permite forçar gravação de ultimo_login pelo console
window.forceSetLastLogin = async function(email){
	if(!email) return console.warn('forceSetLastLogin: passe um email');
	console.info('[forceSetLastLogin] iniciando para', email);
	try{
		const res = await recordLastLogin(email);
		console.info('[forceSetLastLogin] resultado', res);
		return res;
	}catch(e){ console.error('[forceSetLastLogin] exception', e); return { success:false, error:e }; }
};

// Atualiza visibilidade de elementos dependentes de autenticação/role
function updateAuthUI(){
		try{
			const btnClear = document.getElementById('btnClearPanels');
			const navUsersEl = document.getElementById('navUsers');
			const topNav = document.querySelector('.top-nav');
			const authActions = document.querySelector('.auth-actions');
			const isAdmin = state && state.currentUser && state.currentUser.role === 'adm';
			const isRecepcao = state && state.currentUser && state.currentUser.role === 'recepcao';
			const isDeptUser = state && state.currentUser && (/^\d+$/.test(String(state.currentUser.role)));

			// se estivermos na tela de login, ocultar totalmente a navegação e ações do header
			const onLoginScreen = (document.getElementById('screen-login') && !document.getElementById('screen-login').classList.contains('hidden')) || location.hash.replace('#','') === 'login';
			if(onLoginScreen){
				if(topNav) topNav.classList.add('hidden');
				if(authActions) authActions.classList.add('hidden');
				if(btnClear) btnClear.classList.add('hidden');
				if(navUsersEl) navUsersEl.classList.add('hidden');
				return;
			} else {
				if(topNav) topNav.classList.remove('hidden');
				if(authActions) authActions.classList.remove('hidden');
			}
			// nav visibility rules
			if(navUsersEl) navUsersEl.classList.toggle('hidden', !isAdmin);
			// se for recepção, esconder outras entradas de navegação (exceto Recepção link)
			if(isRecepcao){
				try{
					const top = document.querySelector('.top-nav');
					if(top){
						Array.from(top.querySelectorAll('a')).forEach(a=>{
							if(a.id !== 'navReception') a.classList.add('hidden');
						});
					}
				}catch(_){ }
			} else if(isDeptUser){
				// mostrar apenas o link do departamento correspondente
				try{
					const top = document.querySelector('.top-nav');
					if(top){
						Array.from(top.querySelectorAll('a')).forEach(a=>{
							// extrair número se for id navDept-<n> ou href '#dept-<n>' ou similar
							const href = a.getAttribute('href') || '';
							const id = a.id || '';
							let show = false;
							// navReception always hidden for pure dept users
							// allow link matching '#dept-<n>' or id containing 'dept'
							const myDept = String(state.currentUser.role);
							if(href.indexOf('#dept-') !== -1 && href.indexOf('#dept-' + myDept) !== -1) show = true;
							// also allow navDepartments for admin only, so hide it
							if(show) a.classList.remove('hidden'); else a.classList.add('hidden');
						});
					}
				}catch(_){ }
			} else {
				// garantir que links reapareçam para outros perfis
				try{
					const top = document.querySelector('.top-nav');
					if(top){
						Array.from(top.querySelectorAll('a')).forEach(a=> a.classList.remove('hidden'));
					}
				}catch(_){ }
			}
			if(btnClear) btnClear.classList.toggle('hidden', !isAdmin);
			// ajustar botões de login/logout
			const btnLogoutEl = document.getElementById('btnLogout');
			const btnLoginEl = document.getElementById('btnLogin');
			const isLogged = !!(state && state.currentUser);
			if(btnLogoutEl) btnLogoutEl.classList.toggle('hidden', !isLogged);
			if(btnLoginEl) btnLoginEl.classList.toggle('hidden', isLogged);

			// esconder botão 'Voltar' em acessos restritos de departamento
			try{
				const backLinks = document.querySelectorAll('.back-link');
				if(backLinks && backLinks.length){
					// se for usuário restrito a uma sala e estivermos numa tela dept-<n> correspondente
					if(isDeptUser){
						const myDept = String(state.currentUser.role);
						const h = location.hash.replace('#','');
						if(h.startsWith('dept-') && h.split('-')[1] === myDept){
							backLinks.forEach(a=> a.classList.add('hidden'));
						} else {
							backLinks.forEach(a=> a.classList.remove('hidden'));
						}
					} else {
						// para outros perfis, garantir que o botão esteja visível quando apropriado
						backLinks.forEach(a=> a.classList.remove('hidden'));
					}
				}
			}catch(_){ }
		}catch(e){ /* silent */ }
}

// referência ao botão (adicionar perto das outras querySelectors / init)
const btnClearPanels = document.getElementById('btnClearPanels');
if (btnClearPanels) {
    btnClearPanels.addEventListener('click', clearAllPanels);
}

// função para esvaziar todas as filas e encerrar atendimentos abertos (apenas admin)
function clearAllPanels(){
	if(!state || !state.currentUser || state.currentUser.role!=='adm'){
		alert('Apenas administradores podem executar esta ação.');
		return;
	}
	if(!confirm('Confirma limpar todos os painéis e encerrar atendimentos abertos? Essa ação limpará filas e atendimentos em todas as salas.')) return;
	for(let i=1;i<=NUM_SALAS;i++){
		if(state.serving) state.serving[i]=null;
		if(state.queues) state.queues[i]=[];
	}
	saveState();
	renderPublicPanel();
	handleHash();
	alert('Todos os painéis foram limpos.');
}

// Ao atualizar UI/estado após login/logout, garanta mostrar/esconder o botão para admin.
// Ao atualizar UI/estado após login/logout, garanta mostrar/esconder o botão para admin.

