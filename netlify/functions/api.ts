import express from 'express';
import serverless from 'serverless-http';
import { apiRouter } from '../../src/server/apiRouter.ts';

const app = express();

app.use(express.json({ limit: '30mb' }));

// Mount router for direct function calls and redirected paths
app.use('/.netlify/functions/api', apiRouter);
app.use('/api', apiRouter);
app.use('/', apiRouter);

export const handler = serverless(app);
