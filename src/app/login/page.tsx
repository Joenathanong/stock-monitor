'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'loading' | 'login' | 'setup'>('loading');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/setup').then((r) => r.json()).then((j) => {
      if (j.authConfigured === false) setError('SESSION_SECRET belum diset di environment (minimal 16 karakter).');
      setMode(j.needsSetup ? 'setup' : 'login');
    }).catch(() => setMode('login'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const url = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login';
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, name }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(j.error || 'Login gagal'); return; }
    router.push(params.get('next') || '/');
  }

  return (
    <div className="flex h-[100dvh] items-center justify-center overflow-y-auto p-4" style={{ background: 'var(--grad-hero)' }}>
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-1 text-[22px] font-bold text-ink">IEG DOI Monitor</div>
        <div className="mb-5 text-[13px] text-label">
          {mode === 'setup' ? 'Belum ada pengguna. Buat akun admin pertama.' : 'Masuk dengan akun Anda.'}
        </div>
        {mode === 'setup' ? (
          <>
            <label className="label">Nama</label>
            <input className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        ) : null}
        <label className="label">Username</label>
        <input className="input mb-3" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        <label className="label">Password</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} />
        {error ? <div className="mt-2 text-[12.5px] text-negative">{error}</div> : null}
        <button className="btn btn-primary mt-4 h-11 w-full justify-center text-[15px]" disabled={busy || mode === 'loading'}>
          {busy ? 'Memeriksa…' : mode === 'setup' ? 'Buat admin & masuk' : 'Masuk'}
        </button>
        <div className="mt-4 text-center text-[12px] text-label"><a className="hover:underline" href="/tv">Buka dashboard TV (tanpa login) →</a></div>
      </form>
    </div>
  );
}
