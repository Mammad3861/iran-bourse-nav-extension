import { setActiveSymbol } from '../data/cache-store';
import { validateCodalSearchSymbol } from '../data/codal-symbol-validation';
import {
  getInstrumentInfoByInsCode,
  getLatestPriceByInsCode,
  snapshotTsetmcPage
} from '../data/tsetmc-client';
import { renderNavWidget } from '../ui/nav-widget';

const UNKNOWN_SYMBOL = 'نماد تشخیص داده نشد';

async function boot(): Promise<void> {
  const snapshot = snapshotTsetmcPage(document, window.location.href);
  let displaySymbol = snapshot.displaySymbol;
  let codalSymbol = snapshot.codalSymbol;
  let instrumentName = snapshot.instrumentName;
  let currentPrice = snapshot.currentPrice;

  if (snapshot.insCode) {
    try {
      const info = await getInstrumentInfoByInsCode(snapshot.insCode, {
        timeoutMs: 2_500,
        retryLimit: 0
      });
      const apiSymbol = validateCodalSearchSymbol(info.symbol).symbol;
      displaySymbol = displaySymbol ?? apiSymbol;
      codalSymbol = codalSymbol ?? apiSymbol;
      instrumentName = instrumentName ?? info.name;
    } catch {
      // Keep DOM-only state. The widget will show a safe fallback.
    }

    if (currentPrice === undefined) {
      try {
        const price = await getLatestPriceByInsCode(snapshot.insCode, {
          timeoutMs: 2_500,
          retryLimit: 0,
          fallbackDocument: document
        });
        currentPrice = price.lastTradePrice ?? price.closingPrice;
      } catch {
        // Manual price entry remains available.
      }
    }
  }

  const symbol = displaySymbol ?? UNKNOWN_SYMBOL;

  await setActiveSymbol(symbol);
  await renderNavWidget({
    symbol,
    insCode: snapshot.insCode,
    codalSymbol,
    instrumentName,
    currentPrice,
    currentPriceSource: currentPrice ? 'page' : 'unknown'
  });
}

void boot();
