// Relatórios - página separada
const SALAS = {
	1: 'Sala 1 - Junta Militar',
 	2: 'Sala 2 - Procon',
 	3: 'Sala 3 - Ouvidoria',
 	4: 'Sala 4 - Banco do povo/PAV',
 	5: 'Sala 5 - Frente de Trabalho',
	6: 'Sala 6 - PAT',
	60: 'Sala 6 - Seguro Desemprego',
	7: 'Sala 7 - Preenchimento',
	8: 'Sala 8 - SEBRAE'
};

function loadState(){
	const raw = localStorage.getItem('fila_state');
	if(!raw) return {history: []};
	try{ return JSON.parse(raw);}catch(e){return {history: []}}
}

let state = loadState();

const reportsTableBody = document.querySelector('#reportsTable tbody');
const reportDeptFilter = document.getElementById('reportDeptFilter');
const reportFrom = document.getElementById('reportFrom');
const reportTo = document.getElementById('reportTo');
const applyFilterBtn = document.getElementById('applyFilter');
const clearFilterBtn = document.getElementById('clearFilter');
const exportCsvBtn = document.getElementById('exportCsv');
const reportsTotalEl = document.getElementById('reportsTotal');
// sort state
let sortField = 'datetime'; // default sort by date (newest first)
let sortDir = 'desc'; // 'asc' or 'desc'

function refreshState(){ state = loadState(); }

function filterHistory(){
	const hist = state.history || [];
	const dept = reportDeptFilter ? reportDeptFilter.value : 'all';
	const from = reportFrom && reportFrom.value ? new Date(reportFrom.value) : null;
	const to = reportTo && reportTo.value ? new Date(reportTo.value) : null;
	return hist.filter(r=>{
		if(dept && dept!=='all'){
			if(!r.sala || String(r.sala) !== String(dept)) return false;
		}
		if(from){
			const d = new Date(r.datetime);
			if(d < new Date(from.getFullYear(), from.getMonth(), from.getDate())) return false;
		}
		if(to){
			const d = new Date(r.datetime);
			if(d > new Date(to.getFullYear(), to.getMonth(), to.getDate(),23,59,59,999)) return false;
		}
		return true;
	});
}

function renderReportsTable(){
	// will be replaced by async version below
	console.warn('renderReportsTable called synchronously; use renderReportsTableAsync instead');
}

function escapeHtml(str) {
	if (str === null || str === undefined) return '';
	return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Formatação explícita para fuso horário de São Paulo (evita confusão com UTC no banco)
function formatDateTimeInZone(iso, tz = 'America/Sao_Paulo'){
	if(!iso) return '';
	try{
		const d = new Date(iso);
		return d.toLocaleString('pt-BR', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
	}catch(e){
		try{ return new Date(iso).toLocaleString(); }catch(_){ return String(iso); }
	}
}

function formatTimeInZone(iso, tz = 'America/Sao_Paulo'){
	if(!iso) return '';
	try{
		const d = new Date(iso);
		return d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
	}catch(e){
		try{ return new Date(iso).toLocaleTimeString(); }catch(_){ return ''; }
	}
}

// Mostrar o valor exatamente como está no banco (sem conversão de fuso)
function showRawDateTime(val){
	if(!val && val !== 0) return '';
	const s = String(val).trim();
	// tentar extrair padrões YYYY-MM-DD[T ]HH:MM:SS(.ms)?Z?
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
	if(m){
		const Y = m[1], Mo = m[2], D = m[3];
		const hh = m[4] || '00';
		const mm = m[5] || '00';
		return `${D}/${Mo}/${Y} ${hh}:${mm}`.trim();
	}
	// fallback: se for somente data no formato YYYY-MM-DD
	const md = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if(md){ return `${md[3]}/${md[2]}/${md[1]}`; }
	// fallback final: retornar string original
	return s;
}

function showRawTime(val){
	if(!val && val !== 0) return '';
	const s = String(val).trim();
	const m = s.match(/^(?:\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
	if(m && m[1]) return `${m[1]}:${m[2]}`;
	// tentar extrair se houver tempo separado
	const sp = s.match(/(\d{2}):(\d{2})(?::\d{2})?/);
	if(sp) return `${sp[1]}:${sp[2]}`;
	return s;
}

// Retorna linhas para o relatório, preferindo dados remotos quando supabase disponível.
async function getReportRows(){
	// aplicar filtros locais para montar query
	const dept = reportDeptFilter ? reportDeptFilter.value : 'all';
	const from = reportFrom && reportFrom.value ? new Date(reportFrom.value) : null;
	const to = reportTo && reportTo.value ? new Date(reportTo.value) : null;

	// se supabase configurado e online, buscar remotamente
	if(!(window.supabase && window.navigator.onLine)){
		// obrigatoriamente remoto; retornar null para indicar indisponibilidade
		return null;
	}
	if(window.supabase && window.navigator.onLine){
		try{
			// Buscar atendimentos (sem filtro por created_at): iremos filtrar localmente
			let q = window.supabase.from('atendimentos').select('*').order('created_at', { ascending: false }).limit(2000);
			if(dept && dept !== 'all') q = q.eq('dep_direcionado', String(dept));
			const { data, error } = await q;
			if(error){ console.warn('Supabase atendimentos select error', error); throw error; }
			const atRows = data || [];
			// coletar documentos para buscar municipes
			const docs = Array.from(new Set(atRows.map(a=>a.munic_doc).filter(Boolean)));
			let munMap = {};
			if(docs.length>0){
				const { data: munData, error: munErr } = await window.supabase.from('municipes').select('*').in('documento', docs);
				if(munErr){ console.warn('Supabase municipes select error', munErr); }
				if(munData && Array.isArray(munData)){
					munMap = munData.reduce((acc,m)=>{ acc[m.documento]=m; return acc; }, {});
				}
			}
			// mapear linhas
			const rows = atRows.map(a=>{
				const m = (a.munic_doc && munMap[a.munic_doc]) ? munMap[a.munic_doc] : {};
				return {
					name: a.mucipe_nome || '',
					document: a.munic_doc || '',
					endereco: m.endereco || '',
					bairro: m.bairro || '',
					cidade: m.cidade || '',
					telefone: m.telefone || '',
					departamento: SALAS[a.dep_direcionado] || a.dep_direcionado || '',
						datetime: a.created_at || a.inicio_atendimento || null,
						horario_atendimento: a.inicio_atendimento || null,
						ticket: a.senha || ''
				};
			});
			// Filtrar localmente usando exclusivamente created_at (apenas data, sem horário)
			// Aplicar o mesmo comportamento de máscara ao Data Início: usar Start+1 dia como início efetivo da busca
			// Assim, se o usuário informar 09/10 no campo 'Data Início', a busca usará 10/10 como limite inferior
			const start = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1) : null;
			// Ajuste intencional também para o filtro 'Data Fim': usar End+1 dia como limite superior (mascara consistente)
			const end = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null; // date-only adjusted
			const filtered = rows.filter(r=>{
				if(!r.datetime) return false;
				const created = new Date(r.datetime);
				const createdDateOnly = new Date(created.getFullYear(), created.getMonth(), created.getDate());
				if(start && createdDateOnly < start) return false;
				if(end && createdDateOnly > end) return false;
				return true;
			});
			return filtered;
		}catch(e){
			console.warn('Erro ao buscar atendimentos remotos', e);
			return null;
		}
	}
}

// Versão assíncrona para renderizar tabela usando getReportRows

async function renderReportsTableAsync(){
	reportsTableBody.innerHTML = '';
	const rows = await getReportRows();
	if(rows === null){
		reportsTableBody.innerHTML = '<tr><td colspan="9">Dados remotos indisponíveis. Verifique a conexão e a configuração do Supabase. <button id="retryRemote">Tentar novamente</button></td></tr>';
		const btn = document.getElementById('retryRemote');
		if(btn) btn.addEventListener('click', async ()=>{ btn.disabled = true; btn.textContent = 'Tentando...'; await renderReportsTableAsync(); });
		// atualizar contador para 0 quando remoto indisponível
		if(reportsTotalEl) reportsTotalEl.textContent = 'Total de atendimentos: 0';
		return;
	}
	if(!rows || rows.length===0){ 
		reportsTableBody.innerHTML = '<tr><td colspan="10">Nenhum atendimento registrado para os filtros selecionados.</td></tr>';
		if(reportsTotalEl) reportsTotalEl.textContent = 'Total de atendimentos: 0';
		return; 
	}

	// atualizar contador com o número de linhas filtradas
	if(reportsTotalEl) reportsTotalEl.textContent = `Total de atendimentos: ${rows.length}`;

	// aplicar ordenação
	rows.sort((a,b)=>{
		let va, vb;
		if(sortField === 'name'){ va = (a.name||'').toLowerCase(); vb = (b.name||'').toLowerCase(); }
		else { va = a.datetime ? new Date(a.datetime).getTime() : 0; vb = b.datetime ? new Date(b.datetime).getTime() : 0; }
		if(va < vb) return sortDir === 'asc' ? -1 : 1;
		if(va > vb) return sortDir === 'asc' ? 1 : -1;
		return 0;
	});

	rows.forEach(row=>{
		const tr = document.createElement('tr');
		const hora = row.horario_atendimento ? showRawTime(row.horario_atendimento) : '';
		const dt = row.datetime ? showRawDateTime(row.datetime) : '';
		tr.innerHTML = `<td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.document)}</td><td>${escapeHtml(row.endereco)}</td><td>${escapeHtml(row.bairro)}</td><td>${escapeHtml(row.cidade)}</td><td>${escapeHtml(row.telefone)}</td><td>${escapeHtml(row.departamento)}</td><td>${escapeHtml(dt)}</td><td>${escapeHtml(hora)}</td><td>${escapeHtml(row.ticket)}</td>`;
		reportsTableBody.appendChild(tr);
	});
}

function updateSortArrows(){
	const thNameArrow = document.getElementById('thNameArrow');
	const thDateArrow = document.getElementById('thDateArrow');
	if(thNameArrow) thNameArrow.textContent = sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅';
	if(thDateArrow) thDateArrow.textContent = sortField === 'datetime' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅';
}

// bind sortable headers
document.addEventListener('DOMContentLoaded', ()=>{
	const thName = document.getElementById('thName');
	const thDate = document.getElementById('thDate');
	if(thName) thName.addEventListener('click', async ()=>{
		if(sortField === 'name') sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortField = 'name'; sortDir = 'asc'; }
		updateSortArrows();
		await renderReportsTableAsync();
	});
	if(thDate) thDate.addEventListener('click', async ()=>{
		if(sortField === 'datetime') sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortField = 'datetime'; sortDir = 'desc'; }
		updateSortArrows();
		await renderReportsTableAsync();
	});
	updateSortArrows();
});

async function exportCsv(){
	const rows = await getReportRows();
	if(rows === null){ alert('Dados remotos indisponíveis. Exportação cancelada.'); return; }
	if(!rows || rows.length===0){ alert('Nenhum registro para exportar com os filtros selecionados.'); return; }
	const header = ['Nome','Documento','Endereço','Bairro','Cidade','Telefone','Departamento','DataHora','Horário Atendimento','Senha'];
	const csvRows = rows.map(r=>{
		const horario = r.horario_atendimento ? showRawTime(r.horario_atendimento) : '';
		const dt = r.datetime ? showRawDateTime(r.datetime) : '';
		return [r.name, r.document, r.endereco || '', r.bairro || '', r.cidade || '', r.telefone || '', r.departamento, dt, horario, r.ticket||''];
	});
	// Usar ponto-e-vírgula como separador (formato comum no Brasil)
	const csv = [header, ...csvRows].map(r=>r.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(';')).join('\r\n');
	const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `relatorio_atendimentos_${new Date().toLocaleDateString('en-CA')}.csv`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

if(applyFilterBtn) applyFilterBtn.addEventListener('click', async ()=> await renderReportsTableAsync());
if(clearFilterBtn) clearFilterBtn.addEventListener('click', async ()=>{ if(reportDeptFilter) reportDeptFilter.value='all'; if(reportFrom) reportFrom.value=''; if(reportTo) reportTo.value=''; await renderReportsTableAsync(); });
if(exportCsvBtn) exportCsvBtn.addEventListener('click', async ()=> await exportCsv());

// helper: aguarda até que window.supabase esteja disponível ou até timeout
function waitForSupabase(timeoutMs = 5000, intervalMs = 300){
	return new Promise((resolve) => {
		const start = Date.now();
		const iv = setInterval(()=>{
			if(window.supabase && typeof window.supabase.from === 'function'){
				clearInterval(iv); resolve(true); return;
			}
			if(Date.now() - start > timeoutMs){
				clearInterval(iv); resolve(false); return;
			}
		}, intervalMs);
	});
}

// inicializar tabela (async): tenta aguardar Supabase por alguns instantes e em seguida renderiza
(async ()=>{
	const ready = await waitForSupabase(5000, 250);
	// definir data início padrão como hoje, caso o campo esteja vazio
	try{
		if(reportFrom && !reportFrom.value){
			const now = new Date();
			const pad = (n)=> String(n).padStart(2,'0');
			reportFrom.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
		}
	}catch(e){ console.warn('Erro ao setar data padrão de início', e); }
	// se não estiver pronto, ainda assim chamamos para exibir mensagem com botão de retry
	await renderReportsTableAsync();
	if(!ready){
		// se supabase não estava pronto, tentar em background mais algumas vezes para capturar inicialização tardia
		const extraAttempts = 8;
		let attempts = 0;
		const backIv = setInterval(async ()=>{
			attempts++;
			if(window.supabase && typeof window.supabase.from === 'function'){
				clearInterval(backIv);
				await renderReportsTableAsync();
				return;
			}
			if(attempts >= extraAttempts){ clearInterval(backIv); }
		}, 500);
	}
})();
