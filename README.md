# DevDesk — MVP local

Aplicação local com Node.js e interface web para listar projetos dentro de uma pasta raiz e gerenciar tarefas Markdown em cada projeto.

## Requisitos
- Node.js 20 ou superior
- Windows 11 (o seletor nativo de pastas e a execução integrada do Copilot CLI usam PowerShell)

## Iniciar
1. Clone este repositório.
2. Abra um terminal dentro da pasta do projeto.
3. Execute `npm install`.
4. Execute `npm test` para rodar os testes automatizados disponíveis.
5. Execute `npm start`.
6. Abra http://127.0.0.1:3030.
7. Clique em **Escolher pasta…** e selecione a pasta que contém seus projetos.

O DevDesk lista as subpastas diretas dessa pasta. Ao selecionar um projeto e criar uma tarefa, ele cria/atualiza:

```text
projeto/.devdesk/TASKS.md
projeto/.devdesk/tasks/TASK-001.md
```

## Formato das tarefas
Cada tarefa inclui ID, título, descrição, prioridade, status, critérios de aceitação, datas e uma lista de projetos-alvo. Ao criar ou editar uma tarefa, selecione todos os repositórios envolvidos. Use **Copiar prompt IA** para copiar o contexto estruturado ou **Executar Copilot** para iniciar o GitHub Copilot CLI, acompanhar a saída e solicitar cancelamento.

## Executar com IA

1. Instale e autentique o agente que pretende usar: [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/copilot-cli/about-github-copilot-cli) (`copilot`) ou [OpenAI Codex CLI](https://developers.openai.com/codex/cli) (`codex`).
2. Crie ou edite uma tarefa e marque todos os projetos envolvidos.
3. Escolha o agente no seletor **Agente IA**.
4. Clique no botão de execução e leia a confirmação de permissões antes de continuar.
5. Acompanhe a saída. Ao terminar, revise os diffs e valide os testes manualmente.

## Segurança e escopo do MVP
- O servidor escuta apenas em `127.0.0.1`.
- A raiz de projetos precisa ser configurada explicitamente na interface.
- O servidor só permite operações em projetos que sejam subpastas diretas da raiz configurada.
- O DevDesk inicia o agente apenas após confirmação explícita. O Copilot CLI recebe permissões `write` e `shell`; o Codex CLI usa `workspace-write` e recebe os diretórios selecionados como áreas adicionais. As permissões reais dependem do CLI instalado e isso não substitui uma sandbox isolada. Execute apenas em projetos confiáveis e revise os diffs.
- Faça backup dos projetos importantes e use apenas em pastas nas quais você confia.
