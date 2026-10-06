/**
 * Browser-side seed for visual checks.
 *
 * Evaluated inside the page, so it talks to IndexedDB directly rather than
 * through Dexie — crude, but it only has to make pixels. Shared by every
 * screenshot script so they all show the same scene.
 */

export const SEED = `
(async () => {
  const open = indexedDB.open('meal-prep');
  await new Promise((res, rej) => { open.onsuccess = res; open.onerror = rej; open.onupgradeneeded = res; });
  const db = open.result;
  const names = [...db.objectStoreNames];
  if (!names.includes('batches') || !names.includes('mealLogs')) return 'schema not ready';

  const today = new Date();
  const key = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  };
  const colours = ['#c2564a', '#d8c9a3', '#6f9a52', '#2a78d6', '#eb6834'];
  const tx = db.transaction(['batches', 'mealLogs'], 'readwrite');
  const batches = tx.objectStore('batches');
  const logs = tx.objectStore('mealLogs');

  for (let i = 0; i < 12; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const colour = colours[i % colours.length];
    if (i % 3 === 0) {
      batches.add({
        componentId: 1, scheduledFor: key(d), scale: 1,
        status: i % 6 === 0 ? 'planned' : 'cooked',
        componentName: 'Chicken Thighs', componentColor: colour,
        portionStyle: 'discrete', baseQuantity: 6, baseUnit: 'serving',
        nutritionPerBase: { energy_kcal: 1200 }, coveragePerBase: { energy_kcal: 1 },
        totalGrams: 1400, createdAt: Date.now(),
      });
    }
    const itemCount = (i % 5) + 1;
    const items = Array.from({ length: itemCount }, (_, n) => ({
      kind: n % 3 === 0 ? 'quick' : 'fridge', label: 'Item ' + n, color: colours[(i + n) % colours.length],
      quantity: 1, unit: 'serving', grams: 200,
      nutrients: { energy_kcal: 320, protein_g: 28 }, coverage: { energy_kcal: 1 },
    }));
    logs.add({
      date: key(d), loggedAt: Date.now(), items,
      nutrients: { energy_kcal: 320 * itemCount, protein_g: 28 * itemCount },
      coverage: { energy_kcal: 1 }, totalGrams: 200 * itemCount,
    });
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  return 'seeded';
})()
`;
