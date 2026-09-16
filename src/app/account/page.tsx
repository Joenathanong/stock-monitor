'use client';
import { useState } from 'react';
import { Alert, postJson, useApi } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/auth';

type Me = { ok: boolean; user: { username: string; name: string; role: string } };

export default function AccountPage() {
  const me = useApi<Me>('/api/auth/me');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setMsg({ tone: 'error', text: 'Password baru tidak sama' });
    setBusy(true); setMsg(null);
    try {
      await postJson('/api/auth/password', { current, next });
      setMsg({ tone: 'ok', text: 'Password diganti.' }); setCurrent(''); setNext(''); setAgain('');
    } catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  }

  const u = me.data?.user;
  return (
    <div className="space-y-4">
      <h1 className="page-title">Akun Saya</h1>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card card-pad">
          <div className="card-title mb-2">Profil</div>
          <div className="text-[13.5px]">Username: <b>{u?.username ?? '—'}</b></div>
          <div className="text-[13.5px]">Nama: <b>{u?.name ?? '—'}</b></div>
          <div className="text-[13.5px]">Role: <b>{u ? ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role : '—'}</b></div>
        </div>
        <form onSubmit={submit} className="card card-pad">
          <div className="card-title mb-2">Ganti password</div>
          <label className="label">Password saat ini</label><input className="input mb-2" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <label className="label">Password baru</label><input className="input mb-2" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <label className="label">Ulangi password baru</label><input className="input mb-3" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </form>
      </div>
    </div>
  );
}
