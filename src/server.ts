import Fastify from 'fastify';
import { convertBPMNJsonToXML, convertBpmnXmlToFlowableJson } from './util/convert-formats';
import { IFlowableBpmnJson } from '@supdigest/digest-convert-types';

const fastify = Fastify({ logger: true });

// --- ENDPOINT: XML -> JSON ---
fastify.post('/xml-to-json', async (request, reply) => {
  const { xml } = request.body as { xml: string };
  try {
    const data = await convertBpmnXmlToFlowableJson(xml);
    return data;
  } catch (err) {
    reply.status(400).send({ error: err.message });
  }
});

// --- ENDPOINT: JSON -> XML ---
// Aqui garantimos que o JSON puro receba os namespaces corretos
fastify.post('/json-to-xml', async (request, reply) => {
  const json = request.body as IFlowableBpmnJson

  try {    
    const xml = await convertBPMNJsonToXML(json);
    
    return { xml };
  } catch (err) {
    reply.status(400).send({ error: err.message });
  }
});

// --- ENDPOINT: version ---
fastify.get('/version', async (_request, reply) => {
  try {    
    const packageVersion = require('../package.json').version;
    return { version: packageVersion };
  } catch (err) {
    reply.status(400).send({ error: err.message });
  }
});

fastify.listen({ port: 3111, host: '0.0.0.0' });
