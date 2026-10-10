# DevDesk — MVP local

Aplicação local com Node.js e interface web para listar projetos dentro de uma pasta raiz e gerenciar tarefas Markdown em cada projeto.

## Requisitos
- Node.js 20 ou superior
- Windows, macOS ou Linux

## Iniciar
1. Clone este repositório.
2. Abra um terminal dentro da pasta do projeto.
3. Execute `npm install`.
4. Execute `npm start`.
5. Abra http://127.0.0.1:3030.
6. Informe o caminho absoluto da pasta que contém seus projetos, por exemplo `C:\\Users\\SeuUsuario\\Documents\\Projetos`.

O DevDesk lista as subpastas diretas dessa pasta. Ao selecionar um projeto e criar uma tarefa, ele cria/atualiza:

```text
projeto/.devdesk/TASKS.md
projeto/.devdesk/tasks/TASK-001.md
```

## Formato das tarefas
Cada tarefa inclui ID, título, descrição, prioridade, status, critérios de aceitação, datas e uma lista de projetos-alvo. Ao criar ou editar uma tarefa, selecione os projetos envolvidos; use **Copiar prompt IA** para preparar um prompt com os caminhos e critérios. A execução automática pelo CLI é uma próxima etapa.

## Segurança e escopo do MVP
- O servidor escuta apenas em `127.0.0.1`.
- A raiz de projetos precisa ser configurada explicitamente na interface.
- O servidor só permite operações em projetos que sejam subpastas diretas da raiz configurada.
- O MVP grava arquivos Markdown; ainda não executa tarefas com Copilot nem edita código-fonte dos projetos.
- Faça backup dos projetos importantes e use apenas em pastas nas quais você confia.
