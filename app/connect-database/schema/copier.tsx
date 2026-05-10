'use client';
import { useState } from 'react';

export default function SchemaCopier({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <span className="text-xs text-gray-500 font-mono">client-schema.sql</span>
        <button onClick={copy}
          className={`text-xs rounded px-3 py-1 font-medium ${
            copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}>
          {copied ? '✓ Copied' : 'Copy SQL'}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono overflow-x-auto bg-gray-50 max-h-96 overflow-y-auto">{sql}</pre>
    </div>
  );
}
