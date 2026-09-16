'use client';
import { useMemo, useState } from 'react';
import { Alert, fmtDateTime, postJson, useApi } from '@/components/ui';
import { DataGrid, type Column } from '@/components/DataGrid';
import { ROLE_LABEL, ROLES } from '@/lib/auth';

type User = { id: string; username: string; name: string; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string };
type Resp = { ok: boolean; rows: User[] };
type Me = { ok: boolean; user: { id: string; username: string; role: string } };

export default function UsersPage() {
  const { data, error, reload } = useApi<Resp>('/api/users');
  const me = useApi<Me>('/api/auth/me');
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'USER' });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; name: string; role: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await postJson('/api/users', form);
      setMsg({ tone: 'ok', text: `Pengguna ${form.username} dibuat.` });
      setForm({ username: '', name: '', password: '', role: 'USER' }); reload();
    } catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>, okText: string) {
    setMsg(null);
    try { await postJson('/api/users', body, 'PATCH'); setMsg({ tone: 'ok', text: okText }); reload(); }
    catch (err) { setMsg({ tone: 'error', text: err instanceof Error ? err.message : String(err) }); }
  }

  async function resetPassword(u: User) {
    const pw = prompt(`Password baru untuk ${u.username} (min. 6 karakter):`);
    if (!pw) return;
    await patch({ id: u.id, password: pw }, `Password ${u.username} direset.`);
  }

  async function remove(u: User) {
    if (!confirm(`Hapus pengguna ${u.username}? Ini tidak bisa dibatalkan.`)) return;
    setMsg(null);
    const r = await fetch(`/api/users?id=${u.id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({ tone: 'error', text: j.error || 'Gagal menghapus' }); else reload();
  }

  const meId = me.data?.user.id;
  const columns = useMemo<Column<User>[]>(() => [
    { key: 'username', label: 'Username', get: (u) => u.username, mono: true, width: 160, isTitle: true, sticky: true,
      render: (u) => <>{u.username}{meId === u.id ? <span className="ml-1 text-[10px] text-muted">(Anda)</span> : null}</> },
    { key: 'name', label: 'Nama', get: (u) => u.name, width: 200,
      render: (u) => edit?.id === u.id ? <input className="input w-44" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /> : u.name },
    { key: 'role', label: 'Role', get: (u) => ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role, width: 150,
      render: (u) => edit?.id === u.id ? (
        <select className="input w-36" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      ) : <span className={`chip chip-noicon ${u.role === 'ADMIN' ? 'chip-brand' : u.role === 'USER' ? 'chip-info' : 'chip-gray'}`}>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</span> },
    { key: 'active', label: 'Status', get: (u) => (u.isActive ? 'Aktif' : 'Nonaktif'), width: 110,
      render: (u) => <button className={`chip ${u.isActive ? 'chip-ok' : 'chip-bad'}`} title="klik untuk mengubah" disabled={meId === u.id}
        onClick={() => patch({ id: u.id, isActive: !u.isActive }, `${u.username} ${u.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`)}>{u.isActive ? 'Aktif' : 'Nonaktif'}</button> },
    { key: 'last', label: 'Login terakhir', get: (u) => u.lastLoginAt, type: 'date', mono: true, width: 150, prio: 'p2', render: (u) => fmtDateTime(u.lastLoginAt) },
    { key: 'created', label: 'Dibuat', get: (u) => u.createdAt, type: 'date', mono: true, width: 150, prio: 'p3', render: (u) => fmtDateTime(u.createdAt) },
    { key: 'act', label: '', get: () => null, noSort: true, noFilter: true, width: 280,
      render: (u) => edit?.id === u.id ? (
        <span className="space-x-1">
          <button className="btn btn-sm btn-primary" onClick={() => { patch({ id: u.id, name: edit.name, role: edit.role }, 'Tersimpan.'); setEdit(null); }}>Simpan</button>
          <button className="btn btn-sm" onClick={() => setEdit(null)}>Batal</button>
        </span>
      ) : (
        <span className="space-x-1">
          <button className="btn btn-sm" onClick={() => setEdit({ id: u.id, name: u.name, role: u.role })}>Edit</button>
          <button className="btn btn-sm" onClick={() => resetPassword(u)}>Reset password</button>
          <button className="btn btn-sm btn-danger" onClick={() => remove(u)} disabled={meId === u.id}>Hapus</button>
        </span>
      ) },
  ], [edit, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Pengguna</h1>
        <div className="mt-1 text-[12.5px] text-label">
          <b>Admin</b> mengelola pengguna & pengaturan · <b>User</b> boleh mengubah data (transit, lead time, refresh) · <b>Lihat saja</b> hanya membaca.
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}

      <form onSubmit={create} className="card card-pad">
        <div className="card-title mb-3">Tambah pengguna</div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_160px_auto] md:items-end">
          <div><label className="label">Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></div>
          <div><label className="label">Nama</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Password</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></div>
          <div><label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Tambah'}</button>
        </div>
      </form>

      <DataGrid<User> id="users" rows={data?.rows ?? []} columns={columns} rowKey={(u) => u.id} loading={!data} rowClass={(u) => (u.isActive ? '' : 'opacity-60')} emptyText="Belum ada pengguna." />
    </div>
  );
}
