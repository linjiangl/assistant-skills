#!/usr/bin/env node
'use strict';

/**
 * Apipost 接口删除工具（从 config.json 读配置，不打印 token）
 *
 * 用法:
 *   node scripts/docs-delete.js --ids id1,id2 --yes
 *   node scripts/docs-delete.js --url "/api/upload/callback/{flag}" --keep-method POST --yes
 *
 * 不传 --yes 时只打印 dry-run 结果，不会删除。
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

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { ids: [], url: '', keepMethod: '', yes: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ids') args.ids = String(argv[++i] || '').split(/[,\s]+/).filter(Boolean);
    else if (arg === '--url') args.url = String(argv[++i] || '');
    else if (arg === '--keep-method') args.keepMethod = String(argv[++i] || '').toUpperCase();
    else if (arg === '--yes') args.yes = true;
    else if (arg === '-h' || arg === '--help') {
      console.log([
        '用法:',
        '  node docs-delete.js --ids id1,id2 [--yes]',
        '  node docs-delete.js --url "/api/upload/callback/{flag}" --keep-method POST [--yes]',
        '',
        '说明:',
        '  不传 --yes 时只打印 dry-run 结果，不会删除。',
      ].join('\n'));
      process.exit(0);
    } else {
      die(`未知参数: ${arg}`);
    }
  }

  if (args.ids.length && args.url) die('--ids 和 --url 只能二选一');
  if (!args.ids.length && !args.url) die('必须传 --ids 或 --url');
  if (args.url && !args.keepMethod) die('--url 模式必须传 --keep-method，避免误删同路径接口');

  return args;
}

function brief(item) {
  return {
    target_id: item.target_id,
    target_type: item.target_type || '',
    name: item.name || '',
    method: item.method || '',
    url: item.url || '',
  };
}

async function main() {
  const args = parseArgs();
  const cfg = loadConfig();
  const listData = await api(cfg, `/open/apis/list?project_id=${cfg.project_id}`, null, 'GET');
  const items = listData.list || [];

  let matched = [];
  let toDelete = [];

  if (args.ids.length) {
    const byId = new Map(items.map((item) => [item.target_id, item]));
    const missing = args.ids.filter((id) => !byId.has(id));
    if (missing.length) die(`未找到 target_id: ${missing.join(', ')}`);
    matched = args.ids.map((id) => byId.get(id) || { target_id: id });
    toDelete = matched;
  } else {
    matched = items.filter((item) => item.target_type === 'api' && item.url === args.url);
    toDelete = matched.filter((item) => String(item.method || '').toUpperCase() !== args.keepMethod);
  }

  const targetIds = toDelete.map((item) => item.target_id).filter(Boolean);
  console.log(JSON.stringify({
    dry_run: !args.yes,
    matched: matched.map(brief),
    delete: toDelete.map(brief),
  }, null, 2));

  if (!targetIds.length) {
    console.log('没有需要删除的目标。');
    return;
  }

  if (!args.yes) {
    console.log('dry-run 完成；确认无误后追加 --yes 执行删除。');
    return;
  }

  const result = await api(cfg, '/open/apis/delete', {
    project_id: cfg.project_id,
    target_ids: targetIds,
  });

  console.log(JSON.stringify({
    action: 'deleted',
    target_ids: targetIds,
    result,
  }, null, 2));
}

main().catch((e) => die(e && e.message || String(e)));
