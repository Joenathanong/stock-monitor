import { prisma } from '@/lib/prisma';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { getSettingsMap } from '@/lib/compute';
import { fail, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ ok: true, settings: await getSettingsMap(), defaults: DEFAULT_SETTINGS });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail('Body harus JSON');

  const known = new Set(Object.keys(DEFAULT_SETTINGS));
  const entries = Object.entries(body).filter(([k]) => known.has(k));
  if (!entries.length) return fail('Tidak ada pengaturan yang dikenali');

  for (const [key, value] of entries) {
    const v = String(value).slice(0, 500);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }
  await prisma.auditLog.create({
    data: { action: 'SETTINGS_UPDATE', entity: 'app_setting', detail: JSON.stringify(Object.fromEntries(entries)) },
  });
  return json({ ok: true, updated: entries.length, settings: await getSettingsMap() });
}
