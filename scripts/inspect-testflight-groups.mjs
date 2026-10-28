#!/usr/bin/env node
import crypto from 'node:crypto';

const required = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY_BASE64', 'IOS_BUNDLE_ID', 'IOS_TESTFLIGHT_GROUP_IDS'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing iOS inspection configuration: ${missing.join(', ')}`);
  process.exit(2);
}

const base64url = (value) => Buffer.from(value).toString('base64url');
const privateKey = Buffer.from(process.env.ASC_PRIVATE_KEY_BASE64.trim(), 'base64').toString('utf8');
const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID.trim(), typ: 'JWT' }));
const payload = base64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID.trim(), iat: now - 30, exp: now + 600, aud: 'appstoreconnect-v1' }));
const signingInput = `${header}.${payload}`;
const signature = crypto.createSign('SHA256').update(signingInput).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
const token = `${signingInput}.${signature.toString('base64url')}`;

async function api(path) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.errors?.map((error) => `${error.code || response.status}: ${error.detail || error.title || 'request failed'}`).join('; ');
    throw new Error(`${response.status} ${detail || 'App Store Connect request failed'}`);
  }
  return body;
}

async function inspect() {
  const bundle = encodeURIComponent(process.env.IOS_BUNDLE_ID.trim());
  const apps = await api(`/v1/apps?filter[bundleId]=${bundle}&limit=2`);
  if (apps.data?.length !== 1) throw new Error(`Expected exactly one App Store Connect app for ${process.env.IOS_BUNDLE_ID}, found ${apps.data?.length || 0}`);
  const app = apps.data[0];
  const groupIds = [...new Set(process.env.IOS_TESTFLIGHT_GROUP_IDS.split(',').map((id) => id.trim()).filter(Boolean))];
  const failures = [];
  const results = [];
  for (const groupId of groupIds) {
    try {
      const group = await api(`/v1/betaGroups/${encodeURIComponent(groupId)}`);
      const relationship = await api(`/v1/betaGroups/${encodeURIComponent(groupId)}/relationships/app`);
      const owner = relationship.data?.id;
      const name = group.data?.attributes?.name || '(unnamed)';
      if (owner !== app.id) failures.push(`${groupId} (${name}): belongs to App ${owner || 'unknown'}, expected ${app.id}`);
      else results.push(`${groupId} (${name})`);
    } catch (error) {
      failures.push(`${groupId}: ${error.message}`);
    }
  }
  const summary = failures.length ? `iOS TestFlight inspection failed: ${failures.join(' | ')}` : `iOS TestFlight inspection passed: ${results.length}/${groupIds.length} groups belong to ${process.env.IOS_BUNDLE_ID}`;
  console.log(summary);
  if (failures.length) {
    if (process.env.FEISHU_WEBHOOK_URL?.trim()) {
      await fetch(process.env.FEISHU_WEBHOOK_URL.trim(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg_type: 'text', content: { text: `[Circle] ⚠️ ${summary}` } }) });
    }
    process.exitCode = 1;
  }
}

inspect().catch((error) => { console.error(`iOS TestFlight inspection failed: ${error.message}`); process.exitCode = 1; });
