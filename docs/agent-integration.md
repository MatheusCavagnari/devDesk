# Arquitetura inicial: execução de agentes no DevDesk

## Objetivo

Permitir que uma tarefa criada no DevDesk seja enviada a uma ferramenta de IA instalada localmente, sem acoplar toda a aplicação a um fornecedor. Os primeiros adaptadores no registro são GitHub Copilot CLI e OpenAI Codex CLI. Uma tarefa pode envolver mais de um repositório.

O DevDesk continua sendo um gerenciador local. O agente é um processo externo que pode ler e alterar arquivos; por isso, iniciar a execução deve ser uma ação explícita do usuário.

## Modelo de tarefa multi-projeto

- **Projeto principal:** repositório em que a tarefa foi criada e onde o arquivo Markdown canônico continua armazenado.
- **Projetos-alvo:** lista de outros projetos selecionados para a execução, incluindo o projeto principal.
- **Fonte única da tarefa:** manter um único arquivo canônico em `.devdesk/tasks/TASK-xxx.md`; não gerar cópias editáveis independentes em cada repositório.
- **Persistência:** armazenar os alvos como metadados no Markdown, com compatibilidade para tarefas antigas sem essa propriedade.
- **Validação:** resolver cada projeto pela raiz configurada, confirmar que é uma subpasta direta válida, resolver symlinks e revalidar imediatamente antes de iniciar o agente.

O projeto principal fornece o diretório de trabalho inicial. Os demais projetos selecionados são contexto e diretórios autorizados explicitamente para a execução. O prompt deve listar cada projeto e seu papel; não se deve presumir que o agente saberá como coordená-los sem instruções.

## Contrato de provider

O backend deve depender de uma interface de provider, e não diretamente de comandos específicos do Copilot. O contrato deve cobrir, no mínimo:

- identificação e nome amigável do provider;
- verificação de disponibilidade/instalação;
- preparação e validação da configuração de execução;
- início da execução com prompt, diretório principal, diretórios adicionais e opções aprovadas;
- eventos de saída padrão/erro padrão, início, término e falha;
- cancelamento;
- resultado final com código de saída e referência ao log.

O registro de providers fica em `src/infrastructure/agents/providers.js`; `src/application/ports/agent-provider.js` valida metadados obrigatórios e garante que a construção do comando retorne somente argumentos string. Esse é um contrato mínimo, não ainda um ciclo de vida completo de provider: diagnóstico de autenticação, eventos de execução e cancelamento seguem no backend. O processo e o ciclo de vida ficam em `src/infrastructure/process/run-manager.js`. O ciclo de vida foi extraído para `src/execution/run-manager.js`; a rota HTTP valida a tarefa e delega a execução ao gerenciador. A detecção de versão não verifica autenticação e a execução real ainda precisa ser validada no Windows.

## Fluxo de execução

1. O usuário abre uma tarefa e escolhe o provider.
2. O usuário seleciona o projeto principal e os projetos adicionais.
3. O DevDesk apresenta um resumo dos diretórios que serão disponibilizados e pede confirmação.
4. O backend revalida os caminhos, prepara um prompt estruturado e inicia o CLI com o diretório de trabalho definido.
5. A interface mostra o estado e a saída da execução, permite cancelar e apresenta o resultado.
6. O usuário revisa as alterações no repositório e valida os critérios de aceitação antes de marcar a tarefa como concluída.

Estados de execução incluem `running`, `succeeded`, `failed`, `cancelled` e `interrupted`. O estado e os logs recentes são persistidos em `~/.devdesk/runs.json`; processos não são retomados após reiniciar o DevDesk. O término com código zero não garante que a tarefa foi implementada corretamente.

## Proteção da API local e caminhos

`src/security/local-request-guard.js` valida o cabeçalho Host, bloqueia requisições marcadas pelo navegador como cross-site e rejeita origens não permitidas em operações mutáveis. Corpos enviados à API devem usar `application/json`. Isso reduz riscos de DNS rebinding/CSRF no navegador, mas não é autenticação e não protege contra processos maliciosos já executados na mesma máquina.

`src/security/project-paths.js` resolve projetos como subpastas diretas da raiz configurada e rejeita links simbólicos nas pastas de projeto e nos diretórios `.devdesk`/`tasks`. Essas verificações reduzem escapes acidentais e ataques por links, mas não eliminam condições de corrida no sistema de arquivos nem transformam o CLI em sandbox.

`src/domain/tasks/task-helpers.js` preserva os estados dos critérios quando o texto não muda e mantém uma sequência persistente para novos IDs. Se existiam IDs mais altos que já tinham sido apagados antes da adoção do arquivo de sequência, não há como reconstruir automaticamente esse histórico perdido.
## Histórico persistente e diagnóstico inicial

O DevDesk mantém um histórico local em `~/.devdesk/runs.json`, separado dos repositórios. São mantidas até 100 execuções concluídas, além de qualquer execução ativa, com até 20.000 caracteres finais de saída por execução; a memória e o arquivo de histórico são limitados pela mesma política. O frontend exibe as execuções recentes e permite consultar a saída guardada. A gravação usa arquivo temporário e renomeação para reduzir o risco de arquivo parcialmente escrito.

Ao iniciar, se uma execução estiver marcada como `running`, ela é apresentada como `interrupted`: o DevDesk não consegue recuperar o processo filho depois de reiniciar. O histórico não tenta reiniciar tarefas automaticamente. A interface deve parar de consultar uma execução quando ela chegar a qualquer estado terminal, inclusive `interrupted`.

A rota `GET /api/agents/status` consulta a versão de cada CLI no Windows e a interface informa se o comando foi encontrado. Isso **não verifica autenticação** nem garante que o agente esteja autorizado a executar tarefas; essa confirmação só será possível após validar o fluxo real do CLI.

Os logs podem conter trechos de saída do agente, portanto o arquivo `runs.json` deve ser tratado como dado local potencialmente sensível. Não foram implementadas ainda opções para apagar/exportar o histórico nem rotação configurável.

## Prompt estruturado

Cada execução deve incluir:

- ID e título da tarefa;
- objetivo e contexto;
- critérios de aceitação;
- restrições e instruções de segurança;
- lista explícita de projetos-alvo e seus caminhos;
- qual projeto é o principal e o que se espera de cada repositório;
- instruções para executar testes relevantes e relatar testes não executados;
- formato de resumo final: arquivos alterados, decisões, comandos/testes realizados, limitações e pendências.

A descrição da tarefa é dado não confiável: não pode modificar as políticas de segurança do executor nem acrescentar diretórios autorizados sem uma confirmação separada do usuário.

## Providers iniciais

### GitHub Copilot CLI

- Executável: `copilot`.
- Execução não interativa com prompt estruturado.
- O adaptador habilita ferramentas `write` e `shell`; isso permite alterações autônomas e execução de comandos. O usuário precisa confirmar antes de iniciar.
- Os diretórios selecionados são passados como diretórios adicionais do CLI. Isso não deve ser tratado como sandbox completa.

### OpenAI Codex CLI

- Executável: `codex`.
- Usa `codex exec` com `workspace-write` e define o projeto principal como diretório de trabalho.
- Projetos secundários são passados como diretórios adicionais.
- O modo não interativo não garante que a tarefa esteja correta; é obrigatório revisar diffs e testes.
- A execução real ainda precisa ser validada no Windows, incluindo compatibilidade de argumentos e comportamento da sandbox.

## OpenAI Codex CLI

O registro de providers também inclui o Codex CLI como segunda opção. O adaptador monta uma execução não interativa com `codex exec`, usa `workspace-write` como sandbox, define o projeto principal como diretório de trabalho e passa projetos secundários por `--add-dir`. A execução usa `--ask-for-approval never` para evitar um prompt de aprovação interativo que o DevDesk não conseguiria exibir; portanto, o usuário precisa confirmar conscientemente o início da execução. O sandbox continua sendo a camada de restrição de escrita, mas não substitui revisar as mudanças.

A sintaxe exata e o comportamento do CLI precisam ser validados em uma máquina Windows com o Codex instalado. O código e os testes unitários de construção de argumentos não provam que uma instalação real executará com sucesso.

## GitHub Copilot CLI: primeiro provider

A documentação oficial permite executar prompts de modo programático com `copilot -p`, e oferece opções como `--add-dir` para autorizar diretórios adicionais. O adaptador deve confirmar a versão e as opções disponíveis na instalação local e tratar o CLI ausente ou não autenticado com uma mensagem acionável.

Regras para a primeira versão:

- não habilitar automaticamente `--allow-all`, `--yolo`, `--allow-all-tools` ou permissões equivalentes;
- não construir comandos juntando strings com dados do usuário; passar argumentos separadamente e usar um diretório de trabalho explícito;
- adicionar apenas os diretórios escolhidos à lista de caminhos do CLI; essa lista não é uma sandbox e as verificações de caminho são heurísticas;
- a execução atual pede confirmação explícita e concede `write` e `shell` para permitir implementação autônoma. `shell` pode executar comandos com as permissões do usuário, então a confirmação deve explicar esse risco;
- não registrar tokens, segredos ou conteúdo sensível desnecessário nos logs;
- capturar saída, código de saída, falhas de inicialização e cancelamento;
- mostrar ao usuário que o agente pode modificar arquivos e executar comandos, antes da confirmação.

A CLI pode pedir aprovação interativa para certas ações; a primeira implementação precisa testar como isso se comporta no ambiente local do Windows e evitar uma interface que pareça estar executando quando o processo está apenas aguardando uma confirmação invisível.

## Segurança e confiabilidade

- O servidor continua vinculado a `127.0.0.1`.
- Revalidar os caminhos no servidor; nunca confiar apenas nos caminhos recebidos da interface.
- Não aceitar caminhos arbitrários fornecidos pelo prompt.
- Não permitir execução automática ao abrir uma tarefa, iniciar o DevDesk ou carregar um projeto.
- Guardar histórico e logs fora dos repositórios quando apropriado, com limites de tamanho e retenção.
- Não executar duas instâncias sobre os mesmos repositórios sem uma regra explícita.
- Tratar timeout, encerramento do servidor, processo filho órfão e cancelamento.
- Não marcar tarefa como concluída automaticamente com base apenas no código de saída do CLI.

## Plano incremental

1. **Contrato e modelo:** documentar provider, execução e seleção multi-projeto.
2. **Persistência e UI:** guardar projetos-alvo e permitir seleção de múltiplos projetos.
3. **Executor isolado:** implementar processo filho e eventos de estado, inicialmente com testes/fake provider.
4. **Copilot CLI:** integração inicial disponível no Windows, com confirmação explícita, prompt estruturado, diretórios adicionais, saída, estado e cancelamento. Ainda precisa de testes manuais no Windows e revisão de falhas de processo.
5. **Revisão:** testar tarefa de um projeto e tarefa que altere dois repositórios; revisar diffs e documentação.
6. **Outros providers:** adicionar somente quando o contrato inicial estiver estável.

## Critérios de aceite

- Tarefas antigas continuam carregando sem metadados de projetos-alvo.
- É possível escolher dois ou mais projetos sem criar cópias divergentes da tarefa.
- Diretórios inválidos, fora da raiz ou redirecionados por symlink são rejeitados.
- A execução não ocorre sem confirmação explícita.
- O usuário vê a saída e o resultado real do processo, inclusive erros.
- Um provider de teste pode validar o ciclo de vida sem exigir conta ou consumo de IA.

## Gerenciador de execução extraído

`src/execution/run-manager.js` é responsável pelo ciclo de vida do processo externo, pela persistência do histórico e por cancelamento. `src/server.js` continua responsável pelas rotas HTTP, validação dos projetos e montagem do prompt, mas não deve controlar diretamente os eventos do processo filho.

- A execução é reservada no mapa síncrono antes da primeira operação assíncrona; isso impede que duas requisições simultâneas passem pela verificação de concorrência.
- O timeout padrão é de 30 minutos. Pode ser ajustado com a variável `DEVDESK_RUN_TIMEOUT_MS` (milissegundos).
- Em Windows, o cancelamento/timeout tenta encerrar a árvore de processos com `taskkill /T /F`; se isso falhar, tenta encerrar o processo filho.
- O encerramento é idempotente para evitar gravação dupla quando chegam eventos `error` e `close`.
- Um processo ainda em execução quando o servidor reinicia é registrado como `interrupted`; não é reiniciado automaticamente.
- Os testes unitários usam um processo simulado, sem exigir CLIs ou consumo de IA. Eles cobrem concorrência, timeout, cancelamento e recuperação de histórico.

Esses testes automatizados não substituem a validação manual com os CLIs instalados em Windows. O timeout também não equivale a sandbox: a execução do CLI ainda ocorre com as permissões do usuário.


## Organização das tarefas e arquivos

`src/infrastructure/persistence/markdown-task-repository.js` é responsável por ler e gravar os arquivos Markdown, gerar o índice `.devdesk/TASKS.md`, validar projetos-alvo, alocar IDs via helper de domínio e montar o prompt do agente.

`src/presentation/http/routes/tasks.routes.js` contém as rotas HTTP de listagem, criação, edição, exclusão e obtenção do prompt. `src/server.js` registra o router e mantém a inicialização do servidor, configuração global, seleção da raiz, descoberta de projetos e endpoints de execução/histórico.

`test/http-tasks.integration.test.js` inicia o servidor real numa porta temporária e usa um diretório temporário como home e raiz de projetos. Os testes verificam configuração, CRUD, arquivos Markdown, índice sincronizado, prompt, preservação de critérios marcados, caminhos inválidos e bloqueio de origem externa. A CI deve instalar as dependências antes de executar a suíte.
