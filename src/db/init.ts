/**
 * First-run defaults.
 *
 * Idempotent — safe to call on every app start. Only fills in what is missing,
 * so it never overwrites a target the user has edited.
 */

import { db } from '@/db/schema';
import { DEFAULT_PINNED_NUTRIENTS } from '@/nutrition/registry';
import { defaultTargets } from '@/nutrition/targets';

export async function ensureDefaults(): Promise<void> {
  await db.transaction('rw', db.targets, db.settings, async () => {
    if ((await db.targets.count()) === 0) {
      await db.targets.bulkPut(defaultTargets());
    }

    const settings = await db.settings.get('settings');
    if (settings === undefined) {
      await db.settings.put({
        id: 'settings',
        pinnedNutrients: [...DEFAULT_PINNED_NUTRIENTS],
      });
    }
  });
}
