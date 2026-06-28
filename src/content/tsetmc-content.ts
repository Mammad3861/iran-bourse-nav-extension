import { setActiveSymbol } from '../data/cache-store';
import { snapshotTsetmcPage } from '../data/tsetmc-client';
import { renderNavWidget } from '../ui/nav-widget';

async function boot(): Promise<void> {
  const snapshot = snapshotTsetmcPage(document, window.location.href);
  const symbol = snapshot.symbol ?? 'نماد نامشخص';

  await setActiveSymbol(symbol);
  await renderNavWidget({
    symbol,
    currentPrice: snapshot.currentPrice,
    currentPriceSource: snapshot.currentPrice ? 'page' : 'unknown'
  });
}

void boot();
