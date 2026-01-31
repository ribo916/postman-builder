// ============================================================================
// build-postman.js — Create-only script
// ----------------------------------------------------------------------------
// Converts an OpenAPI (Swagger) spec into a Postman Collection,
// applies standard auth configuration, and uploads it to Postman.
//
// • Always POSTs a new, dated collection (does not update existing ones)
// • Reads specs from a local file or a URL
// • Uploads to Postman if POSTMAN_API_KEY is defined
// • Environment file creation/upload is currently disabled
//
// Node 16+ (CommonJS)
// ============================================================================

require('dotenv').config({ path: './env.local' });

const fs = require('fs');
const path = require('path');
const https = require('https');
const fetch = require('node-fetch'); // v2 (CommonJS)
const Converter = require('openapi-to-postmanv2');

// ============================================================================
// Configuration
// ============================================================================
const SPEC_URL = process.env.SPEC_URL || './openapi.json';
const OUTPUT_FILE = process.env.OUTPUT_FILE || './Polly.postman_collection.json';
const WORKSPACE_ID =
  process.env.POSTMAN_WORKSPACE_ID ||
  'ca4b69c0-6e8f-4566-8561-075f5d7d6a7b';

// ============================================================================
// Script Templates
// ============================================================================

const AUTH_TEST_SCRIPT =
  'var jsonData = pm.response.json();\n' +
  'pm.environment.set("accessToken", jsonData.access_token);\n' +
  'pm.environment.set("refreshToken", jsonData.refresh_token);\n';

// ============================================================================
// Networking Helpers
// ============================================================================

const httpsAgentNoKeepAlive = new https.Agent({ keepAlive: false, maxSockets: 1 });

async function postmanFetch(url, opts, retries = 3) {
  try {
    const res = await fetch(url, { agent: httpsAgentNoKeepAlive, ...opts });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(res.status + ' ' + text);
    }
    return res;
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 700 * (4 - retries)));
      return postmanFetch(url, opts, retries - 1);
    }
    throw e;
  }
}

async function loadSpecText(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok)
      throw new Error('Failed to fetch spec: ' + res.status + ' ' + res.statusText);
    return await res.text();
  }
  const abs = path.resolve(src);
  if (!fs.existsSync(abs)) throw new Error('Spec file not found at: ' + abs);
  return fs.readFileSync(abs, 'utf8');
}

// ============================================================================
// Postman Collection Transform Helpers
// ============================================================================

function addAuthFolder(collection) {
  const authItem = {
    name: 'Get Access Token',
    event: [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: AUTH_TEST_SCRIPT.split('\n') }
      }
    ],
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
      url: '{{baseUrl}}/api/v2/auth/token/',
      body: {
        mode: 'urlencoded',
        urlencoded: [
          { key: 'username', value: '{{username}}', type: 'text' },
          { key: 'password', value: '{{password}}', type: 'text' },
          { key: 'grant_type', value: 'password', type: 'text' },
          { key: 'client_id', value: '{{clientId}}', type: 'text' },
          { key: 'client_secret', value: '{{clientSecret}}', type: 'text' }
        ]
      }
    }
  };
  const folder = { name: 'Auth', item: [authItem] };
  collection.item = Array.isArray(collection.item) ? collection.item : [];
  collection.item.unshift(folder);
}

// Remove hardcoded Authorization headers so each request's auth config (e.g. OAuth2 from Swagger) drives the header.
// Leaves request.auth and item.auth unchanged so each endpoint keeps its OAuth2 from the import.
function stripAuthHeadersOnly(node) {
  if (!node) return;

  const isRequestItem = !!(node && typeof node === 'object' && node.request);

  if (isRequestItem && node.request && Array.isArray(node.request.header)) {
    node.request.header = node.request.header.filter(
      h =>
        !(
          h &&
          typeof h.key === 'string' &&
          h.key.toLowerCase() === 'authorization'
        )
    );
  }

  if (Array.isArray(node.item)) {
    node.item.forEach(stripAuthHeadersOnly);
  }
}

const ACCESS_TOKEN_VARIABLE = '{{accessToken}}';

function setAccessTokenVariableOnAuth(auth) {
  if (!auth || typeof auth !== 'object') return;
  if (auth.type === 'oauth2' && Array.isArray(auth.oauth2)) {
    const entry = auth.oauth2.find(e => e && e.key === 'accessToken');
    if (entry) {
      entry.value = ACCESS_TOKEN_VARIABLE;
    } else {
      auth.oauth2.push({
        key: 'accessToken',
        value: ACCESS_TOKEN_VARIABLE,
        type: 'string'
      });
    }
  }
  if (auth.type === 'bearer' && Array.isArray(auth.bearer)) {
    const entry = auth.bearer.find(e => e && e.key === 'token');
    if (entry) {
      entry.value = ACCESS_TOKEN_VARIABLE;
    } else {
      auth.bearer.push({
        key: 'token',
        value: ACCESS_TOKEN_VARIABLE,
        type: 'string'
      });
    }
  }
}

function setAccessTokenVariableOnRequests(node) {
  if (!node) return;
  if (node.request && typeof node.request === 'object' && node.request.auth) {
    setAccessTokenVariableOnAuth(node.request.auth);
  }
  if (node.auth) {
    setAccessTokenVariableOnAuth(node.auth);
  }
  if (Array.isArray(node.item)) {
    node.item.forEach(setAccessTokenVariableOnRequests);
  }
}

function removeBaseUrlVariable(collection) {
  if (!Array.isArray(collection.variable)) return;
  collection.variable = collection.variable.filter(v => v && v.key !== 'baseUrl');
}

// ============================================================================
// Main Logic
// ============================================================================
(async function main() {
  try {
    // 1) Load & convert OpenAPI spec
    const specRaw = await loadSpecText(SPEC_URL);
    const convertOpts = {
      requestNameSource: 'fallback',
      indentCharacter: ' ',
      folderStrategy: 'Tags',
      requestParametersResolution: 'Example'
    };

    const result = await new Promise((resolve, reject) => {
      Converter.convert({ type: 'string', data: specRaw }, convertOpts, (err, res) => {
        if (err) return reject(err);
        if (!res || !res.result)
          return reject(new Error((res && res.reason) || 'OpenAPI conversion failed'));
        resolve(res);
      });
    });

    const collection = result.output[0].data;

    // 2) Post-processing
    addAuthFolder(collection);
    if (Array.isArray(collection.item)) {
      collection.item.forEach(stripAuthHeadersOnly);
      collection.item.forEach(setAccessTokenVariableOnRequests);
    }
    removeBaseUrlVariable(collection);

    // 3) Write to disk
    const today = new Date().toISOString().split('T')[0];
    collection.info = collection.info || {};
    collection.info.name = 'Polly API ' + today;

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(collection, null, 2));
    console.log('✅ Wrote ' + OUTPUT_FILE);

    // 4) Upload to Postman (CREATE-only)
    if (!process.env.POSTMAN_API_KEY) {
      console.warn('⚠️  POSTMAN_API_KEY not set — skipping upload.');
      return;
    }

    const wrapped = { collection: JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) };
    const postRes = await postmanFetch(
      'https://api.getpostman.com/collections?workspace=' + WORKSPACE_ID,
      {
        method: 'POST',
        headers: {
          'X-Api-Key': process.env.POSTMAN_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(wrapped)
      }
    );

    console.log('✅ Collection created:', await postRes.text());
  } catch (e) {
    console.error('❌ Upload error:', e.message);
    process.exit(1);
  }
})();
