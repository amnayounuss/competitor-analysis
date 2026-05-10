'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectDbForm({ existingUrl }: { existingUrl: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(existingUrl);
  const [key, setKey] = useState('');
  const [schemaConfirmed, setSchemaConfirmed] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [test, setTest] = useState<{ok: boolean; error?: string; schemaReady?: boolean} | null>(null);
  const [msg,  setMsg]  = useState<string | null>(null);

  async function runTest() {
    setMsg(null); setTest(null); setTesting(true);
    const r = await fetch('/api/client-db', {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ supabase_url: url.trim(), service_role_key: key.trim() }),
    });
    const j = await r.json();
    setTesting(false);
    setTest(j);
  }

  async function save() {
    setMsg(null); setSaving(true);
    const r = await fetch('/api/client-db', {
      method: 'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ supabase_url: url.trim(), service_role_key: key.trim() }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setMsg('Save failed: ' + (j.error || 'unknown')); return; }
    router.push('/dashboard');
  }

  const canTest = url.startsWith('https://') && key.length > 40;
  const canSave = test?.ok && test?.schemaReady && schemaConfirmed;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Supabase URL</label>
        <input type="text" value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://xxxxx.supabase.co"
          className="w-full border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Service role key</label>
        <input type="password" value={key} onChange={e => setKey(e.target.value)}
          placeholder="eyJhbGc..."
          className="w-full border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p className="text-xs text-gray-500 mt-1">Settings → API → "service_role" (secret)</p>
      </div>

      <label className="flex items-center gap-2 text-sm bg-yellow-50 p-3 rounded border border-yellow-200">
        <input type="checkbox" checked={schemaConfirmed} onChange={e => setSchemaConfirmed(e.target.checked)} />
        I have run the schema SQL in my Supabase SQL editor
      </label>

      <div className="flex gap-2">
        <button onClick={runTest} disabled={!canTest || testing}
          className="border rounded px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button onClick={save} disabled={!canSave || saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-5 py-2 text-sm font-medium">
          {saving ? 'Saving…' : 'Save & continue'}
        </button>
      </div>

      {test && (
        <div className={`rounded p-3 text-sm ${
          test.ok && test.schemaReady ? 'bg-green-50 text-green-800 border border-green-200' :
          test.ok ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' :
          'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {test.ok && test.schemaReady && '✅ Connection successful — schema is ready.'}
          {test.ok && !test.schemaReady && `⚠️ Connected, but: ${test.error}`}
          {!test.ok && `❌ ${test.error}`}
        </div>
      )}

      {msg && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{msg}</div>}
    </div>
  );
}
