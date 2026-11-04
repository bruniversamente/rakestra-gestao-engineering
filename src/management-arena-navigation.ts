export function getManagementArenaHref(location: { pathname: string; search: string; hash: string }, arenaId: string) {
  const query = new URLSearchParams(location.search);
  if (arenaId) query.set('arenaId', arenaId);
  else query.delete('arenaId');
  return `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`;
}
