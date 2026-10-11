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

A implementação inicial usa um registro de providers em `src/agents/providers.js`, com metadados, plataforma suportada, executável e construção de argumentos do CLI. O processo e o ciclo de vida ficam no backend; um provider novo deve implementar esse contrato sem acoplar a interface ao fornecedor. Ainda falta adicionar detecção de versão/autenticação, timeout, testes de integração e uma forma mais robusta de acompanhar execuções após reiniciar o servidor.

## Fluxo de execução

1. O usuário abre uma tarefa e escolhe o provider.
2. O usuário seleciona o projeto principal e os projetos adicionais.
3. O DevDesk apresenta um resumo dos diretórios que serão disponibilizados e pede confirmação.
4. O backend revalida os caminhos, prepara um prompt estruturado e inicia o CLI com o diretório de trabalho definido.
5. A interface mostra o estado e a saída da execução, permite cancelar e apresenta o resultado.
6. O usuário revisa as alterações no repositório e valida os critérios de aceitação antes de marcar a tarefa como concluída.

Estados usados inicialmente: `running`, `succeeded`, `failed`, `cancelled`. O estado e o log vivem em memória, então execuções não são restauradas após reiniciar o DevDesk. Estados futuros sugeridos: `queued`, `starting` e histórico persistido. O término com código zero não garante que a tarefa foi implementada corretamente.

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
