type ActiveRefresh = () => Promise<void>;

let activeRefresh: { token: symbol; run: ActiveRefresh } | null = null;

export function registerActiveRefresh(run: ActiveRefresh) {
  const token = Symbol('active-refresh');
  activeRefresh = { token, run };
  return () => {
    if (activeRefresh?.token === token) activeRefresh = null;
  };
}

export async function runActiveRefresh() {
  if (!activeRefresh) return false;
  await activeRefresh.run();
  return true;
}
