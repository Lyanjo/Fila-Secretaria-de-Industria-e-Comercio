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

  // Versão específica que funciona bem
  const SUPABASE_VERSION = '2.38.4';

  // Fallback 1: ESM via jsdelivr
  async function tryLoadESM(){
    try{
      const mod = await import(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_VERSION}/+esm`);
      if(mod && typeof mod.createClient === 'function'){
        console.info('✅ supabase-js carregado via ESM (jsdelivr)');
        return mod.createClient;
      }
      return null;
    }catch(e){
      console.warn('⚠️ Fallback ESM (jsdelivr) falhou:', e.message);
      return null;
    }
  }

  // Fallback 2: UMD via unpkg
  function tryLoadUMD(){
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `https://unpkg.com/@supabase/supabase-js@${SUPABASE_VERSION}/dist/umd/supabase.js`;
      script.async = true;
      script.onload = () => {
        if(window.supabase && typeof window.supabase.createClient === 'function'){
          console.info('✅ supabase-js carregado via UMD (unpkg)');
          resolve(window.supabase.createClient);
        } else {
          console.warn('⚠️ UMD carregado mas createClient não encontrado');
          resolve(null);
        }
      };
      script.onerror = () => {
        console.warn('⚠️ Fallback UMD (unpkg) falhou');
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }

  // Fallback 3: UMD via CDNJS (mais estável)
  function tryLoadCDNJS(){
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `https://cdnjs.cloudflare.com/ajax/libs/supabase-js/${SUPABASE_VERSION}/supabase.min.js`;
      script.async = true;
      script.onload = () => {
        if(window.supabase && typeof window.supabase.createClient === 'function'){
          console.info('✅ supabase-js carregado via CDNJS (fallback 3)');
          resolve(window.supabase.createClient);
        } else {
          console.warn('⚠️ CDNJS carregado mas createClient não encontrado');
          resolve(null);
        }
      };
      script.onerror = () => {
        console.warn('⚠️ Fallback CDNJS falhou');
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }

  // Tenta carregar em ordem
  let createClientFn = null;

  // Fallback 1
  createClientFn = await tryLoadESM();
  
  // Fallback 2
  if(!createClientFn){
    createClientFn = await tryLoadUMD();
  }

  // Fallback 3
  if(!createClientFn){
    createClientFn = await tryLoadCDNJS();
  }

  if(!createClientFn){
    window.supabase = null;
    console.error('❌ ERRO: Não foi possível carregar Supabase de nenhuma CDN');
    console.error('Verifique:');
    console.error('1. Conexão com a internet');
    console.error('2. Firewall/antivírus bloqueando CDNs');
    console.error('3. Extensões do navegador (ad-blockers)');
    alert('⚠️ Sistema não conseguiu conectar ao banco de dados.\n\nVerifique sua conexão com a internet e recarregue a página.');
    return;
  }

  // Inicializa o cliente
  try{
    window.supabase = createClientFn(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    console.info('✅ Supabase client inicializado com sucesso');
  }catch(e){
    window.supabase = null;
    console.error('❌ Erro ao inicializar Supabase:', e.message);
    alert('⚠️ Erro ao conectar ao banco de dados.\n\nRecarregue a página.');
  }

})();
