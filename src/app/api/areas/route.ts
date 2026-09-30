import { areaList, cakupanBatal } from '@/lib/query';
import { json, safe } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Daftar area beserta isinya — dipakai Pengaturan untuk mengisi pilihan area. */
export async function GET() {
  const [areas, batal] = await Promise.all([areaList(), cakupanBatal()]);
  return json(safe({ ok: true, areas, batal }));
}
