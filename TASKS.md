# DevDesk — Roadmap de tarefas

Este documento registra o que falta para evoluir o MVP atual. Os status são conservadores: **Pendente** significa que a implementação ainda precisa ser feita e validada; não consideramos algo concluído apenas porque existe código inicial.

## Arquitetura atual

O projeto foi organizado como monólito modular em Domain, Application, Infrastructure e Presentation. `src/app.js` é o composition root; `src/server.js` é um entrypoint mínimo. Consulte `docs/architecture.md`.

## Estado atual

- [x] Estrutura inicial Node.js + Express.
- [x] Interface web inicial para listar projetos e gerenciar tarefas.
- [x] Gravação das tarefas em Markdown dentro de cada projeto.
- [x] Índice `.devdesk/TASKS.md` gerado a partir dos arquivos de tarefa.
- [ ] Instalar dependências e executar o projeto localmente.
- [ ] Completar validação manual no Windows e testes dos CLIs reais.
- [ ] Validar a persistência de configuração, segurança e tratamento de erros.
- [ ] Testar manualmente a execução dos agentes de IA no Windows.
- [ ] Validar tarefas multi-projeto de ponta a ponta.

## Prioridade P0 — Validar e corrigir o MVP

- [ ] **TASK-001 — Executar e validar o projeto localmente.** Instalar dependências, iniciar o servidor e testar o fluxo principal em Windows.
- [x] **TASK-002 — Adicionar testes de integração HTTP para tarefas.** A suíte inicia o servidor real em porta temporária e verifica configuração, listagem de projetos, CRUD, geração de Markdown, índice sincronizado, prompt do agente, validação de caminhos e bloqueio de origem externa. Linux passou no CI; Windows ainda está sendo validado.
- [ ] **TASK-003 — Completar robustez e validações de arquivos.** A validação de caminhos e a proteção básica Host/Origin foram adicionadas e exercitadas por testes HTTP; ainda falta revisão de segurança ponta a ponta e tratamento de links simbólicos em arquivos de tarefa individuais.
- [x] **TASK-004 — Persistir a configuração da pasta raiz.** A pasta selecionada é salva em `~/.devdesk/config.json` e recarregada ao iniciar; ainda falta testar e adicionar uma opção explícita para remover a pasta.
- [ ] **TASK-005 — Melhorar edição e sincronização das tarefas.** O CRUD/Markdown foi extraído para `src/infrastructure/persistence/markdown-task-repository.js`, as rotas estão em `src/presentation/http/routes/tasks.routes.js`, e testes HTTP cobrem edição, exclusão, índice e preservação de critérios marcados. Ainda falta testar edição externa em Markdown.

## Prioridade P0 — Integração com agentes de IA e múltiplos projetos

**Implementado no código, aguardando validação local:** seleção e persistência de vários projetos por tarefa; providers Copilot/Codex com contrato mínimo validado por testes; seletor de agente; execução, saída, status, cancelamento e histórico persistido. A suíte automatizada passou anteriormente em Linux e Windows; os novos testes HTTP já passaram em Linux no commit `f5de2e8`, enquanto a execução equivalente no Windows ainda está em andamento. Os CLIs reais ainda precisam ser validados manualmente.

- [x] **TASK-017 — Definir e documentar a arquitetura de execução de agentes.** O registro `src/agents/providers.js` usa `src/agents/provider-contract.js` para validar metadados e argumentos de linha de comando. Detecção de autenticação e testes com os CLIs reais ainda faltam.
- [x] **TASK-018 — Permitir selecionar múltiplos projetos em uma tarefa.** A interface permite selecionar vários projetos e os alvos são persistidos no Markdown canônico. A validação ponta a ponta ainda está pendente.
- [ ] **TASK-019 — Robustecer o executor de processos local.** O ciclo de vida foi extraído para `src/infrastructure/process/run-manager.js`, com reserva contra concorrência, timeout configurável, cancelamento da árvore de processos e persistência. Testes unitários simulados foram adicionados; testes de unidade foram adicionados; a CI está verificando os commits recentes e ainda falta validar o comportamento real dos CLIs no Windows.
- [ ] **TASK-020 — Validar os providers CLI.** A implementação inicial consulta a versão dos CLIs no Windows, mas ainda não verifica autenticação e precisa de teste real.
- [x] **TASK-021 — Criar a interface de execução.** Há seletor de provider, seleção de projetos-alvo, confirmação, saída, status e cancelamento; o fluxo ainda precisa ser testado manualmente.
- [x] **TASK-022 — Persistir histórico das execuções (implementação inicial).** O histórico grava provider, projeto/tarefa, horários, resultado, código de saída e trecho limitado da saída em `~/.devdesk/runs.json`; execuções interrompidas pelo reinício são marcadas como `interrupted`. Falta validar concorrência, recuperação e comportamento em Windows.
- [x] **TASK-023 — Preparar o contrato para outros providers.** O registro inclui GitHub Copilot CLI e OpenAI Codex CLI e valida ambos pelo contrato comum em testes. A compatibilidade real dos comandos e permissões ainda precisa ser validada.

- [ ] **TASK-025 — Melhorar o diagnóstico dos agentes.** Mostrar a disponibilidade e versão dos CLIs na interface, distinguir CLI ausente de autenticação pendente e oferecer um diagnóstico acionável. A consulta inicial de versão está implementada, mas precisa ser validada no Windows.

## Prioridade P1 — Usabilidade e confiabilidade

- [ ] **TASK-006 — Melhorar a interface e os estados de carregamento.** Adicionar filtros por status/prioridade, busca, contadores, confirmação de exclusão mais clara e feedback consistente.
- [ ] **TASK-007 — Adicionar documentação de uso e solução de problemas.** Explicar configuração, formato dos arquivos, backup, erros comuns e como contribuir.
- [ ] **TASK-008 — Adicionar logs e diagnóstico local.** Registrar erros úteis sem expor conteúdo desnecessário dos projetos.
- [ ] **TASK-024 — Rever segurança do agente e recuperação de falhas.** O gerenciador marca execuções em andamento como interrompidas após reinício, e tenta encerrar a árvore do processo em cancelamento/timeout. Ainda falta revisar a segurança de todas as rotas e caminhos, confirmar permissões efetivas dos CLIs e validar o encerramento do servidor no Windows.

## Prioridade P2 — Evolução

- [ ] **TASK-013 — Suportar tarefas dependentes e subtarefas.**
- [ ] **TASK-014 — Adicionar histórico de alterações e timestamps confiáveis.**
- [ ] **TASK-015 — Adicionar importação e exportação/backup das tarefas.**
- [ ] **TASK-016 — Preparar empacotamento simples para Windows.** Avaliar inicialização com um comando, atalho ou instalador, mantendo o serviço restrito à máquina local.

## Critérios para considerar a integração inicial pronta

- Uma tarefa pode indicar um projeto principal e zero ou mais projetos adicionais.
- Os projetos-alvo ficam persistidos na tarefa e são revalidados antes de cada execução.
- O Copilot CLI pode ser iniciado de forma programática com um prompt estruturado, sem passar o texto do usuário por interpolação de shell.
- A execução exibe saída, status e erros; é possível cancelar uma execução.
- O agente só recebe acesso aos diretórios selecionados e nenhuma permissão ampla é habilitada silenciosamente.
- O DevDesk não afirma que uma tarefa foi concluída só porque o processo terminou; o resultado precisa ser revisado.
- Há testes para seleção de projetos, construção do comando e validação dos caminhos.

## Convenções

- Atualize este documento quando uma tarefa começar ou terminar.
- Cada tarefa deve ter um arquivo em `.devdesk/tasks/` no projeto ao qual pertence.
- Use os status: `backlog`, `todo`, `in_progress`, `blocked`, `done`.
- Não marque como concluído sem implementação e verificação correspondente.


## Refatoração de arquitetura

- [x] Separar domínio, casos de uso, ports, infraestrutura e rotas HTTP.
- [x] Criar composition root e manter o entrypoint do servidor mínimo.
- [x] Documentar decisões SOLID e Clean Architecture em `docs/architecture.md`.
- [ ] Revisar e expandir testes unitários dos casos de uso e executar a CI após a refatoração.
- [ ] Validar manualmente Copilot CLI e Codex CLI no Windows.
