// supabaseClient.js
// Inicializa o cliente Supabase se as variáveis estiverem definidas.
// Usa o bundle via CDN para evitar instalar pacotes.

(async function(){
  // Verifica se o usuário preencheu as variáveis de configuração
  if(!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    window.supabase = null;
    console.info('Supabase não configurado: verifique supabase-config.js');
    return;
  }

  // Função auxiliar: tenta importar versão ESM do SDK
  async function tryLoadESM(){
    try{
      // +esm fornece versão compatível com import dinâmico
      const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
      if(mod && typeof mod.createClient === 'function'){
        console.info('supabase-js carregado via ESM (cdn.jsdelivr)');
        return mod.createClient;
      }
      console.warn('Import ESM do supabase-js não retornou createClient');
      return null;
    }catch(e){
      console.warn('Import ESM do supabase-js falhou:', e && e.message ? e.message : e);
      return null;
    }
  }

  // Função auxiliar: tenta carregar UMD via tag <script> (fallback)
  function tryLoadUMD(){
    return new Promise((resolve) => {
      try{
        const script = document.createElement('script');
        // unpkg costuma servir o bundle UMD com global `supabase`
        script.src = 'https://unpkg.com/@supabase/supabase-js/dist/umd/supabase.min.js';
        script.async = true;
        script.onload = () => {
          // Algumas builds expõem createClient como window.supabase.createClient
          if(window.supabase && typeof window.supabase.createClient === 'function'){
            console.info('supabase-js carregado via UMD (unpkg) — createClient disponível em window.supabase.createClient');
            resolve(window.supabase.createClient);
            return;
          }
          // Em alguns cenários a lib pode expor createClient globalmente
          if(typeof window.createClient === 'function'){
            console.info('createClient já disponível globalmente após UMD load');
            resolve(window.createClient);
            return;
          }
          console.warn('UMD carregado mas createClient não encontrado');
          resolve(null);
        };
        script.onerror = (ev) => {
          console.warn('Falha ao carregar UMD do supabase-js (unpkg):', ev && ev.type ? ev.type : ev);
          resolve(null);
        };
        document.head.appendChild(script);
      }catch(ex){
        console.warn('Erro ao criar elemento <script> para UMD:', ex && ex.message ? ex.message : ex);
        resolve(null);
      }
    });
  }

  // Tenta carregar SDK por múltiplos meios
  let createClientFn = null;
  // Se createClient já está disponível, usa direto
  if(typeof window.createClient === 'function'){
    createClientFn = window.createClient;
    console.info('createClient já disponível no escopo global');
  }

  if(!createClientFn){
    createClientFn = await tryLoadESM();
  }
  if(!createClientFn){
    createClientFn = await tryLoadUMD();
  }

  if(!createClientFn){
    window.supabase = null;
    console.warn('Falha ao carregar SDK Supabase — verifique conexão de rede, bloqueio por firewall/CSP ou URL do CDN. Abra o Network tab para inspecionar a requisição do script.');
    return;
  }

  // Inicializa o cliente
  try{
    window.createClient = window.createClient || createClientFn;
    window.supabase = window.supabaseJs = window.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    console.info('Supabase client inicializado com sucesso');
  }catch(e){
    window.supabase = null;
    console.warn('Erro ao inicializar Supabase (createClient existia, mas init falhou):', e && e.message ? e.message : e);
  }

})();
