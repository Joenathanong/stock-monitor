import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget, BudgetHabis, FUNCTION_LIMIT_MS } from './budget';

const jam = (mulai: number) => { let t = mulai; return { now: () => t, maju: (ms: number) => { t += ms; } }; };

test('sisa waktu berkurang dan tidak pernah negatif', () => {
  const c = jam(1000);
  const b = budget(10_000, c.now);
  assert.equal(b.left(), 10_000);
  c.maju(4_000);
  assert.equal(b.left(), 6_000);
  c.maju(99_000);
  assert.equal(b.left(), 0);
});

test('need melempar error yang menyebut langkahnya', () => {
  const c = jam(0);
  const b = budget(10_000, c.now);
  b.need(5_000, 'tarik stok');
  c.maju(8_000);
  assert.throws(() => b.need(5_000, 'tarik stok'), (e: Error) => {
    assert.ok(e instanceof BudgetHabis);
    assert.match(e.message, /tarik stok/);
    assert.match(e.message, /sisa 2 dtk/);
    return true;
  });
});

test('slice menyisakan cadangan untuk langkah sesudahnya', () => {
  const c = jam(0);
  const b = budget(50_000, c.now);
  assert.equal(b.slice(20_000), 30_000);
  c.maju(40_000);
  assert.equal(b.slice(20_000), 5_000, 'tidak boleh di bawah minimum');
});

test('anggaran bawaan lebih kecil dari batas keras platform', async () => {
  const { DEFAULT_BUDGET_MS } = await import('./budget');
  assert.ok(DEFAULT_BUDGET_MS < FUNCTION_LIMIT_MS, 'harus ada margin untuk menutup rapi & melepas kunci');
});

test('anggaran dilonggarkan di luar Vercel (skrip CLI tidak boleh dipotong)', async () => {
  const { defaultBudgetMs, DEFAULT_BUDGET_MS } = await import('./budget');
  const asli = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    assert.ok(defaultBudgetMs() > FUNCTION_LIMIT_MS, 'CLI tidak punya batas fungsi');
    process.env.VERCEL = '1';
    assert.equal(defaultBudgetMs(), DEFAULT_BUDGET_MS);
  } finally {
    if (asli === undefined) delete process.env.VERCEL; else process.env.VERCEL = asli;
  }
});
