import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ mode }) => {
  const development = mode === 'development';
  const domain = process.env.PARALLEL_ANKI_DOMAIN;
  const team = process.env.PARALLEL_ANKI_ACCESS_TEAM;
  const audience = process.env.PARALLEL_ANKI_ACCESS_AUD;
  const database = process.env.PARALLEL_ANKI_D1_ID;
  if (!development && (!domain || !team || !audience || !database)) {
    throw new Error('Set the PARALLEL_ANKI_DOMAIN, PARALLEL_ANKI_ACCESS_TEAM, PARALLEL_ANKI_ACCESS_AUD and PARALLEL_ANKI_D1_ID variables.');
  }
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    worker: {
      name: 'parallel-anki',
      entrypoint: './src/worker.js',
      compatibilityDate: '2026-11-23',
      domains: !development && domain ? [domain] : [],
      workersDev: false,
      previewUrls: false,
      assets: { runWorkerFirst: true, notFoundHandling: 'none' },
      env: {
        ASSETS: bindings.assets(),
        DB: bindings.d1({ id: database ?? '00000000-0000-4000-8000-000000000001' }),
        ...(development ? { LOCAL_DEV: bindings.text('yes') } : {
          ACCESS_TEAM: bindings.text(team!),
          ACCESS_AUD: bindings.text(audience!),
          AI: bindings.ai(),
        }),
      },
    },
  };
});
