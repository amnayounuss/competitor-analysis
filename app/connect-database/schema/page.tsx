import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import SchemaCopier from './copier';

export default function SchemaPage() {
  const schemaPath = path.join(process.cwd(), 'supabase/client-schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Link href="/connect-database" className="text-sm text-blue-600 hover:underline">← Back</Link>
      <h1 className="text-2xl font-semibold mt-2 mb-2">Client schema SQL</h1>
      <p className="text-sm text-gray-600 mb-4">
        Copy this SQL and paste it in your Supabase SQL editor → click Run.
        It creates the tables, indexes and a Storage bucket for your reports.
      </p>
      <SchemaCopier sql={sql} />
    </main>
  );
}
