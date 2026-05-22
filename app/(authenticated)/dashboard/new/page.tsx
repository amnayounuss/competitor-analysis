import NewJobForm from '../new-job-form';
import { serverClient } from '@/lib/supabase';
import { BiInline } from '@/lib/bilingual';

export default async function NewAnalysisPage() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();

  return (
    <div className="max-w-3xl p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight"><BiInline en="New Analysis" /></h1>
        <p className="text-slate-500 font-medium mt-1"><BiInline en="Define your target brand and competitors to start the scraper." /></p>
      </div>
      
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/40">
        <NewJobForm defaultEmail={user?.email || ''} />
      </div>
    </div>
  );
}
