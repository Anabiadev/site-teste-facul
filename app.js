/* ==================================================================
   PAINEL DE PENDÊNCIAS – Secretaria de Assistência e Desenvolvimento Social
   Este arquivo é o "cérebro" do sistema: guarda os dados, aplica as
   regras (o que está atrasado, o que vence logo) e desenha as telas.

   GLOSSÁRIO RÁPIDO (leia uma vez e o resto fica fácil)
   ------------------------------------------------------------------
   const / let ............ criam "caixinhas" com nome para guardar valores.
                            const = o nome não pode ser trocado por outro valor.
                            let   = pode receber outro valor depois.
   function nome() { } .... bloco de código com nome, que roda quando é "chamado".
   (x) => { } ............. "função de seta": a mesma ideia, escrita mais curta.
   `texto ${variavel}` .... "template string": texto entre crases; o que está
                            dentro de ${ } é trocado pelo valor da variável.
   [ ] (array / lista) .... .filter() mantém só os itens que passam num teste
                            .map() transforma cada item   .find() acha o primeiro
                            .sort() ordena                .forEach() faz algo com cada item
                            .some() / .includes() respondem sim ou não
   { } (objeto) ........... um "cadastro" de pares nome/valor. Ex.: pessoa.nome
   document.getElementById("x") ... pega, na página, o elemento com id="x".
   elemento.textContent ... texto de um elemento (seguro).
   elemento.innerHTML ..... HTML de dentro de um elemento.
   addEventListener("click", função) ... "quando clicarem aqui, rode esta função".
   localStorage ........... um "armário" do navegador que guarda texto mesmo
                            depois que a página é fechada.
   JSON.stringify / JSON.parse ... transforma objeto em texto (para guardar)
                            e texto em objeto (para usar).
   async / await .......... esperar algo demorado (ler um arquivo) sem travar a página.
   ================================================================== */

"use strict"; // pede ao navegador para avisar de erros comuns de digitação


/* ==================================================================
   1. CONFIGURAÇÕES  (o que você pode ajustar sem mexer no resto)
   ================================================================== */

// Nome da "gaveta" onde guardamos tudo dentro do localStorage.
const CHAVE_STORAGE = "sas-pendencias-v1";

const DIAS_ALERTA = 7;  // "vence em breve" = prazo dentro dos próximos 7 dias
const DIAS_BACKUP = 7;  // avisa quando o último backup tiver mais de 7 dias

// ATENÇÃO: estes setores são FICTÍCIOS. Troque pelos nomes reais da secretaria.
const SETORES = [
  "Recepção",
  "Compras",
  "Administrativo",
  "Cadastro Único",
  "Recursos Humanos",
  "Proteção Social",
];
const STATUS = ["Aberto", "Em andamento", "Concluído"];
const TIPOS = ["Recebido", "Enviado"];

// Descreve as colunas de cada tabela. É usado para exportar e importar CSV:
//   chave  = nome do campo dentro do sistema
//   titulo = nome da coluna no arquivo CSV
//   tipo   = "data", "bool" (sim/não) ou nada (texto comum)
const CAMPOS = {
  funcionarios: [
    { chave: "nome", titulo: "nome" },
    { chave: "setor", titulo: "setor" },
    { chave: "cargo", titulo: "cargo" },
    { chave: "contato", titulo: "contato" },
    { chave: "obs", titulo: "observacoes" },
  ],
  oficios: [
    { chave: "numero", titulo: "numero" },
    { chave: "data", titulo: "data", tipo: "data" },
    { chave: "tipo", titulo: "tipo" },
    { chave: "origemDestino", titulo: "origem_destino" },
    { chave: "assunto", titulo: "assunto" },
    { chave: "setor", titulo: "setor" },
    { chave: "prazo", titulo: "prazo", tipo: "data" },
    { chave: "status", titulo: "status" },
    { chave: "aguardaExterno", titulo: "aguarda_resposta_externa", tipo: "bool" },
    { chave: "orgaoExterno", titulo: "orgao_externo" },
    { chave: "dataEnvioExterno", titulo: "data_envio_externo", tipo: "data" },
  ],
};

// Colunas que NÃO podem faltar num CSV importado.
const OBRIGATORIOS = {
  funcionarios: ["nome"],
  oficios: ["numero", "data", "assunto"],
};

const NOMES_TABELAS = { funcionarios: "funcionários", oficios: "ofícios e demandas" };


/* ==================================================================
   2. ESTADO: os dados que o sistema mantém na memória
   ================================================================== */

// "dados" guarda tudo. Formato:
// { funcionarios: [...], oficios: [...], ultimoBackup: "2026-11-18" ou null, modoTeste: true/false }
let dados;

let temporizadorMensagem; // usado para esconder a mensagem depois de alguns segundos


/* ==================================================================
   3. FUNÇÕES AUXILIARES (pequenas ferramentas usadas em vários lugares)
   ================================================================== */

// Atalho: em vez de escrever document.getElementById("x") toda hora, escrevemos el("x").
function el(id) {
  return document.getElementById(id);
}

// Cria um código único para cada registro (ex.: "lq3k9x2a7f4b").
function novoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Protege contra caracteres especiais ao colocar texto digitado dentro de HTML.
// Sem isto, alguém que digitasse <b> ou <script> no assunto bagunçaria a página.
function esc(valor) {
  const substituicoes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(valor ?? "").replace(/[&<>"']/g, (caractere) => substituicoes[caractere]);
}

// "1 dia" / "3 dias"
function plural(n, singular, pluralTexto) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

// Tira acentos e maiúsculas para a busca achar "recepcao" dentro de "Recepção".
function semAcento(texto) {
  return String(texto ?? "")
    .normalize("NFD")                 // separa a letra do acento
    .replace(/[\u0300-\u036f]/g, "")  // remove os acentos
    .toLowerCase();
}

/* ---------- Datas ----------
   Guardamos datas como texto "AAAA-MM-DD" (ex.: "2026-11-21"), que é o formato
   do <input type="date">. Esse formato tem uma vantagem: comparar textos
   funciona como comparar datas ("2026-11-02" < "2026-11-10"). */

// Converte um objeto Date em "AAAA-MM-DD" usando o horário LOCAL do computador.
function paraISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Converte "AAAA-MM-DD" em objeto Date (meia-noite, horário local).
function lerISO(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function hoje() {
  return paraISO(new Date());
}

// Soma (ou subtrai, se negativo) dias a uma data.
function somarDias(iso, quantidade) {
  const data = lerISO(iso);
  data.setDate(data.getDate() + quantidade);
  return paraISO(data);
}

// Quantos dias existem entre duas datas (positivo se "ate" for depois de "de").
function diferencaDias(deISO, ateISO) {
  const umDiaEmMs = 24 * 60 * 60 * 1000;
  return Math.round((lerISO(ateISO) - lerISO(deISO)) / umDiaEmMs);
}

// "2026-11-21" -> "21/11/2026"
function formatarData(iso) {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// Aceita "2026-11-21" ou "21/11/2026" (o Excel costuma gravar assim) e devolve
// "AAAA-MM-DD". Se não der para entender a data, devolve "" (vazio).
function normalizarData(texto) {
  const t = String(texto ?? "").trim();
  let iso = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    iso = t;
  } else {
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // Confere se a data existe de verdade (ex.: 31/02 não existe).
  return iso && paraISO(lerISO(iso)) === iso ? iso : "";
}


/* ==================================================================
   4. ARMAZENAMENTO (guardar e carregar no localStorage)
   ================================================================== */

function dadosVazios() {
  return { funcionarios: [], oficios: [], ultimoBackup: null, modoTeste: false };
}

// Lê os dados guardados. Na primeira vez (nada guardado) cria dados fictícios.
function carregarDados() {
  try {
    const texto = localStorage.getItem(CHAVE_STORAGE);
    if (texto) {
      // { ...a, ...b } junta dois objetos; garante que campos novos existam.
      return { ...dadosVazios(), ...JSON.parse(texto) };
    }
  } catch (erro) {
    console.error("Não foi possível ler os dados guardados:", erro);
  }
  const novo = dadosVazios();
  gerarExemplos(novo);
  novo.modoTeste = true;
  return novo;
}

// Guarda tudo. Chamamos esta função sempre que algo muda.
function salvarDados() {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(dados));
  } catch (erro) {
    alert("Não foi possível guardar os dados. O navegador pode estar bloqueando o armazenamento (aba anônima?).");
  }
}


/* ==================================================================
   5. DADOS FICTÍCIOS (para testar sem usar informação de ninguém)
   As datas são calculadas a partir de HOJE, então o painel sempre
   mostra exemplos de "atrasado", "vence em breve" e "aguardando".
   ================================================================== */

function gerarExemplos(alvo) {
  const h = hoje();

  alvo.funcionarios = [
    { id: novoId(), nome: "Ana Exemplo", setor: "Recepção", cargo: "Recepcionista", contato: "(00) 0000-0001", obs: "Atende o telefone e encaminha as ligações." },
    { id: novoId(), nome: "Bruno Teste", setor: "Compras", cargo: "Auxiliar de compras", contato: "(00) 0000-0002", obs: "Recebe os pedidos dos setores." },
    { id: novoId(), nome: "Carla Modelo", setor: "Administrativo", cargo: "Auxiliar administrativo", contato: "(00) 0000-0003", obs: "Apoio administrativo e suporte aos setores." },
    { id: novoId(), nome: "Diego Amostra", setor: "Cadastro Único", cargo: "Técnico de cadastro", contato: "(00) 0000-0004", obs: "" },
    { id: novoId(), nome: "Elisa Demonstração", setor: "Recursos Humanos", cargo: "Assistente de RH", contato: "(00) 0000-0005", obs: "Controle de ponto e dados funcionais." },
    { id: novoId(), nome: "Fábio Fictício", setor: "Proteção Social", cargo: "Coordenador", contato: "(00) 0000-0006", obs: "Acompanha as comunicações sobre PSC." },
  ];

  alvo.oficios = [
    { id: novoId(), numero: "001/2026", data: somarDias(h, -20), tipo: "Recebido", origemDestino: "Órgão Externo A (fictício)", assunto: "Pedido de relatório mensal (exemplo)", setor: "Administrativo", prazo: somarDias(h, -3), status: "Aberto", aguardaExterno: false, orgaoExterno: "", dataEnvioExterno: "" },
    { id: novoId(), numero: "002/2026", data: somarDias(h, -9), tipo: "Enviado", origemDestino: "Tribunal de Justiça (exemplo)", assunto: "Comunicação sobre PSC, caso fictício 01", setor: "Proteção Social", prazo: somarDias(h, 5), status: "Em andamento", aguardaExterno: true, orgaoExterno: "Tribunal de Justiça (exemplo)", dataEnvioExterno: somarDias(h, -9) },
    { id: novoId(), numero: "003/2026", data: somarDias(h, -14), tipo: "Enviado", origemDestino: "Tribunal de Justiça (exemplo)", assunto: "Comunicação sobre PSC, caso fictício 02", setor: "Proteção Social", prazo: somarDias(h, -1), status: "Em andamento", aguardaExterno: true, orgaoExterno: "Tribunal de Justiça (exemplo)", dataEnvioExterno: somarDias(h, -14) },
    { id: novoId(), numero: "004/2026", data: somarDias(h, -4), tipo: "Recebido", origemDestino: "Setor de Compras (exemplo)", assunto: "Pedido de material de escritório", setor: "Compras", prazo: somarDias(h, 2), status: "Aberto", aguardaExterno: false, orgaoExterno: "", dataEnvioExterno: "" },
    { id: novoId(), numero: "005/2026", data: somarDias(h, -2), tipo: "Enviado", origemDestino: "Guarda Municipal (exemplo)", assunto: "Apoio a evento comunitário", setor: "Administrativo", prazo: somarDias(h, 12), status: "Aberto", aguardaExterno: false, orgaoExterno: "", dataEnvioExterno: "" },
    { id: novoId(), numero: "006/2026", data: somarDias(h, -6), tipo: "Recebido", origemDestino: "Chefia (exemplo)", assunto: "Atualização da escala de férias", setor: "Recursos Humanos", prazo: somarDias(h, 6), status: "Em andamento", aguardaExterno: false, orgaoExterno: "", dataEnvioExterno: "" },
    { id: novoId(), numero: "007/2026", data: somarDias(h, -2), tipo: "Enviado", origemDestino: "Órgão Externo B (fictício)", assunto: "Pedido de informação sobre agendamento", setor: "Cadastro Único", prazo: somarDias(h, 20), status: "Aberto", aguardaExterno: true, orgaoExterno: "Órgão Externo B (fictício)", dataEnvioExterno: somarDias(h, -2) },
    { id: novoId(), numero: "008/2026", data: somarDias(h, -25), tipo: "Recebido", origemDestino: "Recepção (exemplo)", assunto: "Atualização da lista de ramais", setor: "Recepção", prazo: somarDias(h, -10), status: "Concluído", aguardaExterno: false, orgaoExterno: "", dataEnvioExterno: "" },
  ];
}


/* ==================================================================
   6. REGRAS DO SISTEMA (o que significa "atrasado", "vence em breve"...)
   ================================================================== */

function estaEncerrado(oficio) {
  return oficio.status === "Concluído";
}

// Diz em que situação de prazo a demanda está.
// Devolve { tipo: "atrasado" | "breve" | "ok" | "sem", dias: número }
function situacaoPrazo(oficio) {
  if (!oficio.prazo || estaEncerrado(oficio)) return { tipo: "sem", dias: 0 };
  const dias = diferencaDias(hoje(), oficio.prazo); // negativo = já passou
  if (dias < 0) return { tipo: "atrasado", dias };
  if (dias <= DIAS_ALERTA) return { tipo: "breve", dias };
  return { tipo: "ok", dias };
}

// Texto legível para a situação do prazo.
function textoPrazo(situacao) {
  if (situacao.tipo === "sem") return "";
  if (situacao.tipo === "atrasado") return `atrasado há ${plural(-situacao.dias, "dia", "dias")}`;
  if (situacao.dias === 0) return "vence hoje";
  if (situacao.dias === 1) return "vence amanhã";
  return `vence em ${plural(situacao.dias, "dia", "dias")}`;
}

// Etiqueta colorida (só aparece se estiver atrasado ou vencendo em breve).
function seloPrazo(oficio) {
  const situacao = situacaoPrazo(oficio);
  if (situacao.tipo === "atrasado") return `<span class="selo selo-atraso">${textoPrazo(situacao)}</span>`;
  if (situacao.tipo === "breve") return `<span class="selo selo-breve">${textoPrazo(situacao)}</span>`;
  return "";
}

// Regra de ordenação da tabela: abertos primeiro; dentro deles, prazo mais
// próximo primeiro; sem prazo vai para o fim.
function ordenarOficios(a, b) {
  const encerradoA = estaEncerrado(a) ? 1 : 0;
  const encerradoB = estaEncerrado(b) ? 1 : 0;
  if (encerradoA !== encerradoB) return encerradoA - encerradoB;
  const prazoA = a.prazo || "9999-12-31";
  const prazoB = b.prazo || "9999-12-31";
  return prazoA.localeCompare(prazoB);
}

// Lista de setores = os da configuração + qualquer setor novo que tenha vindo
// de uma importação de CSV (assim nada se perde).
function listaSetores() {
  const extras = new Set(); // Set = lista sem repetidos
  [...dados.funcionarios, ...dados.oficios].forEach((registro) => {
    if (registro.setor && !SETORES.includes(registro.setor)) extras.add(registro.setor);
  });
  return [...SETORES, ...[...extras].sort()];
}


/* ==================================================================
   7. NAVEGAÇÃO ENTRE AS ABAS
   ================================================================== */

function mostrarAba(nome) {
  // Esconde todas as abas, menos a escolhida.
  document.querySelectorAll(".aba").forEach((secao) => {
    secao.hidden = secao.id !== "aba-" + nome;
  });
  // Destaca o botão do menu correspondente.
  document.querySelectorAll(".menu-item").forEach((botao) => {
    const ativo = botao.dataset.aba === nome; // data-aba="painel" vira botao.dataset.aba
    botao.classList.toggle("ativo", ativo);
    if (ativo) botao.setAttribute("aria-current", "page");
    else botao.removeAttribute("aria-current");
  });
}

// Mostra uma mensagem curta e a esconde sozinha depois de 3 segundos.
function mostrarMensagem(texto) {
  const caixa = el("mensagem");
  caixa.textContent = texto;
  caixa.classList.add("visivel");
  clearTimeout(temporizadorMensagem);                       // cancela o "esconder" anterior
  temporizadorMensagem = setTimeout(() => caixa.classList.remove("visivel"), 3000); // 3000 ms = 3 s
}


/* ==================================================================
   8. DESENHAR AS TELAS ("render")
   Cada função abaixo lê os dados e reescreve o HTML de uma parte da página.
   ================================================================== */

function renderTudo() {
  renderAvisos();
  preencherSelects();
  renderPainel();
  renderFuncionarios();
  renderOficios();
  renderBackup();
}

/* ---------- Listas suspensas (<select>) ---------- */

// Preenche um <select> com opções, mantendo a escolha atual se ainda existir.
function preencherSelect(select, opcoes, textoTodos) {
  const atual = select.value;
  const itens = textoTodos ? [`<option value="">${esc(textoTodos)}</option>`] : [];
  opcoes.forEach((opcao) => itens.push(`<option value="${esc(opcao)}">${esc(opcao)}</option>`));
  select.innerHTML = itens.join("");
  if (opcoes.includes(atual) || (textoTodos && atual === "")) select.value = atual;
}

function preencherSelects() {
  const setores = listaSetores();
  preencherSelect(el("func-setor"), setores);
  preencherSelect(el("of-setor"), setores);
  preencherSelect(el("of-status"), STATUS);
  preencherSelect(el("of-tipo"), TIPOS);
  preencherSelect(el("filtro-func-setor"), setores, "Todos os setores");
  preencherSelect(el("filtro-of-setor"), setores, "Todos os setores");
  preencherSelect(el("filtro-of-status"), STATUS, "Todas as situações");
}

/* ---------- Avisos no topo ---------- */

function renderAvisos() {
  let html = "";

  if (dados.modoTeste) {
    html += `
      <div class="aviso aviso-teste" role="status">
        <p><strong>Modo de teste:</strong> o sistema abriu com dados fictícios de exemplo. Apague-os antes de cadastrar dados reais.</p>
        <button type="button" class="btn btn-secundario btn-pequeno" data-acao="apagar-teste">Apagar dados de teste</button>
      </div>`;
  }

  const temDados = dados.funcionarios.length + dados.oficios.length > 0;
  if (temDados) {
    const dias = dados.ultimoBackup ? diferencaDias(dados.ultimoBackup, hoje()) : null;
    let motivo = "";
    if (dias === null) motivo = "Nenhum backup foi feito ainda.";
    else if (dias > DIAS_BACKUP) motivo = `O último backup foi há ${plural(dias, "dia", "dias")}.`;

    if (motivo) {
      html += `
        <div class="aviso aviso-backup" role="status">
          <p><strong>Faça um backup.</strong> ${motivo}</p>
          <button type="button" class="btn btn-secundario btn-pequeno" data-acao="ir-backup">Ir para Backup</button>
        </div>`;
    }
  }

  el("avisos").innerHTML = html;
}

/* ---------- Painel ---------- */

// Monta um item da lista do painel. Ele é um botão: ao clicar, abre a demanda para editar.
function itemPendencia(oficio, mostrarExterno) {
  const situacao = situacaoPrazo(oficio);
  let linhas = `<span class="pendencia-detalhe">${esc(oficio.setor)}</span>`;

  if (oficio.prazo) {
    const complemento = textoPrazo(situacao) ? `, ${textoPrazo(situacao)}` : "";
    linhas += `<span class="pendencia-detalhe">Prazo ${formatarData(oficio.prazo)}${complemento}</span>`;
  }
  if (mostrarExterno && oficio.aguardaExterno) {
    const espera = oficio.dataEnvioExterno ? diferencaDias(oficio.dataEnvioExterno, hoje()) : null;
    const tempo = espera === null ? "" : `, enviado há ${plural(espera, "dia", "dias")}`;
    linhas += `<span class="pendencia-detalhe">Aguardando ${esc(oficio.orgaoExterno || "órgão externo")}${tempo}</span>`;
  }

  return `
    <li>
      <button type="button" class="pendencia" data-id="${esc(oficio.id)}">
        <span class="pendencia-titulo">Of. ${esc(oficio.numero)}: ${esc(oficio.assunto)}</span>
        ${linhas}
      </button>
    </li>`;
}

// Preenche uma coluna do quadro (lista + contador).
function preencherColuna(idLista, idContagem, oficios, mostrarExterno, textoVazio) {
  el(idContagem).textContent = oficios.length;
  el(idLista).innerHTML = oficios.length
    ? oficios.map((o) => itemPendencia(o, mostrarExterno)).join("")
    : `<li class="vazio">${textoVazio}</li>`;
}

function renderPainel() {
  el("data-hoje").textContent = formatarData(hoje());

  const abertos = dados.oficios.filter((o) => !estaEncerrado(o));

  const atrasados = abertos
    .filter((o) => situacaoPrazo(o).tipo === "atrasado")
    .sort((a, b) => a.prazo.localeCompare(b.prazo));

  const breves = abertos
    .filter((o) => situacaoPrazo(o).tipo === "breve")
    .sort((a, b) => a.prazo.localeCompare(b.prazo));

  // Os que esperam resposta externa há mais tempo aparecem primeiro.
  const externos = abertos
    .filter((o) => o.aguardaExterno)
    .sort((a, b) => (a.dataEnvioExterno || "9999").localeCompare(b.dataEnvioExterno || "9999"));

  preencherColuna("lista-atrasados", "contagem-atrasados", atrasados, false, "Nenhuma demanda atrasada.");
  preencherColuna("lista-breves", "contagem-breves", breves, false, "Nada vence nos próximos 7 dias.");
  preencherColuna("lista-externos", "contagem-externos", externos, true, "Nenhuma resposta externa pendente.");

  el("resumo-painel").textContent =
    `${plural(abertos.length, "demanda em aberto", "demandas em aberto")} de ${dados.oficios.length} registradas.`;
}

/* ---------- Funcionários ---------- */

function funcionariosFiltrados() {
  const busca = semAcento(el("filtro-func-busca").value.trim());
  const setor = el("filtro-func-setor").value;

  return dados.funcionarios
    .filter((f) => {
      const texto = semAcento([f.nome, f.setor, f.cargo, f.obs].join(" "));
      return (!busca || texto.includes(busca)) && (!setor || f.setor === setor);
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function renderFuncionarios() {
  const lista = funcionariosFiltrados();
  el("contagem-funcionarios").textContent = `Mostrando ${lista.length} de ${dados.funcionarios.length}.`;

  el("corpo-funcionarios").innerHTML = lista.length
    ? lista.map((f) => `
        <tr>
          <td><strong>${esc(f.nome)}</strong></td>
          <td>${esc(f.setor)}</td>
          <td>${esc(f.cargo) || "—"}</td>
          <td>${esc(f.contato) || "—"}</td>
          <td>${esc(f.obs) || "—"}</td>
          <td class="acoes">
            <button type="button" class="btn btn-secundario btn-pequeno" data-acao="editar" data-id="${esc(f.id)}">Editar</button>
            <button type="button" class="btn btn-secundario btn-pequeno" data-acao="excluir" data-id="${esc(f.id)}">Excluir</button>
          </td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="sem-registros">Nenhum funcionário encontrado. Use o formulário acima para cadastrar.</td></tr>`;
}

/* ---------- Ofícios e demandas ---------- */

function oficiosFiltrados() {
  const busca = semAcento(el("filtro-of-busca").value.trim());
  const setor = el("filtro-of-setor").value;
  const status = el("filtro-of-status").value;
  const soExterno = el("filtro-of-externo").checked;

  return dados.oficios
    .filter((o) => {
      const texto = semAcento([o.numero, o.assunto, o.origemDestino, o.orgaoExterno].join(" "));
      return (!busca || texto.includes(busca))
        && (!setor || o.setor === setor)
        && (!status || o.status === status)
        && (!soExterno || o.aguardaExterno);
    })
    .sort(ordenarOficios);
}

function renderOficios() {
  const lista = oficiosFiltrados();
  el("contagem-oficios").textContent = `Mostrando ${lista.length} de ${dados.oficios.length}.`;

  el("corpo-oficios").innerHTML = lista.length
    ? lista.map((o) => {
        const externo = o.aguardaExterno && !estaEncerrado(o)
          ? `<span class="selo selo-externo">Aguardando ${esc(o.orgaoExterno || "órgão externo")}</span>`
          : "";
        const botaoConcluir = estaEncerrado(o)
          ? ""
          : `<button type="button" class="btn btn-secundario btn-pequeno" data-acao="concluir" data-id="${esc(o.id)}">Concluir</button>`;
        return `
          <tr class="${estaEncerrado(o) ? "encerrada" : ""}">
            <td><strong>${esc(o.numero)}</strong><span class="sub">${esc(o.tipo)}, ${formatarData(o.data)}</span></td>
            <td><strong>${esc(o.assunto)}</strong><span class="sub">${o.tipo === "Recebido" ? "De" : "Para"}: ${esc(o.origemDestino)}</span></td>
            <td>${esc(o.setor)}</td>
            <td>${formatarData(o.prazo)}${seloPrazo(o)}</td>
            <td>${esc(o.status)}${externo}</td>
            <td class="acoes">
              ${botaoConcluir}
              <button type="button" class="btn btn-secundario btn-pequeno" data-acao="editar" data-id="${esc(o.id)}">Editar</button>
              <button type="button" class="btn btn-secundario btn-pequeno" data-acao="excluir" data-id="${esc(o.id)}">Excluir</button>
            </td>
          </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="sem-registros">Nenhuma demanda encontrada. Use o formulário acima para registrar.</td></tr>`;
}

/* ---------- Backup ---------- */

function renderBackup() {
  let texto;
  if (!dados.ultimoBackup) {
    texto = "Nenhum backup foi feito ainda.";
  } else {
    const dias = diferencaDias(dados.ultimoBackup, hoje());
    texto = `Último backup: ${formatarData(dados.ultimoBackup)} (${dias === 0 ? "hoje" : "há " + plural(dias, "dia", "dias")}).`;
  }
  el("texto-backup").textContent = texto;
  el("resumo-backup").textContent =
    `Guardados neste computador: ${dados.funcionarios.length} funcionário(s) e ${dados.oficios.length} ofício(s)/demanda(s).`;
}


/* ==================================================================
   9. FUNCIONÁRIOS: cadastrar, editar, excluir
   ================================================================== */

function limparFormFuncionario() {
  el("form-funcionario").reset();        // esvazia os campos
  el("func-id").value = "";              // sem id = é um cadastro novo
  el("titulo-form-func").textContent = "Novo funcionário";
  el("btn-salvar-func").textContent = "Salvar funcionário";
  el("btn-cancelar-func").hidden = true;
}

function salvarFuncionario(evento) {
  evento.preventDefault(); // impede o navegador de recarregar a página ao enviar o formulário

  const id = el("func-id").value;
  const registro = {
    id: id || novoId(),
    nome: el("func-nome").value.trim(),
    setor: el("func-setor").value,
    cargo: el("func-cargo").value.trim(),
    contato: el("func-contato").value.trim(),
    obs: el("func-obs").value.trim(),
  };

  if (id) {
    // Edição: troca o registro antigo pelo novo, na mesma posição.
    const posicao = dados.funcionarios.findIndex((f) => f.id === id);
    dados.funcionarios[posicao] = registro;
  } else {
    dados.funcionarios.push(registro);
  }

  salvarDados();
  limparFormFuncionario();
  renderTudo();
  mostrarMensagem(id ? "Funcionário atualizado." : "Funcionário cadastrado.");
}

function editarFuncionario(id) {
  const f = dados.funcionarios.find((item) => item.id === id);
  if (!f) return;
  el("func-id").value = f.id;
  el("func-nome").value = f.nome;
  el("func-setor").value = f.setor;
  el("func-cargo").value = f.cargo;
  el("func-contato").value = f.contato;
  el("func-obs").value = f.obs;
  el("titulo-form-func").textContent = "Editar funcionário";
  el("btn-salvar-func").textContent = "Salvar alterações";
  el("btn-cancelar-func").hidden = false;
  el("form-funcionario").scrollIntoView();
  el("func-nome").focus();
}

function excluirFuncionario(id) {
  const f = dados.funcionarios.find((item) => item.id === id);
  if (!f || !confirm(`Excluir ${f.nome}? Esta ação não pode ser desfeita.`)) return;
  dados.funcionarios = dados.funcionarios.filter((item) => item.id !== id); // mantém todos, menos este
  salvarDados();
  renderTudo();
  mostrarMensagem("Funcionário excluído.");
}


/* ==================================================================
   10. OFÍCIOS E DEMANDAS: cadastrar, editar, concluir, excluir
   ================================================================== */

function limparFormOficio() {
  el("form-oficio").reset();
  el("of-id").value = "";
  el("of-data").value = hoje();          // sugere a data de hoje
  el("campos-externos").hidden = true;   // esconde órgão externo / data de envio
  el("titulo-form-oficio").textContent = "Nova demanda";
  el("btn-salvar-oficio").textContent = "Salvar demanda";
  el("btn-cancelar-oficio").hidden = true;
}

function salvarOficio(evento) {
  evento.preventDefault();

  const id = el("of-id").value;
  const aguarda = el("of-externo").checked;

  const registro = {
    id: id || novoId(),
    numero: el("of-numero").value.trim(),
    data: el("of-data").value,
    tipo: el("of-tipo").value,
    origemDestino: el("of-origem").value.trim(),
    assunto: el("of-assunto").value.trim(),
    setor: el("of-setor").value,
    prazo: el("of-prazo").value,
    status: el("of-status").value,
    aguardaExterno: aguarda,
    orgaoExterno: aguarda ? el("of-orgao").value.trim() : "",
    dataEnvioExterno: aguarda ? el("of-envio").value : "",
  };

  // Validações simples (o navegador já cuida dos campos "required").
  if (registro.prazo && registro.prazo < registro.data) {
    alert("O prazo não pode ser anterior à data do ofício.");
    return;
  }
  if (aguarda && (!registro.orgaoExterno || !registro.dataEnvioExterno)) {
    alert("Informe o órgão externo e a data de envio.");
    return;
  }

  if (id) {
    const posicao = dados.oficios.findIndex((o) => o.id === id);
    dados.oficios[posicao] = registro;
  } else {
    dados.oficios.push(registro);
  }

  salvarDados();
  limparFormOficio();
  renderTudo();
  mostrarMensagem(id ? "Demanda atualizada." : "Demanda registrada.");
}

function editarOficio(id) {
  const o = dados.oficios.find((item) => item.id === id);
  if (!o) return;
  el("of-id").value = o.id;
  el("of-numero").value = o.numero;
  el("of-data").value = o.data;
  el("of-tipo").value = o.tipo;
  el("of-origem").value = o.origemDestino;
  el("of-assunto").value = o.assunto;
  el("of-setor").value = o.setor;
  el("of-prazo").value = o.prazo;
  el("of-status").value = o.status;
  el("of-externo").checked = o.aguardaExterno;
  el("campos-externos").hidden = !o.aguardaExterno;
  el("of-orgao").value = o.orgaoExterno;
  el("of-envio").value = o.dataEnvioExterno;
  el("titulo-form-oficio").textContent = "Editar demanda";
  el("btn-salvar-oficio").textContent = "Salvar alterações";
  el("btn-cancelar-oficio").hidden = false;
  el("form-oficio").scrollIntoView();
  el("of-numero").focus();
}

function concluirOficio(id) {
  const o = dados.oficios.find((item) => item.id === id);
  if (!o) return;
  o.status = "Concluído";
  salvarDados();
  renderTudo();
  mostrarMensagem(`Ofício ${o.numero} concluído.`);
}

function excluirOficio(id) {
  const o = dados.oficios.find((item) => item.id === id);
  if (!o || !confirm(`Excluir o ofício ${o.numero}? Esta ação não pode ser desfeita.`)) return;
  dados.oficios = dados.oficios.filter((item) => item.id !== id);
  salvarDados();
  renderTudo();
  mostrarMensagem("Demanda excluída.");
}


/* ==================================================================
   11. BACKUP: exportar e importar CSV
   CSV = arquivo de texto em que cada linha é um registro e as colunas
   são separadas por ";" (o Excel em português abre direto).
   ================================================================== */

/* ---------- Exportar ---------- */

// Converte um valor do sistema para o texto que vai no CSV.
function valorParaCSV(valor, tipo) {
  if (tipo === "data") return valor ? formatarData(valor) : "";
  if (tipo === "bool") return valor ? "sim" : "não";
  return valor ?? "";
}

// Se o texto tiver ; aspas ou quebra de linha, ele precisa ficar entre aspas.
function celulaCSV(valor) {
  const texto = String(valor);
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function montarCSV(tabela) {
  const campos = CAMPOS[tabela];
  const linhas = [campos.map((c) => c.titulo)]; // primeira linha = cabeçalho
  dados[tabela].forEach((registro) => {
    linhas.push(campos.map((c) => valorParaCSV(registro[c.chave], c.tipo)));
  });
  return linhas.map((linha) => linha.map(celulaCSV).join(";")).join("\r\n");
}

// Faz o navegador baixar um arquivo de texto. O "\uFEFF" no começo avisa ao
// Excel que o arquivo é UTF-8, para os acentos não virarem símbolos estranhos.
function baixarArquivo(nome, conteudo) {
  const blob = new Blob(["\uFEFF" + conteudo], { type: "text/csv;charset=utf-8" });
  const endereco = URL.createObjectURL(blob);   // endereço temporário do arquivo
  const link = document.createElement("a");     // cria um link invisível...
  link.href = endereco;
  link.download = nome;                         // ...que baixa em vez de abrir...
  document.body.appendChild(link);
  link.click();                                 // ...e clica nele por nós
  link.remove();
  URL.revokeObjectURL(endereco);
}

function fazerBackup() {
  baixarArquivo(`backup_funcionarios_${hoje()}.csv`, montarCSV("funcionarios"));
  // Pequena pausa antes do segundo arquivo, para o navegador não bloquear.
  setTimeout(() => baixarArquivo(`backup_oficios_${hoje()}.csv`, montarCSV("oficios")), 500);

  dados.ultimoBackup = hoje();
  salvarDados();
  renderTudo();
  mostrarMensagem("Backup feito. Guarde os dois arquivos no Google Drive.");
}

/* ---------- Importar ---------- */

// Lê um texto CSV e devolve uma lista de linhas; cada linha é uma lista de células.
// Percorre o texto letra por letra, lembrando se está "dentro de aspas".
function lerCSV(texto) {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0];
  const qtdPontoVirgula = (primeiraLinha.match(/;/g) || []).length;
  const qtdVirgula = (primeiraLinha.match(/,/g) || []).length;
  const separador = qtdPontoVirgula >= qtdVirgula ? ";" : ",";

  const linhas = [];
  let linha = [];
  let celula = "";
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const letra = texto[i];

    if (dentroDeAspas) {
      if (letra === '"') {
        if (texto[i + 1] === '"') { celula += '"'; i++; }  // "" dentro de aspas = uma aspa
        else dentroDeAspas = false;                         // fecha as aspas
      } else {
        celula += letra;
      }
    } else if (letra === '"') {
      dentroDeAspas = true;
    } else if (letra === separador) {
      linha.push(celula);
      celula = "";
    } else if (letra === "\n" || letra === "\r") {
      if (letra === "\r" && texto[i + 1] === "\n") i++;     // trata \r\n como uma quebra só
      linha.push(celula);
      linhas.push(linha);
      celula = "";
      linha = [];
    } else {
      celula += letra;
    }
  }
  if (celula !== "" || linha.length) { linha.push(celula); linhas.push(linha); }

  // Descarta linhas totalmente vazias.
  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

// Procura "valor" dentro de "opcoes" ignorando maiúsculas e acentos.
// Devolve a opção oficial ou, se não achar, o valor padrão.
function casarOpcao(valor, opcoes, padrao) {
  const achada = opcoes.find((o) => semAcento(o) === semAcento(valor));
  return achada || padrao;
}

// Identifica registros repetidos (para não duplicar numa importação repetida).
function chaveDuplicidade(tabela, registro) {
  return tabela === "funcionarios"
    ? semAcento(registro.nome) + "|" + semAcento(registro.setor)
    : semAcento(registro.numero) + "|" + registro.data;
}

// "async" permite usar "await": esperar a leitura do arquivo terminar.
async function importarCSV(tabela, arquivo) {
  const texto = (await arquivo.text()).replace(/^\uFEFF/, ""); // tira a marca UTF-8 do começo
  const linhas = lerCSV(texto);

  if (linhas.length < 2) {
    alert("O arquivo está vazio ou não tem linhas de dados.");
    return;
  }

  const campos = CAMPOS[tabela];
  const cabecalho = linhas[0].map((c) => c.trim().toLowerCase());

  // Em que coluna do arquivo está cada campo? (-1 = não existe no arquivo)
  const posicoes = campos.map((c) => cabecalho.indexOf(c.titulo));

  const faltando = campos
    .filter((c, i) => OBRIGATORIOS[tabela].includes(c.chave) && posicoes[i] === -1)
    .map((c) => c.titulo);
  if (faltando.length) {
    alert(`Faltam colunas obrigatórias no arquivo: ${faltando.join(", ")}.\nConfira o cabeçalho (primeira linha).`);
    return;
  }

  const setoresConhecidos = listaSetores();
  const jaExistem = new Set(dados[tabela].map((r) => chaveDuplicidade(tabela, r)));
  const novos = [];
  let repetidos = 0;
  let comProblema = 0;

  linhas.slice(1).forEach((linha) => {
    const registro = { id: novoId() };

    campos.forEach((campo, i) => {
      const bruto = posicoes[i] >= 0 ? (linha[posicoes[i]] ?? "").trim() : "";
      if (campo.tipo === "data") registro[campo.chave] = normalizarData(bruto);
      else if (campo.tipo === "bool") registro[campo.chave] = /^(sim|s|true|1|x)$/i.test(bruto);
      else registro[campo.chave] = bruto;
    });

    // Ajustes e valores padrão.
    if (tabela === "funcionarios") {
      registro.setor = casarOpcao(registro.setor, setoresConhecidos, registro.setor || SETORES[0]);
    } else {
      registro.tipo = casarOpcao(registro.tipo, TIPOS, "Recebido");
      registro.status = casarOpcao(registro.status, STATUS, "Aberto");
      registro.setor = casarOpcao(registro.setor, setoresConhecidos, registro.setor || SETORES[0]);
      if (!registro.aguardaExterno) { registro.orgaoExterno = ""; registro.dataEnvioExterno = ""; }
    }

    // Confere os campos obrigatórios (linha incompleta é descartada).
    const incompleto = OBRIGATORIOS[tabela].some((chave) => !registro[chave]);
    if (incompleto) { comProblema++; return; }

    const chave = chaveDuplicidade(tabela, registro);
    if (jaExistem.has(chave)) { repetidos++; return; }

    jaExistem.add(chave);
    novos.push(registro);
  });

  if (novos.length === 0) {
    alert(`Nada para importar.\nJá existiam: ${repetidos}. Linhas com problema (campo obrigatório vazio ou data inválida): ${comProblema}.`);
    return;
  }

  const confirmou = confirm(
    `Importar ${novos.length} registro(s) de ${NOMES_TABELAS[tabela]}?\n` +
    `Eles serão ADICIONADOS aos que já existem.\n` +
    `Ignorados por já existirem: ${repetidos}. Linhas com problema: ${comProblema}.`
  );
  if (!confirmou) return;

  dados[tabela].push(...novos); // "..." espalha a lista dentro do push
  salvarDados();
  renderTudo();
  mostrarMensagem(`${novos.length} registro(s) importado(s).`);
}


/* ==================================================================
   12. AÇÕES PERIGOSAS (apagar tudo, carregar exemplos)
   ================================================================== */

function apagarTudo(pedirConfirmacao = true) {
  if (pedirConfirmacao && !confirm("Apagar TODOS os dados do sistema? Faça um backup antes. Esta ação não pode ser desfeita.")) return;
  dados = dadosVazios();
  salvarDados();
  limparFormFuncionario();
  limparFormOficio();
  renderTudo();
  mostrarMensagem("Dados apagados. O sistema está vazio.");
}

function carregarExemplos() {
  if (!confirm("Isto SUBSTITUI os dados atuais por dados fictícios de exemplo. Continuar?")) return;
  dados = dadosVazios();
  gerarExemplos(dados);
  dados.modoTeste = true;
  salvarDados();
  limparFormFuncionario();
  limparFormOficio();
  renderTudo();
  mostrarMensagem("Dados fictícios carregados.");
}


/* ==================================================================
   13. INÍCIO: liga cada botão e campo à sua função
   ================================================================== */

function iniciar() {
  dados = carregarDados();
  salvarDados(); // na primeira abertura, já guarda os exemplos

  // Menu lateral
  document.querySelectorAll(".menu-item").forEach((botao) => {
    botao.addEventListener("click", () => mostrarAba(botao.dataset.aba));
  });

  // Formulários
  el("form-funcionario").addEventListener("submit", salvarFuncionario);
  el("form-oficio").addEventListener("submit", salvarOficio);
  el("btn-cancelar-func").addEventListener("click", limparFormFuncionario);
  el("btn-cancelar-oficio").addEventListener("click", limparFormOficio);

  // Caixa "aguarda resposta externa": mostra ou esconde os campos extras.
  el("of-externo").addEventListener("change", () => {
    const marcada = el("of-externo").checked;
    el("campos-externos").hidden = !marcada;
    if (marcada && !el("of-envio").value) el("of-envio").value = hoje();
  });

  // Filtros: refazem a tabela a cada letra digitada ou opção escolhida.
  ["filtro-func-busca", "filtro-func-setor"].forEach((id) => {
    el(id).addEventListener("input", renderFuncionarios);
  });
  ["filtro-of-busca", "filtro-of-setor", "filtro-of-status", "filtro-of-externo"].forEach((id) => {
    el(id).addEventListener("input", renderOficios);
  });

  // "Delegação de eventos": em vez de ligar um clique em cada botão (que são
  // recriados toda hora), ligamos UM clique na tabela e descobrimos qual botão
  // foi apertado com e.target.closest(...).
  el("corpo-funcionarios").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-acao]");
    if (!botao) return;
    if (botao.dataset.acao === "editar") editarFuncionario(botao.dataset.id);
    if (botao.dataset.acao === "excluir") excluirFuncionario(botao.dataset.id);
  });

  el("corpo-oficios").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-acao]");
    if (!botao) return;
    if (botao.dataset.acao === "editar") editarOficio(botao.dataset.id);
    if (botao.dataset.acao === "concluir") concluirOficio(botao.dataset.id);
    if (botao.dataset.acao === "excluir") excluirOficio(botao.dataset.id);
  });

  // Clicar numa pendência do painel abre a demanda para edição.
  el("aba-painel").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-id]");
    if (!botao) return;
    mostrarAba("oficios");
    editarOficio(botao.dataset.id);
  });

  // Botões dos avisos.
  el("avisos").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-acao]");
    if (!botao) return;
    if (botao.dataset.acao === "ir-backup") mostrarAba("backup");
    if (botao.dataset.acao === "apagar-teste" && confirm("Apagar os dados de teste e começar com o sistema vazio?")) {
      apagarTudo(false);
    }
  });

  // Aba Backup
  el("btn-backup").addEventListener("click", fazerBackup);
  el("btn-exemplos").addEventListener("click", carregarExemplos);
  el("btn-apagar-tudo").addEventListener("click", () => apagarTudo(true));

  ["funcionarios", "oficios"].forEach((tabela) => {
    const campoArquivo = el("importar-" + tabela);
    campoArquivo.addEventListener("change", async () => {
      const arquivo = campoArquivo.files[0];
      if (arquivo) await importarCSV(tabela, arquivo);
      campoArquivo.value = ""; // limpa o campo para poder escolher o mesmo arquivo de novo
    });
  });

  limparFormOficio(); // coloca a data de hoje e esconde campos extras
  renderTudo();
  mostrarAba("painel");
}

// Só começa quando a página terminou de carregar.
document.addEventListener("DOMContentLoaded", iniciar);
