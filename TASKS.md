# DevDesk — Roadmap de tarefas

Este documento registra o que falta para evoluir o MVP atual. Os status são conservadores: **Pendente** significa que a implementação ainda precisa ser feita e validada; não consideramos algo concluído apenas porque existe código inicial.

## Arquitetura atual

O projeto está sendo organizado como um **monólito modular**, sem microserviços: rotas HTTP, providers CLI, gerenciador de processos, persistência e interface têm responsabilidades separadas. O ciclo de vida das execuções está em `src/execution/run-manager.js`; validação de diretórios, proteção de requisições locais e utilitários de tarefas também foram separados em módulos. A CI verifica os testes em Linux e Windows; a execução real dos CLIs ainda precisa de validação manual.

## Estado atual

- [x] Estrutura inicial Node.js + Express.
- [x] Interface web inicial para listar projetos e gerenciar tarefas.
- [x] Gravação das tarefas em Markdown dentro de cada projeto.
- [x] Índice `.devdesk/TASKS.md` gerado a partir dos arquivos de tarefa.
- [ ] Instalar dependências e executar o projeto localmente.
- [ ] Completar testes de integração HTTP e testes manuais.
- [ ] Validar a persistência de configuração, segurança e tratamento de erros.
- [ ] Testar manualmente a execução dos agentes de IA no Windows.
- [ ] Validar tarefas multi-projeto de ponta a ponta.

## Prioridade P0 — Validar e corrigir o MVP

- [ ] **TASK-001 — Executar e validar o projeto localmente.** Instalar dependências, iniciar o servidor e testar o fluxo principal em Windows.
- [ ] **TASK-002 — Completar testes automatizados.** Já há testes unitários de executor, providers, segurança local, validação de diretórios, critérios e IDs; faltam testes de integração HTTP para configuração, CRUD e sincronização do índice.
- [ ] **TASK-003 — Corrigir robustez e validações de arquivos.** Adicionadas validação de nomes/caminhos de projetos, rejeição de links simbólicos nas pastas controladas pelo DevDesk e proteção básica contra Host/Origin inesperados. Ainda falta revisão de segurança ponta a ponta e testes HTTP.
- [x] **TASK-004 — Persistir a configuração da pasta raiz.** A pasta selecionada é salva em `~/.devdesk/config.json` e recarregada ao iniciar; ainda falta testar e adicionar uma opção explícita para remover a pasta.
- [ ] **TASK-005 — Melhorar edição e sincronização das tarefas.** Critérios marcados são preservados quando o texto não muda, e a geração de IDs usa sequência persistente para não reutilizar IDs excluídos após a adoção do novo mecanismo. Ainda falta testar edição externa em Markdown.

## Prioridade P0 — Integração com agentes de IA e múltiplos projetos

**Implementado no código, aguardando validação local:** seleção e persistência de vários projetos por tarefa; providers Copilot/Codex com contrato mínimo validado por testes; seletor de agente; execução, saída, status, cancelamento e histórico persistido. A suíte automatizada passou no CI para Linux e Windows no commit `fd824198`; os CLIs reais ainda precisam ser validados manualmente.

- [x] **TASK-017 — Definir e documentar a arquitetura de execução de agentes.** O registro `src/agents/providers.js` usa `src/agents/provider-contract.js` para validar metadados e argumentos de linha de comando. Detecção de autenticação e testes com os CLIs reais ainda faltam.
- [x] **TASK-018 — Permitir selecionar múltiplos projetos em uma tarefa.** A interface permite selecionar vários projetos e os alvos são persistidos no Markdown canônico. A validação ponta a ponta ainda está pendente.
- [ ] **TASK-019 — Robustecer o executor de processos local.** O ciclo de vida foi extraído para `src/execution/run-manager.js`, com reserva contra concorrência, timeout configurável, cancelamento da árvore de processos e persistência. Testes unitários simulados foram adicionados; testes de unidade foram adicionados; a CI está verificando os commits recentes e ainda falta validar o comportamento real dos CLIs no Windows.
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
