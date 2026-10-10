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
- [ ] Integrar fluxo de execução de tarefas com GitHub Copilot no VS Code.

## Prioridade P0 — Validar e corrigir o MVP

- [ ] **TASK-001 — Executar e validar o projeto localmente.** Instalar dependências, iniciar o servidor e testar o fluxo principal em Windows.
- [ ] **TASK-002 — Criar testes automatizados.** Cobrir configuração da raiz, CRUD de tarefas, validações, geração dos arquivos Markdown e sincronização do índice.
- [ ] **TASK-003 — Corrigir robustez e validações de arquivos.** Validar caminhos, IDs, entradas longas e erros de leitura/escrita; garantir que operações nunca escapem da raiz configurada.
- [ ] **TASK-004 — Persistir a configuração da pasta raiz.** Guardar a configuração localmente com tratamento de caminho inexistente e opção para alterar/remover a pasta.
- [ ] **TASK-005 — Melhorar edição e sincronização das tarefas.** Garantir que critérios de aceitação marcados sejam preservados, IDs nunca sejam reutilizados e edições externas em Markdown sejam tratadas de forma previsível.

## Prioridade P1 — Usabilidade

- [ ] **TASK-006 — Melhorar a interface e os estados de carregamento.** Adicionar filtros por status/prioridade, busca, contadores, confirmação de exclusão mais clara e feedback consistente.
- [ ] **TASK-007 — Adicionar documentação de uso e solução de problemas.** Explicar configuração, formato dos arquivos, backup, erros comuns e como contribuir.
- [ ] **TASK-008 — Adicionar logs e diagnóstico local.** Registrar erros úteis sem expor conteúdo desnecessário dos projetos.

## Prioridade P1 — Fluxo com GitHub Copilot / VS Code

- [ ] **TASK-009 — Definir como o Copilot consumirá as tarefas.** Avaliar instruções em Markdown, prompts/copilot instructions e comandos acionados pelo usuário; não presumir que arquivos Markdown executam tarefas sozinhos.
- [ ] **TASK-010 — Preparar um formato de tarefa amigável para agentes.** Incluir contexto, objetivo, escopo, arquivos relevantes, critérios de aceitação, restrições e passos de verificação.
- [ ] **TASK-011 — Criar ação para preparar/copiar o prompt da tarefa.** Permitir abrir a tarefa ou copiar um prompt estruturado para usar no Copilot Chat, sem executar comandos arbitrários automaticamente.
- [ ] **TASK-012 — Integrar com o VS Code de forma segura.** Investigar extensão ou protocolo suportado; exigir confirmação antes de executar ações que alterem código ou rodem comandos.

## Prioridade P2 — Evolução

- [ ] **TASK-013 — Suportar tarefas dependentes e subtarefas.**
- [ ] **TASK-014 — Adicionar histórico de alterações e timestamps confiáveis.**
- [ ] **TASK-015 — Adicionar importação e exportação/backup das tarefas.**
- [ ] **TASK-016 — Preparar empacotamento simples para Windows.** Avaliar inicialização com um comando, atalho ou instalador, mantendo o serviço restrito à máquina local.

## Critérios para considerar o MVP pronto

- A instalação e inicialização funcionam em uma máquina Windows limpa com Node.js compatível.
- É possível configurar uma raiz, selecionar um projeto e criar, editar e excluir tarefas.
- Os arquivos individuais e o índice permanecem consistentes após reiniciar o servidor.
- Caminhos inválidos e entradas malformadas não permitem escrever fora da pasta de projeto.
- Existe cobertura de testes para os fluxos críticos.
- A documentação distingue claramente gerenciamento de tarefas e execução real pelo Copilot.

## Convenções

- Atualize este documento quando uma tarefa começar ou terminar.
- Cada tarefa deve ter um arquivo em `.devdesk/tasks/`.
- Use os status: `backlog`, `todo`, `in_progress`, `blocked`, `done`.
- Não marque como concluído sem implementação e verificação correspondente.
