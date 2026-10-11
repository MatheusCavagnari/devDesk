import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3030);
const { app, initialize } = createApp({ port: PORT });

try {
  await initialize();
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('DevDesk disponível em http://127.0.0.1:' + PORT);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error('Não foi possível iniciar o DevDesk:', error);
  process.exitCode = 1;
}