/** Baca `?area=` dari URL permintaan. Kosong = biarkan query memilih bawaannya. */
export const areaDariUrl = (req: Request): string | null =>
  new URL(req.url).searchParams.get('area')?.trim() || null;
