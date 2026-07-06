#!/usr/bin/env node
'use strict';

/**
 * Apipost 接口创建/更新工具（从 config.json 读配置，不打印 token）
 *
 * 用法:
 *   node scripts/docs-upsert.js --file api.json
 *   cat api.json | node scripts/docs-upsert.js
 *
 * 约定:
 *   GET 参数写 Query；非 GET 参数写 Body form-data。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const HOST = 'https://open.apipost.net';

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) die(`配置文件不存在: ${CONFIG_PATH}`);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const missing = ['api_key', 'project_id'].filter((k) => !String(cfg[k] || '').trim());
  if (missing.length) die(`配置缺少必填字段: ${missing.join(', ')}`);
  return cfg;
}

function api(cfg, urlPath, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const u = new URL(HOST + urlPath);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : JSON.stringify(body);
    const headers = { 'api-token': cfg.api_key };
    if (data) headers['Content-Type'] = 'application/json';
    const req = lib.request(u, { method, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(chunks);
        } catch (e) {
          return reject(new Error(`JSON 解析失败 [${urlPath}]: ${e.message}`));
        }
        if (payload.code !== 0) return reject(new Error(`API 错误 [${urlPath}]: ${payload.msg} (code=${payload.code})`));
        resolve(payload.data || {});
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function readSpec() {
  const argv = process.argv.slice(2);
  const fileIndex = argv.indexOf('--file');
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('用法: node docs-upsert.js --file api.json  或  cat api.json | node docs-upsert.js');
    process.exit(0);
  }
  const raw = fileIndex >= 0 ? fs.readFileSync(argv[fileIndex + 1], 'utf-8') : fs.readFileSync(0, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`接口规格 JSON 解析失败: ${e.message}`);
  }
}

function paramId(seed, i) {
  return `${seed}${String(i).padStart(2, '0')}`.slice(0, 32);
}

function normalizeParam(p, seed, i) {
  const type = p.type || p.field_type || 'string';
  return {
    param_id: p.param_id || paramId(seed, i),
    key: p.key || p.name || '',
    value: p.value == null ? '' : String(p.value),
    description: p.description || '',
    field_type: type,
    is_checked: p.is_checked == null ? 1 : p.is_checked,
    not_null: p.required || p.not_null === 1 ? 1 : -1,
    contentType: p.contentType || '',
    filename: p.filename || '',
    schema: p.schema || { type },
  };
}

function schemaFromParams(params) {
  const properties = {};
  const required = [];
  const orders = [];
  for (const p of params) {
    if (!p.key) continue;
    properties[p.key] = {
      type: (p.schema && p.schema.type) || p.field_type || 'string',
      description: p.description || '',
    };
    orders.push(p.key);
    if (p.not_null === 1) required.push(p.key);
  }
  return { type: 'object', properties, APIPOST_ORDERS: orders, required };
}

function baseRequest(authType) {
  return {
    auth: { type: authType || 'noauth' },
    body: { mode: 'none', parameter: [], raw: '', raw_parameter: [], raw_schema: { type: 'object' }, binary: null },
    header: { parameter: [] },
    query: { query_add_equal: 1, parameter: [] },
    cookie: { cookie_encode: 1, parameter: [] },
    restful: { parameter: [] },
    pre_tasks: [],
    post_tasks: [],
  };
}

function buildApiPayload(cfg, spec, parentId, existing) {
  const method = String(spec.method || '').toUpperCase();
  if (!method || !spec.url || !spec.name) die('接口规格必须包含 name/method/url');

  const seed = String(existing && existing.target_id || `${method}${spec.url}`.replace(/[^a-z0-9]/gi, '').toLowerCase()).slice(0, 20);
  const requestParams = (spec.requestParams || spec.params || []).map((p, i) => normalizeParam(p, seed, i));
  const responseParams = (spec.responseParams || []).map((p, i) => normalizeParam(p, `${seed}r`, i));
  const request = baseRequest(spec.auth || 'noauth');

  if (method === 'GET') {
    request.query.parameter = requestParams;
  } else {
    request.body.mode = 'form-data';
    request.body.parameter = requestParams;
  }

  const responseExample = spec.responseExample || {};
  const responseRaw = Object.keys(responseExample).length ? JSON.stringify(responseExample) : '';

  return {
    ...(existing || {}),
    project_id: cfg.project_id,
    target_type: 'api',
    parent_id: parentId || '0',
    name: spec.name,
    method,
    url: spec.url,
    protocol: spec.protocol || 'http/1.1',
    mark_id: spec.mark_id || (existing && existing.mark_id) || '1',
    description: spec.description || '',
    request,
    response: {
      example: [{
        example_id: (existing && existing.response && existing.response.example && existing.response.example[0] && existing.response.example[0].example_id) || paramId(`${seed}e`, 0),
        raw: responseRaw,
        raw_parameter: responseParams,
        headers: [],
        expect: {
          name: '成功',
          is_default: 1,
          code: String(spec.statusCode || 200),
          content_type: 'json',
          verify_type: 'schema',
          mock: '',
          schema: schemaFromParams(responseParams),
          sleep: 0,
        },
      }],
      is_check_result: 1,
    },
    tags: spec.tags || [],
  };
}

async function findOrCreateFolder(cfg, items, folderName) {
  if (!folderName) return '0';
  let parentId = '0';
  for (const name of String(folderName).split('/').map((s) => s.trim()).filter(Boolean)) {
    const folder = items.find((i) => i.target_type === 'folder' && i.name === name && String(i.parent_id || '0') === parentId);
    if (folder) {
      parentId = folder.target_id;
      continue;
    }
    const created = await api(cfg, '/open/apis/create', {
      project_id: cfg.project_id,
      target_type: 'folder',
      name,
      parent_id: parentId,
    });
    items.push({ target_id: created.target_id, target_type: 'folder', name, parent_id: parentId });
    parentId = created.target_id;
  }
  return parentId;
}

async function main() {
  const cfg = loadConfig();
  const spec = readSpec();
  const listData = await api(cfg, `/open/apis/list?project_id=${cfg.project_id}`, null, 'GET');
  const items = listData.list || [];
  const parentId = spec.parent_id || await findOrCreateFolder(cfg, items, spec.folder);
  const existingBrief = items.find((i) => i.target_type === 'api' && String(i.method).toUpperCase() === String(spec.method).toUpperCase() && i.url === spec.url);

  let existing = null;
  if (existingBrief) {
    const details = await api(cfg, '/open/apis/details', { project_id: cfg.project_id, target_ids: [existingBrief.target_id] });
    existing = (details.list || [])[0] || null;
  }

  const payload = buildApiPayload(cfg, spec, parentId, existing);
  if (existing) {
    payload.target_id = existing.target_id;
    payload.is_force = 1;
  }

  const result = await api(cfg, existing ? '/open/apis/update' : '/open/apis/create', payload);
  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    target_id: result.target_id || payload.target_id,
    name: payload.name,
    method: payload.method,
    url: payload.url,
    folder: spec.folder || parentId,
  }, null, 2));
}

main().catch((e) => die(e && e.message || String(e)));
