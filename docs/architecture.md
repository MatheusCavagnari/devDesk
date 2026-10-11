# Arquitetura do DevDesk

O DevDesk usa Clean Architecture com dependências apontando para dentro. A interface HTTP conhece casos de uso; os casos de uso dependem de regras de domínio e contratos; a infraestrutura implementa esses contratos.

## Camadas
- **Domain (`src/domain`)**: regras puras de tarefas e validação; sem Express ou filesystem.
- **Application (`src/application`)**: casos de uso e ports, incluindo TaskService, ProjectService e StartTaskRun.
- **Infrastructure (`src/infrastructure`)**: persistência Markdown/JSON, diretórios, providers, PowerShell e processos.
- **Presentation (`src/presentation/http`)**: rotas e middleware HTTP sem regras de negócio.
- **Composition root (`src/app.js`)**: instancia adapters e injeta dependências.
- **Entrypoint (`src/server.js`)**: inicializa e escuta em loopback.

## SOLID
- **SRP**: serviços de aplicação orquestram casos de uso; repositórios persistem; rotas lidam com HTTP; o gerenciador controla processos.
- **OCP**: providers novos entram como adapters sem alterar as rotas.
- **LSP/ISP**: ports pequenos e explícitos para repositórios e providers.
- **DIP**: casos de uso recebem dependências por construtor e não instanciam infraestrutura.
- **Clean Code**: nomes por intenção, erros tipados e composição explícita.

## Fluxos
Criar tarefa: HTTP -> TaskService -> Domain -> TaskRepository port -> MarkdownTaskRepository -> filesystem.
Executar agente: HTTP -> StartTaskRun -> TaskService + ProviderRegistry + RunManager -> adapters CLI/processo.

Os testes simulados não substituem a validação manual dos CLIs reais no Windows.
