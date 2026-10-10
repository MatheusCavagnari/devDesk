# DevDesk — Roadmap de tarefas

Este documento registra o que falta para evoluir o MVP atual. Os status são conservadores: **Pendente** significa que a implementação ainda precisa ser feita e validada; não consideramos algo concluído apenas porque existe código inicial.

## Estado atual

- [x] Estrutura inicial Node.js + Express.
- [x] Interface web inicial para listar projetos e gerenciar tarefas.
- [x] Gravação das tarefas em Markdown dentro de cada projeto.
- [x] Índice `.devdesk/TASKS.md` gerado a partir dos arquivos de tarefa.
- [ ] Instalar dependências e executar o projeto localmente.
- [ ] Fazer testes manuais e automatizados.
- [ ] Revisar segurança, persistência de configuração e tratamento de erros.
- [ ] Implementar execução de tarefas por agentes de IA.
- [ ] Permitir que uma tarefa trabalhe com vários projetos/repositórios.

## Prioridade P0 — Validar e corrigir o MVP

- [ ] **TASK-001 — Executar e validar o projeto localmente.** Instalar dependências, iniciar o servidor e testar o fluxo principal em Windows.
- [ ] **TASK-002 — Criar testes automatizados.** Cobrir configuração da raiz, CRUD de tarefas, validações, geração dos arquivos Markdown e sincronização do índice.
- [ ] **TASK-003 — Corrigir robustez e validações de arquivos.** Validar caminhos, IDs, entradas longas e erros de leitura/escrita; garantir que operações nunca escapem da raiz configurada.
- [ ] **TASK-004 — Persistir a configuração da pasta raiz.** Guardar a configuração localmente com tratamento de caminho inexistente e opção para alterar/remover a pasta.
- [ ] **TASK-005 — Melhorar edição e sincronização das tarefas.** Garantir que critérios de aceitação marcados sejam preservados, IDs nunca sejam reutilizados e edições externas em Markdown sejam tratadas de forma previsível.

## Prioridade P0 — Integração com agentes de IA e múltiplos projetos

- [ ] **TASK-017 — Definir e documentar a arquitetura de execução de agentes.** Criar uma interface de provider/adaptador, separar execução de tarefas da gestão de tarefas e documentar ciclo de vida, logs, erros e cancelamento. Referência: `docs/agent-integration.md`.
- [ ] **TASK-018 — Permitir selecionar múltiplos projetos em uma tarefa.** Manter um projeto principal e uma lista de projetos relacionados; persistir os alvos no Markdown sem criar cópias divergentes da mesma tarefa.
- [ ] **TASK-019 — Criar o executor de processos local.** Iniciar ferramentas CLI com argumentos separados (sem concatenar entrada do usuário em comandos shell), diretório de trabalho explícito, captura de saída, status, cancelamento e tratamento de timeout.
- [ ] **TASK-020 — Implementar o provider GitHub Copilot CLI.** Detectar se o CLI está instalado/autenticado, construir um prompt estruturado, conceder acesso apenas aos diretórios selecionados e não habilitar permissões amplas automaticamente.
- [ ] **TASK-021 — Criar a interface de execução.** Adicionar ação “Executar com IA”, escolha do provider, seleção de projetos-alvo, confirmação antes de iniciar e visualização de logs/resultado.
- [ ] **TASK-022 — Persistir histórico das execuções.** Guardar provider, tarefa, projetos-alvo, horários, resultado, código de saída e caminho do log, sem registrar segredos.
- [ ] **TASK-023 — Preparar o contrato para outros providers.** Documentar como adicionar outras CLIs/agentes sem acoplar a interface ao Copilot; adicionar um provider novo somente depois que o contrato estiver testado.

## Prioridade P1 — Usabilidade e confiabilidade

- [ ] **TASK-006 — Melhorar a interface e os estados de carregamento.** Adicionar filtros por status/prioridade, busca, contadores, confirmação de exclusão mais clara e feedback consistente.
- [ ] **TASK-007 — Adicionar documentação de uso e solução de problemas.** Explicar configuração, formato dos arquivos, backup, erros comuns e como contribuir.
- [ ] **TASK-008 — Adicionar logs e diagnóstico local.** Registrar erros úteis sem expor conteúdo desnecessário dos projetos.
- [ ] **TASK-024 — Rever segurança do agente e recuperação de falhas.** Validar novamente todos os caminhos selecionados, limitar permissões, não permitir acesso a diretórios não selecionados por configuração do DevDesk, lidar com encerramento do servidor e não executar agentes automaticamente ao abrir uma tarefa.

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
