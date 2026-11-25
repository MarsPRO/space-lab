import { resolveRoute } from '../runtime/routes.js';
import { resolveDocument } from '../runtime/documents.js';
import { engineVersion } from './version.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SpaceLabConfig } from '../index.js';
import { discoverContent } from './content.js';
import { captureExample } from './visual.js';
import { asRecord, isRecord } from '../runtime/data.js';
import { createLocaleRegistry, resolveSiteLocale } from '../i18n/registry.js';
import {
  allowLocalRequest,
  hasJsonContentType,
  readRequestBody,
} from './local-http.js';

const tools = [
  {
    name: 'get_component_api',
    description: 'Read statically extracted component props and controls.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'run_example',
    description:
      'Run an example scenario and optional accessibility/visual checks in local Chrome. Requires playwright in the consumer. Does not update baselines.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        example: { type: 'string' },
        locale: { type: 'string' },
        accessibility: { type: 'boolean' },
        visual: { type: 'boolean' },
      },
      required: ['id', 'example'],
    },
  },
  {
    name: 'list_documents',
    description: 'List project documentation and example pages.',
    inputSchema: { type: 'object', properties: { locale: { type: 'string' } } },
  },
  {
    name: 'read_document',
    description: 'Read a documentation or example source by its page ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, locale: { type: 'string' } },
      required: ['id'],
    },
  },
];
export function mcpMiddleware(root: string, config: SpaceLabConfig) {
  const registry = createLocaleRegistry(config.i18n, config.defaultLocale);
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (!allowLocalRequest(request, response)) return;
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    const protocol = request.headers['mcp-protocol-version'];
    if (protocol && protocol !== '2025-06-18') {
      response.writeHead(400).end();
      return;
    }
    if (!hasJsonContentType(request)) {
      response.writeHead(415).end();
      return;
    }
    let id: unknown = null;
    const reply = (body: unknown) => {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(body));
    };
    try {
      const raw = await readRequestBody(request, response, 1_000_000);
      if (raw === undefined) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32700, message: 'Parse error' },
        });
        return;
      }
      if (
        !isRecord(message) ||
        message.jsonrpc !== '2.0' ||
        typeof message.method !== 'string'
      ) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32600, message: 'Invalid request' },
        });
        return;
      }
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      id = message.id;
      let result: unknown;
      if (message.method === 'initialize')
        result = {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'space-lab', version: engineVersion },
        };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = { tools };
      else if (message.method === 'tools/call') {
        const params = asRecord(message.params);
        const args = asRecord(params.arguments);
        const name = params.name;
        let locale = registry.defaultLocale;
        if (
          name === 'run_example' ||
          name === 'list_documents' ||
          name === 'read_document'
        ) {
          try {
            locale = resolveSiteLocale(args.locale, registry);
          } catch (error) {
            reply({
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: String(error) }],
              },
            });
            return;
          }
        }
        const entries = await discoverContent(root, config);
        if (name === 'get_component_api') {
          const entry = resolveRoute(
            entries,
            typeof args.id === 'string' ? args.id : undefined,
          );
          result = {
            content: [{ type: 'text', text: JSON.stringify(entry?.api ?? []) }],
            isError: !entry,
          };
        } else if (name === 'run_example') {
          try {
            if (typeof args.id !== 'string' || typeof args.example !== 'string')
              throw new Error('Space Lab: unknown example.');
            const checked = await captureExample(
              root,
              config,
              `http://${String(request.headers.host)}`,
              {
                page: args.id,
                locale,
                example: args.example,
                interactions: true,
                accessibility: args.accessibility === true,
                visual: args.visual === true,
              },
            );
            result = {
              content: [{ type: 'text', text: JSON.stringify(checked) }],
              isError: !['passed', 'updated'].includes(checked.status),
            };
          } catch (error) {
            result = {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
            };
          }
        } else if (name === 'list_documents')
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  entries.map((entry): Record<string, unknown> =>
                    Object.fromEntries(
                      Object.entries(
                        resolveDocument(entry, locale, registry),
                      ).filter(
                        ([key]) =>
                          !['search', 'source', 'api', 'versions'].includes(
                            key,
                          ),
                      ),
                    ),
                  ),
                ),
              },
            ],
          };
        else if (name === 'read_document') {
          const route = resolveRoute(
            entries,
            typeof args.id === 'string' ? args.id : undefined,
          );
          const entry = route
            ? resolveDocument(route, locale, registry)
            : undefined;
          result = entry
            ? {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      id: entry.id,
                      file: entry.file,
                      title: entry.title,
                      description: entry.description,
                      status: entry.status,
                      requestedLocale: entry.requestedLocale,
                      resolvedLocale: entry.resolvedLocale,
                      fallback: entry.fallback,
                      source: await readFile(resolve(root, entry.file), 'utf8'),
                      ...('catalog' in entry &&
                      typeof entry.catalog === 'string'
                        ? {
                            messages: JSON.parse(
                              await readFile(
                                resolve(root, entry.catalog),
                                'utf8',
                              ),
                            ) as unknown,
                          }
                        : {}),
                    }),
                  },
                ],
              }
            : {
                isError: true,
                content: [{ type: 'text', text: 'Unknown document ID.' }],
              };
        } else {
          reply({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Unknown tool' },
          });
          return;
        }
      } else {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' },
        });
        return;
      }
      reply({ jsonrpc: '2.0', id, result });
    } catch {
      reply({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Unable to read project documentation',
        },
      });
    }
  };
}
