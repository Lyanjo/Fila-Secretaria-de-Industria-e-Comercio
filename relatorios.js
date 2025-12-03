// Relatórios - página separada

// ========== NAVEGAÇÃO ENTRE SEÇÕES ==========
function initNavigation() {
  const navDashboards = document.getElementById('navDashboards');
  const navBaseGeral = document.getElementById('navBaseGeral');
  const sectionDashboards = document.getElementById('section-dashboards');
  const sectionBaseGeral = document.getElementById('section-base-geral');

  function showSection(section) {
    // Ocultar todas as seções
    sectionDashboards.classList.add('hidden');
    sectionBaseGeral.classList.add('hidden');
    
    // Remover active de todos os links
    navDashboards.classList.remove('active');
    navBaseGeral.classList.remove('active');
    
    // Mostrar seção selecionada
    if (section === 'dashboards') {
      sectionDashboards.classList.remove('hidden');
      navDashboards.classList.add('active');
      // Atualizar dashboards quando entrar (só se o Supabase estiver pronto)
      if (window.supabase && typeof window.supabase.from === 'function') {
        updateDashboards();
      }
    } else if (section === 'base-geral') {
      sectionBaseGeral.classList.remove('hidden');
      navBaseGeral.classList.add('active');
      // Atualizar relatórios quando entrar na base geral
      renderReportsTableAsync();
    }
  }

  navDashboards.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('dashboards');
  });

  navBaseGeral.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('base-geral');
  });

  // Iniciar na seção Dashboards (mas não atualizar ainda)
  sectionDashboards.classList.remove('hidden');
  navDashboards.classList.add('active');
}

// ========== DASHBOARDS ==========
let deptChartInstance = null;
let bairroChartInstance = null;
let hourlyChartInstance = null;
let weekdayChartInstance = null;
let currentCalendarMonth = new Date(); // Mês atual do calendário

// Paleta de cores para os gráficos
const CHART_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#6366f1', '#f97316', '#14b8a6', '#a855f7',
  '#ef4444', '#84cc16', '#eab308', '#22c55e', '#0ea5e9'
];

function getTodayString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getMondayOfCurrentWeek() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = domingo, 1 = segunda, ..., 6 = sábado
  
  // Calcular segunda-feira da semana atual
  const monday = new Date(now);
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Se domingo, voltar 6 dias
  monday.setDate(now.getDate() - daysFromMonday);
  
  const pad = (n) => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function getWeekRange(weeksAgo = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = domingo, 1 = segunda, ..., 6 = sábado
  
  // Calcular o domingo da semana atual (início da semana)
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek - (weeksAgo * 7)); // Voltar para o domingo
  sunday.setHours(0, 0, 0, 0);
  
  // Calcular o sábado da semana (fim da semana)
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6); // Domingo + 6 dias = Sábado
  saturday.setHours(23, 59, 59, 999);
  
  // NÃO aplicar máscara +1 dia - dados já estão no timezone correto
  return { 
    start: sunday, 
    end: saturday,
    startOriginal: sunday,
    endOriginal: saturday
  };
}

function getMonthRange(monthsAgo = 0) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() - monthsAgo;
  
  // Primeiro dia do mês
  const firstDay = new Date(year, month, 1);
  firstDay.setHours(0, 0, 0, 0);
  
  // Último dia do mês
  const lastDay = new Date(year, month + 1, 0);
  lastDay.setHours(23, 59, 59, 999);
  
  // NÃO aplicar máscara +1 dia - dados já estão no timezone correto
  return {
    start: firstDay,
    end: lastDay,
    startOriginal: firstDay,
    endOriginal: lastDay
  };
}

function getLast30Days() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  
  // NÃO aplicar máscara +1 dia - dados já estão no timezone correto
  return {
    start: start,
    end: end
  };
}

async function fetchAtendimentosFromSupabase(startDate, endDate) {
  if (!window.supabase || typeof window.supabase.from !== 'function') {
    console.warn('Supabase não disponível para dashboards');
    return [];
  }
  
  try {
    // Buscar atendimentos com paginação para garantir todos os registros
    // O Supabase tem limite padrão de 1000 por página, vamos buscar em múltiplas páginas
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore && allData.length < 10000) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      let query = window.supabase
        .from('atendimentos')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      
      const { data, error, count } = await query;
      
      if (error) {
        console.error('Erro ao buscar atendimentos (página ' + page + '):', error);
        break;
      }
      
      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }
      
      allData = allData.concat(data);
      // Log removido para reduzir poluição do console
      
      // Se retornou menos que pageSize, não há mais páginas
      if (data.length < pageSize) {
        hasMore = false;
      }
      
      page++;
    }
    
    console.log(`✅ Total de registros buscados: ${allData.length}`);
    
    if (allData.length === 0) {
      return [];
    }
    
    // Função para normalizar documento (remover pontos, traços e espaços)
    const normalizeDoc = (doc) => {
      if (!doc) return '';
      return String(doc).replace(/[.\-\s]/g, '').trim();
    };
    
    // Buscar TODOS os munícipes com PAGINAÇÃO para garantir compatibilidade
    console.log(`📋 Dashboards - Buscando munícipes...`);
    let munMap = {};
    
    try {
      let allMunicipes = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;
      
      while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        
        const { data: munData, error: munErr } = await window.supabase
          .from('municipes')
          .select('*')
          .range(from, to);
        
        if (munErr) {
          console.warn('Erro ao buscar munícipes (página ' + page + '):', munErr);
          break;
        }
        
        if (!munData || munData.length === 0) {
          hasMore = false;
          break;
        }
        
        allMunicipes = allMunicipes.concat(munData);
        
        if (munData.length < pageSize) {
          hasMore = false;
        }
        
        page++;
      }
      
      console.log(`✅ Dashboards - ${allMunicipes.length} munícipes carregados`);
      
      // Criar map com documento NORMALIZADO como chave
      munMap = allMunicipes.reduce((acc, m) => { 
        const normalizedDoc = normalizeDoc(m.documento);
        acc[normalizedDoc] = m; 
        return acc; 
      }, {});
      
    } catch(e) {
      console.error('Dashboards - Erro ao buscar munícipes:', e);
    }
    
    // Mapear atendimentos com dados dos munícipes usando documento NORMALIZADO
    const atendimentos = allData.map(a => {
      const docNormalizado = normalizeDoc(a.munic_doc);
      const m = (docNormalizado && munMap[docNormalizado]) ? munMap[docNormalizado] : {};
      
      const atendimento = {
        sala: a.dep_direcionado,
        departamento: a.dep_direcionado,
        bairro: m.bairro || '',
        endereco: m.endereco || '',
        cidade: m.cidade || '',
        telefone: m.telefone || '',
        datetime: a.created_at || a.inicio_atendimento || null,
        horario_atendimento: a.inicio_atendimento || null,
        nome: a.mucipe_nome || '',
        documento: a.munic_doc || ''
      };
      
      return atendimento;
    });
    
    // Filtrar localmente por data (usando created_at e MESMA MÁSCARA da Base Geral)
    // Aplicar máscara: usuário escolhe dia X, mas buscamos dia X+1
    // Assim, se escolher 27/11, buscaremos 28/11
    if (!startDate && !endDate) {
      return atendimentos;
    }
    
    // NÃO aplicar máscara +1 dia - dados já estão no timezone correto
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    
    console.log('Filtro de data aplicado:', {
      startDate: startDate,
      endDate: endDate
    });
    
    const filtered = atendimentos.filter(r => {
      if (!r.datetime) return false;
      const created = new Date(r.datetime);
      const createdDateOnly = new Date(created.getFullYear(), created.getMonth(), created.getDate());
      
      if (start && createdDateOnly < start) return false;
      if (end && createdDateOnly > end) return false;
      
      return true;
    });
    
    return filtered;
  } catch (e) {
    console.error('Erro ao consultar Supabase:', e);
    return [];
  }
}

// Dashboard 1: Pizza de Departamentos
async function updateDeptChart() {
  const fromInput = document.getElementById('deptChartFrom');
  const toInput = document.getElementById('deptChartTo');
  const totalEl = document.getElementById('deptChartTotal');
  
  // console.log removido
  
  const data = await fetchAtendimentosFromSupabase(fromInput.value, toInput.value);
  
  // console.log removido
  
  // Agrupar por departamento
  const deptCounts = {};
  data.forEach(item => {
    const sala = item.sala || item.departamento;
    const deptName = SALAS[sala] || `Sala ${sala}`;
    deptCounts[deptName] = (deptCounts[deptName] || 0) + 1;
  });
  
  // console.log removido
  
  // Ordenar por quantidade (decrescente) - igual pizza de bairros
  const sorted = Object.entries(deptCounts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([name]) => name);
  const values = sorted.map(([, count]) => count);
  const total = values.reduce((sum, v) => sum + v, 0);
  
  totalEl.textContent = `Total: ${total} atendimento${total !== 1 ? 's' : ''}`;
  
  const canvas = document.getElementById('deptChart');
  const ctx = canvas.getContext('2d');
  
  if (deptChartInstance) {
    deptChartInstance.destroy();
  }
  
  // Se não houver dados, mostrar mensagem
  if (total === 0) {
    deptChartInstance = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Sem dados'],
        datasets: [{
          data: [1],
          backgroundColor: ['#e5e7eb'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
    return;
  }
  
  deptChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: { size: 11 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${label}: ${value} (${percent}%)`;
            }
          }
        }
      }
    }
  });
}

// Dashboard 2: Pizza de Bairros
async function updateBairroChart() {
  const fromInput = document.getElementById('bairroChartFrom');
  const toInput = document.getElementById('bairroChartTo');
  const totalEl = document.getElementById('bairroChartTotal');
  const listEl = document.getElementById('bairroList');
  
  // console.log removido
  
  const data = await fetchAtendimentosFromSupabase(fromInput.value, toInput.value);
  
  // console.log removido
  
  // Agrupar por bairro
  const bairroCounts = {};
  data.forEach(item => {
    const bairro = (item.bairro || 'Não informado').trim() || 'Não informado';
    bairroCounts[bairro] = (bairroCounts[bairro] || 0) + 1;
  });
  
  // console.log removido
  
  // Ordenar por quantidade (decrescente)
  const sorted = Object.entries(bairroCounts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([name]) => name);
  const values = sorted.map(([, count]) => count);
  const total = values.reduce((sum, v) => sum + v, 0);
  
  totalEl.textContent = `Total: ${total} atendimento${total !== 1 ? 's' : ''}`;
  
  // Atualizar lista lateral
  if (total === 0) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">Sem dados</div>';
  } else {
    listEl.innerHTML = sorted.map(([name, count]) => `
      <div class="bairro-list-item">
        <span class="bairro-name">${name}</span>
        <span class="bairro-count">${count}</span>
      </div>
    `).join('');
  }
  
  const canvas = document.getElementById('bairroChart');
  const ctx = canvas.getContext('2d');
  
  if (bairroChartInstance) {
    bairroChartInstance.destroy();
  }
  
  // Se não houver dados, mostrar mensagem
  if (total === 0) {
    bairroChartInstance = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Sem dados'],
        datasets: [{
          data: [1],
          backgroundColor: ['#e5e7eb'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
    return;
  }
  
  bairroChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false // Usar lista lateral ao invés de legenda
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${label}: ${value} (${percent}%)`;
            }
          }
        }
      }
    }
  });
}

// Dashboard 3: Comparativo Semanal
async function updateWeeklyComparison() {
  const thisWeek = getWeekRange(0);
  const lastWeek = getWeekRange(1);
  
  console.log('Atualizando comparativo semanal...', { 
    thisWeek: { 
      original: `${thisWeek.startOriginal.toISOString().split('T')[0]} a ${thisWeek.endOriginal.toISOString().split('T')[0]}`,
      adjusted: `${thisWeek.start.toISOString().split('T')[0]} a ${thisWeek.end.toISOString().split('T')[0]}`
    },
    lastWeek: { 
      original: `${lastWeek.startOriginal.toISOString().split('T')[0]} a ${lastWeek.endOriginal.toISOString().split('T')[0]}`,
      adjusted: `${lastWeek.start.toISOString().split('T')[0]} a ${lastWeek.end.toISOString().split('T')[0]}`
    }
  });
  
  const thisWeekData = await fetchAtendimentosFromSupabase(
    thisWeek.start.toISOString().split('T')[0],
    thisWeek.end.toISOString().split('T')[0]
  );
  
  const lastWeekData = await fetchAtendimentosFromSupabase(
    lastWeek.start.toISOString().split('T')[0],
    lastWeek.end.toISOString().split('T')[0]
  );
  
  console.log('Dados semanais:', { 
    thisWeek: thisWeekData.length, 
    lastWeek: lastWeekData.length,
    diff: thisWeekData.length - lastWeekData.length
  });
  
  const thisCount = thisWeekData.length;
  const lastCount = lastWeekData.length;
  const diff = thisCount - lastCount;
  const percent = lastCount > 0 ? ((diff / lastCount) * 100).toFixed(1) : 0;
  
  document.getElementById('weeklyCount').textContent = thisCount;
  
  const comparisonEl = document.getElementById('weeklyComparison');
  
  if (diff > 0) {
    comparisonEl.innerHTML = `
      <span class="weekly-diff positive">+${diff} munícipes</span>
      em relação à semana passada
      <div style="margin-top:8px;font-size:0.9rem;">
        Isso representa <strong>+${percent}%</strong> da semana passada
      </div>
    `;
  } else if (diff < 0) {
    comparisonEl.innerHTML = `
      <span class="weekly-diff negative">${diff} munícipes</span>
      em relação à semana passada
      <div style="margin-top:8px;font-size:0.9rem;">
        Isso representa <strong>${percent}%</strong> da semana passada
      </div>
    `;
  } else {
    comparisonEl.innerHTML = `
      <span class="weekly-diff">Mesmo número de munícipes</span>
      em relação à semana passada
    `;
  }
}

// Dashboard 4: Taxa de Crescimento Mensal
async function updateMonthlyComparison() {
  const thisMonth = getMonthRange(0);
  const lastMonth = getMonthRange(1);
  
  const thisMonthData = await fetchAtendimentosFromSupabase(
    thisMonth.start.toISOString().split('T')[0],
    thisMonth.end.toISOString().split('T')[0]
  );
  
  const lastMonthData = await fetchAtendimentosFromSupabase(
    lastMonth.start.toISOString().split('T')[0],
    lastMonth.end.toISOString().split('T')[0]
  );
  
  const thisCount = thisMonthData.length;
  const lastCount = lastMonthData.length;
  const diff = thisCount - lastCount;
  const percent = lastCount > 0 ? ((diff / lastCount) * 100).toFixed(1) : 0;
  
  document.getElementById('monthlyCount').textContent = thisCount;
  
  const comparisonEl = document.getElementById('monthlyComparison');
  
  if (diff > 0) {
    comparisonEl.innerHTML = `
      <span class="weekly-diff positive">+${diff} munícipes</span>
      em relação ao mês passado
      <div style="margin-top:8px;font-size:0.9rem;">
        Isso representa <strong>+${percent}%</strong> do mês passado
      </div>
    `;
  } else if (diff < 0) {
    comparisonEl.innerHTML = `
      <span class="weekly-diff negative">${diff} munícipes</span>
      em relação ao mês passado
      <div style="margin-top:8px;font-size:0.9rem;">
        Isso representa <strong>${percent}%</strong> do mês passado
      </div>
    `;
  } else {
    comparisonEl.innerHTML = `
      <span class="weekly-diff">Mesmo número de munícipes</span>
      em relação ao mês passado
    `;
  }
}

// Dashboard 5: Comparativo Hora a Hora (gráfico de linha)
async function updateHourlyChart() {
  const last30Days = getLast30Days();
  
  const data = await fetchAtendimentosFromSupabase(
    last30Days.start.toISOString().split('T')[0],
    last30Days.end.toISOString().split('T')[0]
  );
  
  // Agrupar por hora (08h - 17h)
  // ATENÇÃO: Aplicar máscara de +3h para ajustar fuso horário do banco
  // Banco mostra 08h → Consideramos 11h real
  const hourCounts = {};
  for (let h = 8; h <= 17; h++) {
    hourCounts[h] = 0;
  }
  
  data.forEach(item => {
    if (!item.datetime) return;
    const date = new Date(item.datetime);
    const hourUTC = date.getHours(); // Hora do banco
    const hourAdjusted = hourUTC + 3; // Aplicar máscara +3h
    
    // Agora hourAdjusted representa o horário ajustado
    if (hourAdjusted >= 8 && hourAdjusted <= 17) {
      hourCounts[hourAdjusted]++;
    }
  });
  
  // Calcular total e percentuais
  const totalCount = Object.values(hourCounts).reduce((sum, v) => sum + v, 0);
  const hourLabels = [];
  const hourValues = [];
  
  for (let h = 8; h <= 17; h++) {
    hourLabels.push(`${String(h).padStart(2, '0')}h`);
    const percent = totalCount > 0 ? ((hourCounts[h] / totalCount) * 100).toFixed(1) : 0;
    hourValues.push(parseFloat(percent));
  }
  
  // Criar gráfico
  const canvas = document.getElementById('hourlyChart');
  const ctx = canvas.getContext('2d');
  
  if (hourlyChartInstance) {
    hourlyChartInstance.destroy();
  }
  
  hourlyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hourLabels,
      datasets: [{
        label: 'Percentual de Atendimentos',
        data: hourValues,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.parsed.y}% dos atendimentos`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          },
          title: {
            display: true,
            text: 'Percentual de Atendimentos'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Horário'
          }
        }
      }
    }
  });
}

// Dashboard 6: Atendimentos por Dia da Semana (Segunda a Sexta)
async function updateWeekdayChart() {
  // Buscar dados da semana atual com máscara
  const thisWeek = getWeekRange(0);
  
  const data = await fetchAtendimentosFromSupabase(
    thisWeek.start.toISOString().split('T')[0],
    thisWeek.end.toISOString().split('T')[0]
  );
  
  // Agrupar por dia da semana (1 = Segunda, 5 = Sexta)
  const weekdayCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const weekdayNames = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
  
  data.forEach(item => {
    if (!item.datetime) return;
    const date = new Date(item.datetime);
    const day = date.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    
    // Apenas Segunda (1) a Sexta (5)
    if (day >= 1 && day <= 5) {
      weekdayCounts[day]++;
    }
  });
  
  const labels = weekdayNames;
  const values = [
    weekdayCounts[1],
    weekdayCounts[2],
    weekdayCounts[3],
    weekdayCounts[4],
    weekdayCounts[5]
  ];
  const total = values.reduce((sum, v) => sum + v, 0);
  
  const canvas = document.getElementById('weekdayChart');
  const ctx = canvas.getContext('2d');
  
  if (weekdayChartInstance) {
    weekdayChartInstance.destroy();
  }
  
  weekdayChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Atendimentos',
        data: values,
        backgroundColor: [
          '#3b82f6',
          '#8b5cf6',
          '#ec4899',
          '#f59e0b',
          '#10b981'
        ],
        borderWidth: 0,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.parsed.y;
              const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${value} atendimentos (${percent}%)`;
            }
          }
        },
        datalabels: {
          anchor: 'center',
          align: 'center',
          color: '#ffffff',
          font: {
            size: 14,
            weight: 'bold'
          },
          formatter: function(value) {
            return value > 0 ? value : '';
          }
        }
      },
      scales: {
        y: {
          display: false, // Esconder eixo Y completamente
          beginAtZero: true
        },
        x: {
          ticks: {
            color: '#ffffff', // Texto branco
            font: {
              size: 11,
              weight: '500'
            }
          },
          grid: {
            display: false
          }
        }
      }
    },
    plugins: [ChartDataLabels] // Plugin para mostrar valores nas barras
  });
}

// Dashboard 7: Calendário de Atendimentos
async function updateCalendar() {
  const year = currentCalendarMonth.getFullYear();
  const month = currentCalendarMonth.getMonth();
  
  // Atualizar título
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  document.getElementById('calendarMonth').textContent = `${monthNames[month]} ${year}`;
  
  // Buscar dados do mês
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // NÃO aplicar máscara +1 dia - dados já estão no timezone correto
  const data = await fetchAtendimentosFromSupabase(
    firstDay.toISOString().split('T')[0],
    lastDay.toISOString().split('T')[0]
  );
  
  // Agrupar por dia
  const dayCounts = {};
  data.forEach(item => {
    if (!item.datetime) return;
    const date = new Date(item.datetime);
    const day = date.getDate();
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  });
  
  // Encontrar min e max para escala de cores
  const counts = Object.values(dayCounts);
  const maxCount = counts.length > 0 ? Math.max(...counts) : 0;
  const minCount = counts.length > 0 ? Math.min(...counts) : 0;
  
  // Função para cor baseada em faixas fixas de volume
  function getColorForCount(count) {
    if (count === 0 || !count) return '#f3f4f6'; // Cinza claro (vazio)
    
    if (count <= 35) return '#22c55e';   // Verde médio (muito baixo: 0-35)
    if (count <= 60) return '#86efac';   // Verde claro (baixo: 36-60)
    if (count <= 85) return '#fbbf24';   // Amarelo (médio: 61-85)
    if (count <= 120) return '#f97316';  // Laranja (alto: 86-120)
    return '#ef4444'; // Vermelho (muito alto: 120+)
  }
  
  // Montar grid
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  
  // Cabeçalhos dos dias da semana
  const dayHeaders = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  dayHeaders.forEach(dayName => {
    const header = document.createElement('div');
    header.className = 'calendar-day calendar-day-header';
    header.textContent = dayName;
    grid.appendChild(header);
  });
  
  // Dias vazios antes do primeiro dia do mês
  const firstDayOfWeek = firstDay.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    const empty = document.createElement('div');
    empty.className = 'calendar-day calendar-day-empty';
    grid.appendChild(empty);
  }
  
  // Dias do mês
  const daysInMonth = lastDay.getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    
    const count = dayCounts[day] || 0;
    dayEl.style.backgroundColor = getColorForCount(count);
    dayEl.style.color = count > maxCount * 0.5 ? '#fff' : '#1f2937';
    
    dayEl.textContent = day;
    
    if (count > 0) {
      dayEl.title = `${day}/${month + 1}: ${count} atendimentos`;
    }
    
    grid.appendChild(dayEl);
  }
}

// Navegação do calendário
function initCalendarControls() {
  const prevBtn = document.getElementById('calendarPrevMonth');
  const nextBtn = document.getElementById('calendarNextMonth');
  const todayBtn = document.getElementById('calendarToday');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', async () => {
      currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() - 1);
      await updateCalendar();
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + 1);
      await updateCalendar();
    });
  }
  
  if (todayBtn) {
    todayBtn.addEventListener('click', async () => {
      currentCalendarMonth = new Date();
      await updateCalendar();
    });
  }
}

// Atualizar todos os dashboards
async function updateDashboards() {
  // Setar datas padrão se não estiverem definidas
  const deptFrom = document.getElementById('deptChartFrom');
  const deptTo = document.getElementById('deptChartTo');
  const bairroFrom = document.getElementById('bairroChartFrom');
  const bairroTo = document.getElementById('bairroChartTo');
  
  const today = getTodayString();
  const monday = getMondayOfCurrentWeek();
  
  // Data início = segunda-feira da semana atual
  if (!deptFrom.value) deptFrom.value = monday;
  if (!bairroFrom.value) bairroFrom.value = monday;
  
  // Esconder mensagem de carregamento e mostrar conteúdo
  const loadingEl = document.getElementById('dashboardLoading');
  const contentEl = document.getElementById('dashboardContent');
  
  if (loadingEl) loadingEl.classList.add('hidden');
  if (contentEl) contentEl.classList.remove('hidden');
  
  // Atualizar todos os dashboards
  await Promise.all([
    updateDeptChart(),
    updateBairroChart(),
    updateWeeklyComparison(),
    updateMonthlyComparison(),
    updateHourlyChart(),
    updateWeekdayChart(),
    updateCalendar()
  ]);
}

// Event listeners para filtros dos gráficos
function initDashboardFilters() {
  document.getElementById('deptChartApply')?.addEventListener('click', updateDeptChart);
  document.getElementById('bairroChartApply')?.addEventListener('click', updateBairroChart);
  initCalendarControls();
}

// ========== LÓGICA EXISTENTE DE RELATÓRIOS ==========
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
	,9: 'Sala 9 - Prestador de Serviços à Comunidade'
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
			// Buscar atendimentos com paginação para garantir todos os registros
			let allAtRows = [];
			let page = 0;
			const pageSize = 1000;
			let hasMore = true;
			
			while (hasMore && allAtRows.length < 10000) {
				const from = page * pageSize;
				const to = from + pageSize - 1;
				
				let q = window.supabase
					.from('atendimentos')
					.select('*', { count: 'exact' })
					.order('created_at', { ascending: false })
					.range(from, to);
				
				if(dept && dept !== 'all') q = q.eq('dep_direcionado', String(dept));
				
				const { data, error, count } = await q;
				
				if(error){ 
					console.warn('Supabase atendimentos select error (página ' + page + ')', error); 
					break;
				}
				
				if (!data || data.length === 0) {
					hasMore = false;
					break;
				}
				
				allAtRows = allAtRows.concat(data);
				// Log removido para reduzir poluição do console
				
				if (data.length < pageSize) {
					hasMore = false;
				}
				
				page++;
			}
			
			console.log(`✅ Base Geral - Total de atendimentos buscados: ${allAtRows.length}`);
			
			const atRows = allAtRows;
			
			// Função para normalizar documento (remover pontos, traços e espaços)
			const normalizeDoc = (doc) => {
				if (!doc) return '';
				return String(doc).replace(/[.\-\s]/g, '').trim();
			};
			
			console.log(`📋 Buscando munícipes no banco...`);
			
			let munMap = {};
			// Buscar TODOS os munícipes com PAGINAÇÃO (sem filtro) para garantir compatibilidade
			try {
				let allMunicipes = [];
				let page = 0;
				const pageSize = 1000;
				let hasMore = true;
				
				while (hasMore) {
					const from = page * pageSize;
					const to = from + pageSize - 1;
					
					const { data: munData, error: munErr } = await window.supabase
						.from('municipes')
						.select('*')
						.range(from, to);
					
					if(munErr){ 
						console.warn('Erro ao buscar munícipes (página ' + page + '):', munErr);
						break;
					}
					
					if (!munData || munData.length === 0) {
						hasMore = false;
						break;
					}
					
					allMunicipes = allMunicipes.concat(munData);
					
					if (munData.length < pageSize) {
						hasMore = false;
					}
					
					page++;
				}
				
				console.log(`✅ ${allMunicipes.length} munícipes carregados do banco`);
				
				// Criar map com documento NORMALIZADO como chave
				munMap = allMunicipes.reduce((acc,m)=>{ 
					const normalizedDoc = normalizeDoc(m.documento);
					acc[normalizedDoc] = m; 
					return acc; 
				}, {});
				
			} catch(e) {
				console.error('Erro ao buscar munícipes:', e);
			}
			// mapear linhas usando documento NORMALIZADO para o match
			const rows = atRows.map(a=>{
				const docNormalizado = normalizeDoc(a.munic_doc);
				const m = (docNormalizado && munMap[docNormalizado]) ? munMap[docNormalizado] : {};
				
				const row = {
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
				return row;
			});
			
			console.log(`✅ ${rows.length} atendimentos mapeados com sucesso`);
			// Filtrar localmente usando exclusivamente created_at (apenas data, sem horário)
			// Aplicar máscara +1 dia para corrigir offset de fuso horário na busca
			// Quando usuário busca 02/12, precisa buscar 03/12 no banco para pegar os registros corretos
			const start = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1) : null;
			const end = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null;
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
	// Inicializar navegação entre seções (não carrega dashboards ainda)
	initNavigation();
	// Inicializar filtros dos dashboards
	initDashboardFilters();
	
	const ready = await waitForSupabase(5000, 250);
	
	// definir data início padrão como hoje, caso o campo esteja vazio
	try{
		if(reportFrom && !reportFrom.value){
			const now = new Date();
			const pad = (n)=> String(n).padStart(2,'0');
			reportFrom.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
		}
	}catch(e){ console.warn('Erro ao setar data padrão de início', e); }
	
	// Aguardar Supabase estar pronto antes de atualizar dashboards
	if(ready){
		console.log('Supabase pronto, carregando dashboards...');
		await updateDashboards();
	} else {
		console.warn('Supabase não carregou a tempo, dashboards ficarão vazios até atualização manual');
	}
	
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
				console.log('Supabase carregado em background, atualizando dashboards...');
				await updateDashboards();
				await renderReportsTableAsync();
				return;
			}
			if(attempts >= extraAttempts){ clearInterval(backIv); }
		}, 500);
	}
})();
