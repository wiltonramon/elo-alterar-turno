// ==UserScript==
// @name         ELO Convoca+ | Alternar turno do pleito
// @namespace    https://cad-elo22.tse.jus.br/
// @version      1.8.3
// @description  Alterna o Pleito por botão e permite memorizar o turno com persistência opcional, inclusive nas consultas completa e por inscrição/CPF
// @author       Ramon
// @match        https://cad-elo22.tse.jus.br/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Configuração: identificação dos controles, aparência e tempos de espera.
  const ID_BTN = 'tm-alternar-turno';
  const ID_PAINEL = `${ID_BTN}-painel`;
  const ID_SWITCH = `${ID_BTN}-persistencia`;
  const ID_ESTILO = `${ID_BTN}-impressao`;
  const CHAVE_PERSISTENCIA = `${ID_BTN}:persistencia`;
  const ORIGEM = 'https://cad-elo22.tse.jus.br';
  const ROTA = '#/main/convocacao';
  const SEL_PLEITO = ['pleito', 'pleitoCompleta', 'pleitoInscricao']
    .flatMap((nome) => [
      `app-select-encadeado[formcontrolname="${nome}"]`,
      `app-select-encadeado[name="${nome}"]`
    ]).join(', ');
  const SEL_PAINEL = '.cdk-overlay-container .mat-select-panel, '
    + '.cdk-overlay-container .mat-mdc-select-panel, '
    + '.cdk-overlay-container [role="listbox"]';
  const CORES = { primeiro: '#6d28d9', segundo: '#c2410c', ausente: '#6b7280' };

  const TEMPOS = {
    campo: 10000,       // Limpar, renderizar e confirmar a seleção no ELO.
    opcoes: 5000,       // Carregar as opções antes da alternativa pelo teclado.
    intervalo: 80,     // Intervalo entre verificações de uma condição.
    atualizacao: 150,  // Agrupa várias mudanças do DOM em uma atualização.
    navegacao: 500     // Detecta rotas que mudam sem emitir hashchange.
  };
  const ESTILOS_COMUNS_BOTAO = [
    'box-sizing:border-box', 'border-radius:999px', 'cursor:pointer',
    'max-width:calc(100vw - 40px)'
  ];

  // Uma única operação pode controlar os campos por vez. A geração cancela
  // operações antigas quando a rota muda ou a persistência é desligada.
  let armazenamentoDisponivel = true;
  let preferencias = lerPreferencias();
  let operacao = null;
  let falha = null;
  let ultimaURL = location.href;
  let timer = null;
  let observando = false;
  let geracao = 0;

  const pausar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
  const estaVisivel = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  // Preferências persistidas: JSON inválido usa o padrão; acesso bloqueado é avisado.
  function lerPreferencias() {
    let conteudo;
    try {
      conteudo = localStorage.getItem(CHAVE_PERSISTENCIA);
      armazenamentoDisponivel = true;
    } catch {
      armazenamentoDisponivel = false;
      return { ativa: false, turno: null };
    }
    try {
      const dados = JSON.parse(conteudo || 'null');
      const turno = dados?.turno === 1 || dados?.turno === 2 ? dados.turno : null;
      return { ativa: dados?.ativa === true && turno !== null, turno };
    } catch {
      return { ativa: false, turno: null };
    }
  }

  function salvarPreferencias() {
    try {
      localStorage.setItem(CHAVE_PERSISTENCIA, JSON.stringify(preferencias));
      armazenamentoDisponivel = true;
    } catch {
      // O uso continua nesta página, mas o controle informa que não foi possível salvar.
      armazenamentoDisponivel = false;
    }
  }

  function alternarPersistencia() {
    if (!paginaPermitida() || (operacao && !operacao.automatica)) return;
    if (preferencias.ativa) {
      preferencias.ativa = false;
      if (operacao?.automatica) geracao++;
    } else {
      const { turno } = estadoDosCampos(camposPleito());
      preferencias = { ativa: true, turno: turno ?? preferencias.turno ?? 2 };
    }
    falha = null;
    salvarPreferencias();
    verificar();
  }

  function sincronizarPersistencia(campos) {
    if (!preferencias.ativa || operacao || falha || !paginaPermitida()) return;
    const pendentes = campos.filter((campo) => {
      const turno = turnoAtual(campo);
      if (turno === preferencias.turno) return false;
      // Aguarda o componente renderizar a seleção ou disponibilizar a lista.
      const select = campo.querySelector('mat-select');
      return turno !== null || (select && select.getAttribute('aria-disabled') !== 'true');
    });
    if (pendentes.length) void aplicarTurno(pendentes, preferencias.turno, true);
  }

  // Limite de atuação: convocação e suas subpáginas, no domínio autorizado.
  function paginaPermitida() {
    const rota = location.hash.split('?')[0].replace(/\/+$/, '');
    return location.origin === ORIGEM && location.pathname === '/'
      && (rota === ROTA || rota.startsWith(`${ROTA}/`));
  }

  function operacaoValida(atual) {
    return paginaPermitida() && atual === operacao && atual.geracao === geracao
      && (!atual.automatica || (preferencias.ativa && preferencias.turno === atual.destino));
  }

  function conferirOperacao(atual) {
    if (operacaoValida(atual)) return;
    const erro = new Error('Operação cancelada por navegação ou mudança da persistência.');
    erro.name = 'AbortError';
    throw erro;
  }

  // As esperas consultam o DOM e também verificam o cancelamento, sem pausas longas fixas.
  async function esperar(fn, atual, limite = TEMPOS.campo) {
    const fim = Date.now() + limite;
    while (Date.now() < fim) {
      conferirOperacao(atual);
      const valor = fn();
      if (valor) return valor;
      await pausar(TEMPOS.intervalo);
    }
    return null;
  }

  // Leitura e localização dos campos. O localizador tolera a recriação pelo Angular.
  function extrairTurno(texto) {
    const resultado = /\b([12])\s*[ºo°]\s*turno\b/i.exec(texto || '');
    return resultado ? Number(resultado[1]) : null;
  }

  function botaoLimpar(campo) {
    return campo?.querySelector('.txt button') || null;
  }

  function turnoAtual(campo) {
    const texto = campo?.querySelector('.txt');
    if (!texto) return null;
    const turno = extrairTurno(texto.querySelector(':scope > span')?.textContent)
      || extrairTurno(botaoLimpar(campo)?.getAttribute('aria-label'));
    if (turno) return turno;
    if (texto.classList.contains('primeiro')) return 1;
    if (texto.classList.contains('segundo')) return 2;
    return null;
  }

  function camposPleito() {
    return [...document.querySelectorAll('app-select-encadeado')]
      .filter((campo) => estaVisivel(campo)
        && (campo.matches(SEL_PLEITO) || turnoAtual(campo)));
  }

  function estadoDosCampos(campos) {
    const turnos = new Set(campos.map((campo) => turnoAtual(campo)));
    return {
      turno: turnos.size === 1 ? turnos.values().next().value : null,
      diferentes: turnos.size > 1
    };
  }

  function criarLocalizador(campo) {
    const referencia = ['formcontrolname', 'name', 'id']
      .map((atributo) => [atributo, campo.getAttribute(atributo)])
      .find(([, valor]) => valor);
    return () => {
      if (campo.isConnected) return estaVisivel(campo) ? campo : null;
      if (!referencia) return null;
      const [atributo, valor] = referencia;
      return [...document.querySelectorAll('app-select-encadeado')]
        .find((el) => estaVisivel(el) && el.getAttribute(atributo) === valor) || null;
    };
  }

  // Seleção no Angular Material: procura opções somente no painel do campo aberto.
  function paineisVisiveis() {
    return [...document.querySelectorAll(SEL_PAINEL)].filter(estaVisivel);
  }

  function painelDoSelect(select, paineisAnteriores) {
    const ids = [select.getAttribute('aria-controls'), select.getAttribute('aria-owns')]
      .filter(Boolean).flatMap((valor) => valor.split(/\s+/));
    if (select.id) ids.push(`${select.id}-panel`);
    for (const id of ids) {
      const painel = document.getElementById(id);
      if (estaVisivel(painel)) return painel;
    }
    // Compatibilidade: aceita somente um painel que se tornou visível após abrir este campo.
    const novos = paineisVisiveis().filter((painel) => !paineisAnteriores.has(painel));
    return novos.length === 1 ? novos[0] : null;
  }

  function acharOpcao(turno, painel) {
    if (!painel) return null;
    const inicio = new RegExp(`^\\s*${turno}\\s*[ºo°]\\s*turno\\b`, 'i');
    return [...painel.querySelectorAll('mat-option, [role="option"]')]
      .find((opcao) => estaVisivel(opcao)
        && opcao.getAttribute('aria-disabled') !== 'true'
        && !opcao.hasAttribute('disabled')
        && inicio.test(opcao.textContent)) || null;
  }

  async function selecionarTurnoNaLista(turno, obterCampo, operacaoAtual) {
    const select = await esperar(() => obterCampo()?.querySelector('mat-select'), operacaoAtual);
    conferirOperacao(operacaoAtual);
    if (!select) throw new Error('A lista do Pleito não apareceu após limpar.');

    const anteriores = new Set(paineisVisiveis());
    (select.querySelector('.mat-select-trigger') || select).click();
    const buscar = () => acharOpcao(turno, painelDoSelect(select, anteriores));
    let opcao = await esperar(buscar, operacaoAtual, TEMPOS.opcoes);
    conferirOperacao(operacaoAtual);
    if (!opcao) {
      // Não fecha um menu já aberto ao tentar a alternativa pelo teclado.
      if (select.getAttribute('aria-expanded') !== 'true') {
        select.focus();
        select.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
      }
      opcao = await esperar(buscar, operacaoAtual, TEMPOS.opcoes);
    }
    conferirOperacao(operacaoAtual);
    if (!opcao) throw new Error(`A opção do ${turno}º turno não foi encontrada neste campo.`);
    opcao.click();
  }

  async function trocarCampo(obterCampo, destino, operacaoAtual) {
    conferirOperacao(operacaoAtual);
    const campo = obterCampo();
    if (!campo) throw new Error('Um campo Pleito deixou de estar disponível.');
    if (turnoAtual(campo) === destino) return;

    const limpar = botaoLimpar(campo);
    if (limpar) {
      limpar.click();
      const limpo = await esperar(() => {
        const atual = obterCampo();
        return atual && !botaoLimpar(atual);
      }, operacaoAtual);
      if (!limpo) throw new Error('Não foi possível limpar um campo Pleito.');
    }
    await selecionarTurnoNaLista(destino, obterCampo, operacaoAtual);
    const confirmado = await esperar(() => turnoAtual(obterCampo()) === destino, operacaoAtual);
    if (!confirmado) throw new Error('A página não confirmou a troca de um campo.');
  }

  function definirTexto(btn, texto) {
    if (btn.textContent !== texto) btn.textContent = texto;
  }

  // Entrada manual e execução compartilhada com a persistência.
  async function alternar() {
    if (!paginaPermitida() || operacao) return;
    const campos = camposPleito();
    if (!campos.length) {
      atualizarRotulo(campos);
      return;
    }
    const { turno } = estadoDosCampos(campos);
    const destino = falha?.destino ?? (turno === 2 ? 1 : 2);
    if (preferencias.ativa) {
      preferencias.turno = destino;
      salvarPreferencias();
    }
    await aplicarTurno(campos, destino);
  }

  async function aplicarTurno(campos, destino, automatica = false) {
    if (!paginaPermitida() || operacao) return;
    const btn = document.getElementById(ID_BTN);
    if (!btn) return;
    const localizadores = campos.map(criarLocalizador);
    const atual = { automatica, destino, geracao };
    falha = null;
    operacao = atual;
    atualizarControlePersistencia();
    btn.title = '';
    definirTexto(btn, 'Alternando…');
    try {
      // Cada lista é aberta e fechada antes de passar ao próximo campo.
      for (const obterCampo of localizadores) {
        await trocarCampo(obterCampo, destino, atual);
      }
      conferirOperacao(atual);
      if (localizadores.some((obterCampo) => turnoAtual(obterCampo()) !== destino)) {
        throw new Error('Um dos campos mudou novamente durante a troca.');
      }
    } catch (erro) {
      if (erro.name === 'AbortError' || !operacaoValida(atual)) return;
      console.error('[Alternar turno]', erro);
      const concluidos = localizadores
        .filter((obterCampo) => turnoAtual(obterCampo()) === destino).length;
      falha = {
        destino,
        texto: `Troca incompleta: ${concluidos}/${campos.length} campos. Clique para tentar novamente.`,
        detalhe: `Destino: ${destino}º turno. ${erro.message}`
      };
    } finally {
      operacao = null;
      // Reavalia campos que apareceram durante a troca e mantém erros visíveis.
      verificar();
    }
  }

  // Apresentação: estado do botão, persistência e recolhimento do painel.
  function ajustarTamanhoBotao(btn, recolhido) {
    btn.style.width = recolhido ? '24px' : '';
    btn.style.height = recolhido ? '40px' : '';
    btn.style.padding = recolhido ? '0' : '12px 18px';
    btn.style.borderRadius = recolhido ? '0 10px 10px 0' : '999px';
    btn.style.fontSize = recolhido ? '20px' : '13px';
    btn.style.cursor = recolhido ? 'default' : 'pointer';
  }

  function atualizarControlePersistencia(recolhido = false) {
    const controle = document.getElementById(ID_SWITCH);
    if (!controle) return;
    controle.style.display = recolhido ? 'none' : 'flex';
    controle.disabled = Boolean(operacao && !operacao.automatica);
    controle.setAttribute('aria-checked', String(preferencias.ativa));
    const texto = preferencias.ativa
      ? `Persistência ON (${preferencias.turno}º)` : 'Persistência OFF';
    let descricao = preferencias.ativa
      ? `Manter automaticamente o ${preferencias.turno}º turno. Clique para desligar.`
      : 'Clique para memorizar o turno atual e ativar a troca automática.';
    if (!armazenamentoDisponivel) {
      descricao += ' Não foi possível salvar no navegador; a configuração vale somente nesta página.';
    }
    controle.title = descricao;
    controle.setAttribute('aria-label', `${texto}. ${descricao}`);
    const rotulo = document.getElementById(`${ID_SWITCH}-rotulo`);
    if (rotulo) definirTexto(rotulo, texto);
    const trilho = document.getElementById(`${ID_SWITCH}-trilho`);
    if (trilho) trilho.style.background = preferencias.ativa ? '#15803d' : '#9ca3af';
    const cursor = document.getElementById(`${ID_SWITCH}-cursor`);
    if (cursor) cursor.style.transform = preferencias.ativa ? 'translateX(12px)' : 'translateX(0)';
  }

  function atualizarRotulo(campos) {
    const btn = document.getElementById(ID_BTN);
    if (!btn) return;
    const recolhido = !campos.length;
    atualizarControlePersistencia(recolhido);
    ajustarTamanhoBotao(btn, recolhido);
    if (recolhido) {
      btn.style.background = CORES.ausente;
      btn.title = 'Campos de turno não visíveis. O botão será expandido quando eles aparecerem.';
      if (preferencias.ativa) btn.title += ` Persistência ligada: ${preferencias.turno}º turno.`;
      if (falha) btn.title += ` ${falha.detalhe}`;
      btn.setAttribute('aria-label', btn.title);
      definirTexto(btn, '›');
      return;
    }
    if (operacao) return;
    const { turno, diferentes } = estadoDosCampos(campos);
    btn.style.background = turno === 2 ? CORES.segundo : CORES.primeiro;
    btn.title = falha?.detalhe || '';
    if (falha) {
      definirTexto(btn, falha.texto);
    } else if (diferentes) {
      definirTexto(btn, 'Turnos diferentes → definir 2º turno');
    } else {
      definirTexto(btn, turno
        ? `Turno atual: ${turno}º → ir p/ ${turno === 2 ? 1 : 2}º`
        : 'Selecionar 2º turno');
    }
    btn.setAttribute('aria-label', btn.textContent);
  }

  // Construção dos controles: o estilo comum fica centralizado e os eventos são
  // registrados apenas quando o painel precisa ser criado novamente.
  function criarElemento(tag, id, estilos = []) {
    const elemento = document.createElement(tag);
    elemento.id = id;
    elemento.style.cssText = estilos.join(';');
    return elemento;
  }

  function garantirEstiloImpressao() {
    if (document.getElementById(ID_ESTILO)) return;
    const estilo = criarElemento('style', ID_ESTILO);
    estilo.textContent = `@media print { #${ID_PAINEL} { display: none !important; } }`;
    (document.head || document.documentElement).appendChild(estilo);
  }

  function criarBotaoTurno() {
    const btn = criarElemento('button', ID_BTN, [
      ...ESTILOS_COMUNS_BOTAO,
      'padding:12px 18px', 'border:none',
      'font:600 13px/1.3 Roboto,Arial,sans-serif', 'color:#fff', `background:${CORES.primeiro}`,
      'box-shadow:0 4px 14px rgba(0,0,0,.35)'
    ]);
    btn.type = 'button';
    btn.addEventListener('click', alternar);
    return btn;
  }

  function criarControlePersistencia() {
    const controle = criarElemento('button', ID_SWITCH, [
      ...ESTILOS_COMUNS_BOTAO,
      'display:flex', 'align-items:center', 'justify-content:center', 'gap:6px', 'padding:8px 10px',
      'border:1px solid #d1d5db', 'background:#fff',
      'color:#1f2937', 'font:600 12px/1.3 Roboto,Arial,sans-serif',
      'box-shadow:0 2px 8px rgba(0,0,0,.2)'
    ]);
    controle.type = 'button';
    controle.setAttribute('role', 'switch');
    const trilho = criarElemento('span', `${ID_SWITCH}-trilho`, [
      'position:relative', 'width:32px', 'height:20px', 'border-radius:999px', 'flex-shrink:0'
    ]);
    trilho.setAttribute('aria-hidden', 'true');
    const cursor = criarElemento('span', `${ID_SWITCH}-cursor`, [
      'position:absolute', 'left:2px', 'top:2px', 'width:16px', 'height:16px',
      'background:#fff', 'border-radius:50%', 'box-shadow:0 1px 3px rgba(0,0,0,.25)'
    ]);
    trilho.appendChild(cursor);
    controle.appendChild(trilho);
    controle.appendChild(criarElemento('span', `${ID_SWITCH}-rotulo`));
    controle.addEventListener('click', alternarPersistencia);
    return controle;
  }

  function criarPainel() {
    if (document.getElementById(ID_PAINEL)) return;
    garantirEstiloImpressao();
    const painel = criarElemento('div', ID_PAINEL, [
      'position:fixed', 'left:8px', 'bottom:150px', 'z-index:2147483647',
      'display:grid', 'grid-template-columns:minmax(0,max-content)',
      // Os dois controles usam a mesma largura e altura; recolhido, só o principal aparece.
      'justify-items:stretch', 'align-items:stretch', 'grid-auto-rows:1fr', 'gap:8px',
      'max-width:calc(100vw - 16px)'
    ]);
    painel.appendChild(criarBotaoTurno());
    painel.appendChild(criarControlePersistencia());
    document.body.appendChild(painel);
  }

  // Navegação e observação do DOM: ativa a observação só dentro da convocação.
  function verificar() {
    if (ultimaURL !== location.href) {
      ultimaURL = location.href;
      geracao++;
      falha = null;
    }
    if (!paginaPermitida()) {
      clearTimeout(timer);
      observador.disconnect();
      observando = false;
      document.getElementById(ID_PAINEL)?.remove();
      return;
    }
    if (!observando) {
      observador.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-label']
      });
      observando = true;
    }
    const campos = camposPleito();
    criarPainel();
    atualizarRotulo(campos);
    sincronizarPersistencia(campos);
  }

  window.addEventListener('hashchange', verificar);
  window.addEventListener('popstate', verificar);
  window.addEventListener('pageshow', verificar);
  window.addEventListener('storage', (evento) => {
    if (evento.key !== CHAVE_PERSISTENCIA && evento.key !== null) return;
    preferencias = lerPreferencias();
    falha = null;
    verificar();
  });

  // A navegação interna pode mudar o endereço sem emitir hashchange.
  // Fora da convocação, compara somente a URL, sem observar ou buscar campos.
  setInterval(() => {
    if (location.href !== ultimaURL) verificar();
  }, TEMPOS.navegacao);
  const observador = new MutationObserver((mutacoes) => {
    if (!paginaPermitida()) return;
    // Ignora os controles do script para não reagir às suas próprias atualizações.
    const relevante = mutacoes.some(({ target }) => {
      const elemento = target.nodeType === 3 ? target.parentElement : target;
      return !elemento?.closest(`#${ID_PAINEL}`);
    });
    if (!relevante) return;
    clearTimeout(timer);
    timer = setTimeout(verificar, TEMPOS.atualizacao);
  });

  verificar();
})();
